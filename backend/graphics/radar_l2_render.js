/*
 * backend/graphics/radar_l2_render.js
 * Server-side high-resolution radar raster for the Graphics Studio.
 *
 * WHY THIS EXISTS
 * The studio's existing radar layer (graphics/studio/engine/radar.js) pulls a
 * pre-rendered PNG mosaic from the NWS ImageServer. It is convenient, but it is
 * NOT the data the main Vortex Radar app draws: it is a smoothed, downsampled
 * national composite with someone else's color table. Put it beside the app's
 * own radar and the two disagree.
 *
 * This renders the SAME data the main app uses — super-res NEXRAD Level 2 from
 * nws_radar_l2.js (which is the app's own libnexrad decoder running in Node) —
 * with the app's own colormaps (app/radar/colormaps). What you see in a graphic
 * is what you see on the radar page.
 *
 * HOW
 * Output is an equirectangular PNG over a requested [W,S,E,N] bbox, so the
 * consumer maps a pixel to lon/lat with plain linear arithmetic. For each
 * output pixel we invert to lon/lat, convert to the radar's polar frame
 * (azimuth + slant range), and sample the gate array:
 *
 *   smooth = false → nearest gate. Blocky, exactly the raw gates.
 *   smooth = true  → bilinear across the four neighbouring gates IN VALUE
 *                    SPACE, before colorizing.
 *
 * Interpolating values and then coloring is the important detail. Blurring the
 * finished RGBA (the obvious shortcut) mixes colors across the palette's hard
 * steps and invents dBZ levels that were never measured — a 55 dBZ core beside
 * 20 dBZ rain would smear through orange values that are not in the data. Value
 * -space interpolation keeps every rendered color a color the palette actually
 * assigns to a real interpolated value.
 */

const { createCanvas } = require('@napi-rs/canvas');
const chroma = require('chroma-js');
const colormaps = require('../../app/radar/colormaps/colormaps');
const { getRadarData, nearestStation } = require('../../nws_radar_l2');

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const R_EARTH_KM = 6371.0088;

const PRODUCTS = {
  reflectivity: { code: 'REF', label: 'Base Reflectivity', unit: 'dBZ' },
  velocity: { code: 'VEL', label: 'Base Velocity', unit: 'kt' },
};

/* ── colormap (identical to what the app and the Bluesky graphics use) ────── */

// Copy of scaleValues() from app/core/utils.js — that module is browser-coupled.
function scaleValues(values, product) {
  if (['N0G', 'N0U', 'VEL', 'TVX', 'TV0', 'TV1', 'TV2'].includes(product)) {
    for (const i in values) { if (values[i] !== 999) values[i] = values[i] / 1.944; }
  } else if (product === 'N0S') {
    for (const i in values) { if (values[i] !== 999) values[i] = values[i] - 0.5; }
  }
  for (let i = 0; i < values.length; i++) { if (values[i] === values[i + 1]) values[i] = values[i] - 0.00001; }
  return values;
}

// 512-entry value → [r,g,b] table. Wider than the graphic renderer's 256 because
// this output is zoomable and banding shows at high zoom.
function buildColorLut(code) {
  const cm = colormaps[code];
  if (!cm) return null;
  const values = scaleValues([...cm.values], code);
  const scale = chroma.scale([...cm.colors]).domain(values).mode('lab');
  const vmin = values[0], vmax = values[values.length - 1];
  const N = 512;
  const r = new Uint8Array(N), g = new Uint8Array(N), b = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const [rr, gg, bb] = scale(vmin + (i / (N - 1)) * (vmax - vmin)).rgb();
    r[i] = rr; g[i] = gg; b[i] = bb;
  }
  return { r, g, b, vmin, vmax, N };
}

/* ── geometry ─────────────────────────────────────────────────────────────── */

// Great-circle distance (km) and initial bearing (deg) from the radar to a point.
// This is the inverse of the gate geometry: given a pixel's lon/lat, where does
// it fall in the radar's polar grid?
function toPolar(radarLat, radarLon, lat, lon) {
  const φ1 = radarLat * D2R, φ2 = lat * D2R;
  const Δλ = (lon - radarLon) * D2R;
  const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1);
  const sinφ2 = Math.sin(φ2), cosφ2 = Math.cos(φ2);
  const cosΔλ = Math.cos(Δλ), sinΔλ = Math.sin(Δλ);

  const cosC = sinφ1 * sinφ2 + cosφ1 * cosφ2 * cosΔλ;
  const distKm = Math.acos(Math.max(-1, Math.min(1, cosC))) * R_EARTH_KM;

  const y = sinΔλ * cosφ2;
  const x = cosφ1 * sinφ2 - sinφ1 * cosφ2 * cosΔλ;
  let az = Math.atan2(y, x) * R2D;
  if (az < 0) az += 360;
  return { az, distKm };
}

