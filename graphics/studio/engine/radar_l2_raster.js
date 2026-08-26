/*
 * graphics/studio/engine/radar_l2_raster.js
 * Decodes and draws NEXRAD Level 2 IN THE BROWSER, using the app's own decoder.
 *
 * WHY IT WORKS THIS WAY
 * The radar page decodes Level 2 in the browser: it lists the AWS bucket, pulls
 * the volume, and runs libnexrad on it. The studio is also a browser page, so it
 * does exactly the same thing through window.VortexL2 (dist/l2_bundle.js — the
 * same parser and the same Level2Factory the radar page uses).
 *
 * The earlier design asked a server endpoint to re-render the volume instead.
 * That was worse in three separate ways, all of which this removes:
 *   • the server could not always list the AWS bucket anonymously, so it fell
 *     back to a different feed (THREDDS) whose data did not match the radar page;
 *   • a decode costs several hundred MB, so concurrent renders got the node
 *     process OOM-killed and the browser saw a bare HTTP 502;
 *   • every pan re-uploaded the request and re-decoded, hence ~30s waits.
 * Decoding here means one download per volume, cached, and panning is just a
 * redraw. The client is also the only party that can honour a colortable the
 * viewer uploaded, since those live in their localStorage.
 *
 * Rasterisation goes STRAIGHT into the scene's projection: for each output
 * pixel, invert the projection to lon/lat, convert to the radar's polar frame,
 * and sample the gate. One resampling step, not two — the previous path built an
 * equirectangular image and then warped it, which softened every edge.
 *
 * Smoothing interpolates VALUES and then colours the result. Blurring finished
 * pixels instead would mix colours across the palette's hard boundaries and
 * invent colours the palette does not contain.
 */

const R_EARTH_KM = 6371.0088;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const PRODUCTS = {
  reflectivity: { code: 'REF', label: 'Base Reflectivity' },
  velocity: { code: 'VEL', label: 'Base Velocity' },
};

const L2_BUCKET = 'https://noaa-nexrad-level2.s3.amazonaws.com';

/** window.VortexL2, or null if dist/l2_bundle.js has not loaded. */
function lib() {
  return (typeof window !== 'undefined' && window.VortexL2) || null;
}

/* ── AWS volume resolution ────────────────────────────────────────────────────
 * Mirrors get_latest_level_2_url() in app/radar/libnexrad/loaders_nexrad.js:
 * list today's YYYY/MM/DD/SITE/ prefix and take the last key, skipping _MDM.
 */
/**
 * Latest volume for a site.
 *
 * Returns { url } on success, or { url: null, reason } explaining the failure.
 * The distinction matters: "the archive did not answer" and "this radar has not
 * posted a scan" are different problems with different fixes, and collapsing
 * them into one message sent us looking in the wrong place. A silent `continue`
 * used to turn a failed request into "no recent Level 2 volume listed", which
 * reads like the radar is down when the request never actually succeeded.
 */
export async function listLatestVolume(site) {
  const id = String(site || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!/^[A-Z]{3,4}$/.test(id)) return { url: null, reason: `"${site}" is not a radar id` };

  const now = new Date();
  let reachedArchive = false;
  let lastFailure = null;

  // Walk back a few days. Just after 00Z today's prefix is legitimately empty,
  // and a station down for maintenance can have a quiet day or two.
  for (let back = 0; back < 3; back++) {
    const d = new Date(now.getTime() - back * 86400000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const prefix = `${y}/${m}/${day}/${id}/`;

    let xml;
    try {
      // Cache-buster, as the radar page uses: a listing is the one request that
      // must never come from cache, or you decode a volume that is already old.
      const r = await fetch(
        `${L2_BUCKET}/?list-type=2&delimiter=%2F&prefix=${encodeURIComponent(prefix)}&_=${Date.now()}`,
      );
      if (!r.ok) { lastFailure = `archive returned HTTP ${r.status}`; continue; }
      xml = await r.text();
      reachedArchive = true;
    } catch (e) {
      lastFailure = e.message || 'network error';
      continue;
    }

    // Keys are lexicographic, so the last one is the newest. Skip the _MDM
    // metadata objects, exactly as loaders_nexrad.js does.
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)]
      .map((mm) => mm[1])
      .filter((k) => !k.endsWith('_MDM') && /_V\d\d$/.test(k));
    if (keys.length) return { url: `${L2_BUCKET}/${keys[keys.length - 1]}`, key: keys[keys.length - 1] };
  }

  // Direct listing got us nothing. Before giving up, ask our own server to
  // look — it is a different network path, and "this browser cannot reach S3"
  // is a completely different problem from "this radar has no data".
  try {
    const r = await fetch(`/api/graphics/l2-list?site=${id}`, { cache: 'no-store' });
    const j = await r.json();
    if (r.ok && j && j.url) return { url: j.url, key: j.key, via: 'relay' };
    if (j && j.error) {
      return { url: null, reason: j.error };
    }
  } catch (e) {
    // Relay unreachable too — fall through to the direct-path reason below.
  }

  return {
    url: null,
    reason: reachedArchive
      ? `${id} has not posted a scan in the last 3 days`
      : `could not reach the NEXRAD archive (${lastFailure || 'no response'})`,
  };
}