/* ── azimuth index ────────────────────────────────────────────────────────── */

// Radials are in scan order and are not exactly evenly spaced, so build a
// lookup from whole-degree bucket → radial indices. O(1) per pixel.
function buildAzimuthIndex(azimuths) {
  const buckets = new Array(360);
  for (let i = 0; i < azimuths.length; i++) {
    const a = ((azimuths[i] % 360) + 360) % 360;
    const bkt = Math.floor(a);
    if (!buckets[bkt]) buckets[bkt] = [];
    buckets[bkt].push(i);
  }
  return buckets;
}

// Radial whose azimuth is closest to `az`, searching the bucket and neighbours.
function nearestRadial(buckets, azimuths, az) {
  const base = Math.floor(((az % 360) + 360) % 360);
  let best = -1, bestD = Infinity;
  for (let d = -1; d <= 1; d++) {
    const list = buckets[((base + d) % 360 + 360) % 360];
    if (!list) continue;
    for (const i of list) {
      let diff = Math.abs(azimuths[i] - az);
      if (diff > 180) diff = 360 - diff;
      if (diff < bestD) { bestD = diff; best = i; }
    }
  }
  return best;
}

/* ── render ───────────────────────────────────────────────────────────────── */

/**
 * Render one radar's lowest sweep to an equirectangular PNG.
 *
 * @param {object} o
 * @param {number[]} o.bbox      [W, S, E, N] in degrees
 * @param {number}   o.width     output pixels (height derived from the bbox aspect)
 * @param {string}   o.product   'reflectivity' | 'velocity'
 * @param {boolean}  o.smooth    bilinear gate interpolation
 * @param {string}   [o.site]    force a radar site; otherwise nearest to bbox centre
 * @returns {Promise<{buffer:Buffer, meta:object}|null>}
 */