/** Convenience wrapper: the URL, or null. */
export async function awsLatestVolumeUrl(site) {
  return (await listLatestVolume(site)).url;
}

/* ── volume cache ─────────────────────────────────────────────────────────────
 * A decoded volume is large, so only a couple are kept — enough that switching
 * between reflectivity and velocity, or flipping back to the previous site,
 * costs nothing, without holding a whole scan history in memory.
 */
const MAX_CACHED_VOLUMES = 2;
const volumeCache = new Map();      // url -> { factory, promise }
const inflight = new Map();         // url -> Promise<factory>

function rememberVolume(url, factory) {
  volumeCache.set(url, factory);
  while (volumeCache.size > MAX_CACHED_VOLUMES) {
    volumeCache.delete(volumeCache.keys().next().value);
  }
}

async function loadVolume(url, onProgress) {
  if (volumeCache.has(url)) {
    const f = volumeCache.get(url);
    volumeCache.delete(url); rememberVolume(url, f);   // mark as recently used
    return f;
  }
  if (inflight.has(url)) return inflight.get(url);

  const job = (async () => {
    const L = lib();
    if (!L) throw new Error('Level 2 decoder not loaded');
    if (onProgress) onProgress('downloading volume');

    // Direct from the bucket first — same request the radar page makes. If that
    // fails for ANY reason, relay it through our own origin, which sidesteps
    // CORS and networks that block S3. The relay only pipes bytes; the decode
    // still happens here.
    let buf = null;
    let directError = null;
    try {
      const res = await fetch(url);
      if (res.ok) buf = await res.arrayBuffer();
      else directError = `HTTP ${res.status}`;
    } catch (e) {
      directError = e.message || 'network error';
    }

    if (!buf) {
      if (onProgress) onProgress('downloading volume (relay)');
      const res = await fetch(`/api/graphics/l2-file?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
      if (!res.ok) {
        let why = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j && j.error) why = j.error; } catch (e) { /* not JSON */ }
        throw new Error(`could not download the volume (direct: ${directError}; relay: ${why})`);
      }
      buf = await res.arrayBuffer();
    }

    if (onProgress) onProgress('decoding');
    const name = url.split('/').pop();
    const factory = await L.parseVolume(buf, name);
    rememberVolume(url, factory);
    return factory;
  })();

  inflight.set(url, job);
  try { return await job; } finally { inflight.delete(url); }
}

/* ── colour ───────────────────────────────────────────────────────────────── */

const lutCache = new Map();

/**
 * 512-entry value → RGB table, built from the app's colormap with the app's
 * chroma LAB scale, so a graphic and the radar page agree colour for colour.
 * 512 rather than 256 because the studio output is zoomable and banding shows.
 *
 * `paletteId` is the viewer's colortable pick (REF2, VEL1, …). `code` stays the
 * BASE product: scaleValues() keys its unit conversion off it, since velocity
 * tables are authored in knots and have to be divided down to m/s.
 */
function buildColorLut(code, paletteId) {
  const key = `${code}|${paletteId || ''}`;
  if (lutCache.has(key)) return lutCache.get(key);

  const L = lib();
  if (!L) return null;
  const cm = (paletteId && L.colormaps[paletteId]) || L.colormaps[code];
  if (!cm) return null;

  const values = L.scaleValues([...cm.values], code);
  const scale = L.chroma.scale([...cm.colors]).domain(values).mode('lab');
  const vmin = values[0];
  const vmax = values[values.length - 1];
  const N = 512;
  const r = new Uint8Array(N), g = new Uint8Array(N), b = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const [rr, gg, bb] = scale(vmin + (i / (N - 1)) * (vmax - vmin)).rgb();
    r[i] = rr; g[i] = gg; b[i] = bb;
  }
  const lut = { r, g, b, vmin, vmax, N };
  lutCache.set(key, lut);
  return lut;
}

/**
 * The radar page records colortable picks as { REF: 'REF2', VEL: 'VEL1', … }.
 * Reading them here is the point of decoding client-side: a table the viewer
 * uploaded exists only in this browser, so no server could resolve it.
 */
export function chosenPalette(product) {
  const base = product === 'velocity' ? 'VEL' : 'REF';
  try {
    const choices = JSON.parse(localStorage.getItem('vortexColortableChoice') || '{}');
    const id = choices && choices[base];
    return (typeof id === 'string' && id !== base) ? id : null;
  } catch (e) {
    return null;
  }
}

/* ── azimuth lookup ───────────────────────────────────────────────────────── */

// Radials come in scan order and are not evenly spaced, so index them by whole
// degree. That turns the per-pixel radial search into a look at three buckets.
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

function nearestRadial(buckets, azimuths, az) {
  const base = Math.floor(((az % 360) + 360) % 360);
  let best = -1, bestD = Infinity;
  for (let d = -1; d <= 1; d++) {
    const list = buckets[((base + d) % 360 + 360) % 360];
    if (!list) continue;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      let diff = Math.abs(azimuths[i] - az);
      if (diff > 180) diff = 360 - diff;
      if (diff < bestD) { bestD = diff; best = i; }
    }
  }
  return best;
}

/* ── sweep loading ────────────────────────────────────────────────────────── */

/**
 * Download + decode the latest volume for a site and pull one sweep out of it.
 * @returns {Promise<object>} { sweep, location, time, site, product, code, volumeUrl }
 */
export async function loadSweep({ site, product = 'reflectivity', onProgress = null } = {}) {
  const L = lib();
  if (!L) throw new Error('Level 2 decoder not loaded — reload the page');

  const code = (PRODUCTS[product] || PRODUCTS.reflectivity).code;

  if (onProgress) onProgress('finding latest scan');
  const found = await listLatestVolume(site);
  if (!found.url) throw new Error(found.reason);
  const url = found.url;

  const factory = await loadVolume(url, onProgress);

  const sweep = L.sweepFrom(factory, code);
  if (!sweep) throw new Error(`this scan has no ${code} data`);
  const location = L.locationFrom(factory);
  if (!location) throw new Error('scan has no radar location');

  return {
    sweep,
    location,
    time: L.timeFrom(factory),
    site: location.site || site,
    product,
    code,
    volumeUrl: url,
  };
}

/* ── rasterisation ────────────────────────────────────────────────────────── */

/**
 * Draw a sweep into the scene's projection.
 *
 * @param {object} radar   result of loadSweep()
 * @param {object} scene   { projection, width, height }
 * @param {object} o       { smooth, minDbz, fadeDbz, palette, quality }
 * @returns {HTMLCanvasElement|null}
 */
export function rasterize(radar, scene, o = {}) {
  const p = scene.projection;
  if (!p || !p.invert || !radar || !radar.sweep) return null;

  const { sweep, location, code } = radar;
  const { azimuths, ranges, data } = sweep;
  if (!azimuths || !ranges || !ranges.length || !data) return null;

  const lut = buildColorLut(code, o.palette || null);
  if (!lut) return null;

  /*
   * Low-return handling, matching the server renderer this replaces.
   *
   * The app's REF palette paints 9.9–25 dBZ light grey — correct on the radar
   * page, but over a basemap it is a near-opaque sheet across the whole in-range
   * disc that buries the map and the actual precipitation. So low values fade
   * in: transparent below `minDbz`, fully opaque `fadeDbz` above it. Colours are
   * untouched, so a 45 dBZ core is identical to the radar page.
   *
   * minDbz = 0 reproduces the radar page exactly. Velocity has no meaningful
   * 'too weak' floor — 0 kt is real data — so this is reflectivity only.
   */
  const isRef = code === 'REF';
  const minValue = isRef ? (Number.isFinite(o.minDbz) ? o.minDbz : 15) : -Infinity;
  const fadeSpan = isRef ? Math.max(0.001, Number.isFinite(o.fadeDbz) ? o.fadeDbz : 8) : 0.001;
  const smooth = o.smooth !== false;

  // Render at the scene's own resolution unless capped, then let the caller
  // scale up. Super-res gates are worth more pixels than a national mosaic is.
  const quality = Math.max(320, Math.min(2400, o.quality || 1600));
  const OW = Math.min(quality, Math.max(scene.width, 320));
  const scale = OW / scene.width;
  const OH = Math.max(1, Math.round(scene.height * scale));
  const inv = 1 / scale;

  const canvas = document.createElement('canvas');
  canvas.width = OW; canvas.height = OH;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(OW, OH);
  const px = img.data;

  const buckets = buildAzimuthIndex(azimuths);
  const nGates = ranges.length;
  const rangeMin = ranges[0];
  const gateKm = nGates > 1 ? (ranges[1] - ranges[0]) : 0.25;
  const maxRangeKm = ranges[nGates - 1];
  const nRadials = azimuths.length;

  const lutSpan = lut.N - 1;
  const lutScale = lutSpan / (lut.vmax - lut.vmin);

  const radarLat = location.lat, radarLon = location.lon;
  const sinφ1 = Math.sin(radarLat * D2R);
  const cosφ1 = Math.cos(radarLat * D2R);

  let painted = 0;

  for (let oy = 0; oy < OH; oy++) {
    const sy = oy * inv;
    for (let ox = 0; ox < OW; ox++) {
      const ll = p.invert([ox * inv, sy]);
      if (!ll) continue;
      const lon = ll[0], lat = ll[1];
      if (!isFinite(lon) || !isFinite(lat)) continue;

      // Great-circle range and bearing from the radar: the inverse of the gate
      // geometry — given this pixel, where is it in the radar's polar grid?
      const φ2 = lat * D2R;
      const Δλ = (lon - radarLon) * D2R;
      const sinφ2 = Math.sin(φ2), cosφ2 = Math.cos(φ2);
      const cosΔλ = Math.cos(Δλ), sinΔλ = Math.sin(Δλ);

      let cosC = sinφ1 * sinφ2 + cosφ1 * cosφ2 * cosΔλ;
      if (cosC > 1) cosC = 1; else if (cosC < -1) cosC = -1;
      const distKm = Math.acos(cosC) * R_EARTH_KM;
      if (distKm < rangeMin || distKm > maxRangeKm) continue;

      let az = Math.atan2(sinΔλ * cosφ2, cosφ1 * sinφ2 - sinφ1 * cosφ2 * cosΔλ) * R2D;
      if (az < 0) az += 360;

      const ri = nearestRadial(buckets, azimuths, az);
      if (ri < 0) continue;

      let value = null;

      if (!smooth) {
        const row = data[ri];
        if (!row) continue;
        const gi = Math.round((distKm - rangeMin) / gateKm);
        if (gi < 0 || gi >= nGates) continue;
        const v = row[gi];
        if (v == null) continue;
        value = v;
      } else {
        // Bilinear in (azimuth, range), on VALUES — see the file header.
        let diff = azimuths[ri] - az;
        if (diff > 180) diff -= 360; else if (diff < -180) diff += 360;
        // Step toward the side the point actually falls on.
        const riNext = (diff > 0) ? (ri - 1 + nRadials) % nRadials : (ri + 1) % nRadials;
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

        // Weight only the gates that actually hold data, so a missing
        // neighbour cannot drag a real echo down toward zero.
        let sum = 0, wsum = 0;
        let w = (1 - fAz) * (1 - fR); if (v00 != null && w > 0) { sum += v00 * w; wsum += w; }
        w = (1 - fAz) * fR;           if (v01 != null && w > 0) { sum += v01 * w; wsum += w; }
        w = fAz * (1 - fR);           if (v10 != null && w > 0) { sum += v10 * w; wsum += w; }
        w = fAz * fR;                 if (v11 != null && w > 0) { sum += v11 * w; wsum += w; }
        if (wsum < 0.35) continue;    // mostly empty → leave it transparent
        value = sum / wsum;
      }

      if (value == null || value < minValue) continue;

      let li = Math.round((value - lut.vmin) * lutScale);
      if (li < 0) li = 0; else if (li > lutSpan) li = lutSpan;

      let alpha = 255;
      if (isRef) {
        const t = (value - minValue) / fadeSpan;
        if (t < 1) alpha = Math.round(255 * Math.max(0, t));
        if (alpha <= 2) continue;
      }

      const di = (oy * OW + ox) * 4;
      px[di] = lut.r[li];
      px[di + 1] = lut.g[li];
      px[di + 2] = lut.b[li];
      px[di + 3] = alpha;
      painted++;
    }
  }

  if (!painted) return null;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export { PRODUCTS };