async function renderRadarPng(o) {
  const bbox = o.bbox;
  const [W, S, E, N] = bbox;
  if (!(isFinite(W) && isFinite(S) && isFinite(E) && isFinite(N)) || E <= W || N <= S) {
    throw new Error('bbox must be W,S,E,N with E>W and N>S');
  }

  const productKey = o.product === 'velocity' ? 'velocity' : 'reflectivity';
  const code = PRODUCTS[productKey].code;
  const smooth = !!o.smooth;

  /*
   * Low-return handling.
   *
   * The app's REF palette deliberately paints 9.9–25 dBZ light grey
   * (rgb(193,193,193)) — that is what the radar page shows for clear-air
   * return, and this renderer reproduces it exactly. On the radar page that is
   * correct. Over a basemap in a graphic it is a near-opaque grey sheet across
   * the whole in-range disc, burying the map and the actual precipitation.
   *
   * So instead of a hard cut, values fade in across a band: fully transparent
   * below `minDbz`, ramping to fully opaque `fadeDbz` above it. Colors stay
   * exactly the app's — only alpha changes — so a 45 dBZ core is pixel-identical
   * to the radar page while the clear-air haze drops away.
   *
   * minDbz = 0 reproduces the radar page's look precisely.
   * Velocity has no meaningful 'too weak' floor (0 kt is real data), so this is
   * reflectivity only.
   */
  const isRef = productKey === 'reflectivity';
  const minValue = isRef ? (Number.isFinite(o.minDbz) ? o.minDbz : 15) : -Infinity;
  const fadeSpan = isRef ? Math.max(0.001, Number.isFinite(o.fadeDbz) ? o.fadeDbz : 8) : 0.001;

  const outW = Math.max(64, Math.min(2400, Math.round(o.width || 1200)));
  const outH = Math.max(64, Math.min(2400, Math.round(outW * (N - S) / (E - W))));

  const cLat = (S + N) / 2, cLon = (W + E) / 2;

  // The app's own decoder. Returns the lowest sweep carrying this product.
  let rd;
  try {
    rd = await getRadarData(cLat, cLon, code);
  } catch (e) {
    throw new Error('radar fetch/decode failed: ' + e.message);
  }
  if (!rd || !rd.data || !rd.location) return null;

  const { azimuths, ranges, data, location, site, elevationAngle, time } = rd;
  const radarLat = location[0], radarLon = location[1];
  if (!radarLat && !radarLon) return null;

  const lut = buildColorLut(code);
  if (!lut) throw new Error('no colormap for ' + code);

  const buckets = buildAzimuthIndex(azimuths);
  const nGates = ranges.length;
  const rangeMin = ranges[0];
  const gateKm = nGates > 1 ? (ranges[1] - ranges[0]) : 0.25;
  const maxRangeKm = ranges[nGates - 1];

  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(outW, outH);
  const px = img.data;

  const dLon = (E - W) / outW;
  const dLat = (N - S) / outH;
  const lutSpan = lut.N - 1;
  const lutScale = lutSpan / (lut.vmax - lut.vmin);

  let painted = 0;

  for (let y = 0; y < outH; y++) {
    // Pixel centre; row 0 is the NORTH edge of the bbox.
    const lat = N - (y + 0.5) * dLat;
    for (let x = 0; x < outW; x++) {
      const lon = W + (x + 0.5) * dLon;
      const { az, distKm } = toPolar(radarLat, radarLon, lat, lon);
      if (distKm < rangeMin || distKm > maxRangeKm) continue;

      let value = null;

      if (!smooth) {
        const ri = nearestRadial(buckets, azimuths, az);
        if (ri < 0) continue;
        const row = data[ri];
        if (!row) continue;
        const gi = Math.round((distKm - rangeMin) / gateKm);
        if (gi < 0 || gi >= nGates) continue;
        const v = row[gi];
        if (v == null) continue;
        value = v;
      } else {
        // Bilinear in (azimuth, range). Interpolating VALUES then coloring —
        // never blurring the finished pixels (see the file header).
        const ri = nearestRadial(buckets, azimuths, az);
        if (ri < 0) continue;
        // Neighbouring radial on the side the point actually falls toward.
        let diff = azimuths[ri] - az;
        if (diff > 180) diff -= 360; else if (diff < -180) diff += 360;
        const riNext = (diff > 0)
          ? (ri - 1 + azimuths.length) % azimuths.length
          : (ri + 1) % azimuths.length;
        let span = azimuths[riNext] - azimuths[ri];
        if (span > 180) span -= 360; else if (span < -180) span += 360;
        const fAz = span === 0 ? 0 : Math.max(0, Math.min(1, (-diff) / span));

        const gf = (distKm - rangeMin) / gateKm;
        const g0 = Math.floor(gf);
        const g1 = g0 + 1;
        const fR = gf - g0;
        if (g0 < 0 || g1 >= nGates) continue;

        const rowA = data[ri], rowB = data[riNext];
        if (!rowA) continue;
        const v00 = rowA[g0], v01 = rowA[g1];
        const v10 = rowB ? rowB[g0] : null, v11 = rowB ? rowB[g1] : null;

        // Only interpolate across gates that actually have data; a missing
        // neighbour must not drag a real echo toward zero.
        let sum = 0, wsum = 0;
        const acc = (v, w) => { if (v != null && w > 0) { sum += v * w; wsum += w; } };
        acc(v00, (1 - fAz) * (1 - fR));
        acc(v01, (1 - fAz) * fR);
        acc(v10, fAz * (1 - fR));
        acc(v11, fAz * fR);
        if (wsum < 0.35) continue;      // mostly empty → leave transparent
        value = sum / wsum;
      }

      if (value == null || value < minValue) continue;
      let li = Math.round((value - lut.vmin) * lutScale);
      if (li < 0) li = 0; else if (li > lutSpan) li = lutSpan;

      // Alpha ramp over the fade band; colour is untouched.
      let alpha = 255;
      if (isRef) {
        const t = (value - minValue) / fadeSpan;
        if (t < 1) alpha = Math.round(255 * Math.max(0, t));
        if (alpha <= 2) continue;
      }

      const di = (y * outW + x) * 4;
      px[di] = lut.r[li];
      px[di + 1] = lut.g[li];
      px[di + 2] = lut.b[li];
      px[di + 3] = alpha;
      painted++;
    }
  }

  ctx.putImageData(img, 0, 0);

  return {
    buffer: canvas.toBuffer('image/png'),
    meta: {
      site,
      product: productKey,
      productLabel: PRODUCTS[productKey].label,
      unit: PRODUCTS[productKey].unit,
      elevationAngle: elevationAngle == null ? null : Number(elevationAngle.toFixed(2)),
      scanTime: time ? new Date(time).toISOString() : null,
      bbox,
      width: outW,
      height: outH,
      gateSpacingKm: Number(gateKm.toFixed(3)),
      radials: azimuths.length,
      gates: nGates,
      superRes: gateKm <= 0.26 && azimuths.length >= 700,
      smoothed: smooth,
      minValue: minValue === -Infinity ? null : minValue,
      fadeDbz: isRef ? fadeSpan : null,
      paintedPixels: painted,
      radar: { lat: radarLat, lon: radarLon },
    },
  };
}

module.exports = { renderRadarPng, nearestStation, PRODUCTS, buildColorLut };
