/*
 * graphics/studio/engine/radar_l2.js
 * Scene-facing wrapper around the browser Level 2 decoder.
 *
 * engine/radar.js pulls a pre-rendered mosaic PNG from the NWS ImageServer.
 * This one decodes super-res NEXRAD Level 2 IN THIS BROWSER with the app's own
 * libnexrad decoder and the app's own colormaps — the same code path the radar
 * page runs — so a graphic and the live radar agree gate for gate.
 *
 * Two things follow from decoding client-side, and both are the point:
 *
 *   • ONE download per volume. Panning and zooming only re-rasterise what is
 *     already in memory, so the map moves at once instead of waiting on a round
 *     trip. The previous server-render design re-decoded on every view change,
 *     which is where the ~30 second waits and the HTTP 502s came from.
 *
 *   • The viewer's own colortable works. Uploaded tables live in this browser's
 *     localStorage and no server can see them.
 *
 * See engine/radar_l2_raster.js for the decode, the AWS listing and the
 * rasteriser itself.
 */

import { loadSweep, rasterize, chosenPalette, awsLatestVolumeUrl, PRODUCTS } from './radar_l2_raster.js';
import { loadRadarSites } from './radar_sites.js';

const CONUS = { W: -125, S: 24, E: -66.5, N: 50 };

/**
 * Does this station publish Level 2? The site table also carries TDWR and
 * profiler entries, which do not — note that eligibility is NOT about the id:
 * PAKC and TJUA are WSR-88D despite not starting with K.
 */
export function isLevel2Site(s) {
  return !!s && String(s.type || '') === 'WSR-88D';
}

// Geographic bbox covering the current view, sampled from the projection.
// Still exported: callers use it to decide what is on screen.
export function viewBbox(scene, padFrac = 0.04) {
  const p = scene.projection;
  if (!p || !p.invert) return [CONUS.W, CONUS.S, CONUS.E, CONUS.N];
  let W = Infinity, S = Infinity, E = -Infinity, N = -Infinity;
  const nx = 24, ny = 16;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const ll = p.invert([scene.width * i / nx, scene.height * j / ny]);
      if (!ll) continue;
      const [lon, lat] = ll;
      if (!isFinite(lon) || !isFinite(lat)) continue;
      if (lon < W) W = lon; if (lon > E) E = lon;
      if (lat < S) S = lat; if (lat > N) N = lat;
    }
  }
  if (!(isFinite(W) && isFinite(S) && E > W && N > S)) return [CONUS.W, CONUS.S, CONUS.E, CONUS.N];
  const px = (E - W) * padFrac, py = (N - S) * padFrac;
  return [
    Math.max(-179, W - px), Math.max(-85, S - py),
    Math.min(179, E + px), Math.min(85, N + py),
  ];
}

/** Centre of the current view, in degrees. */
function viewCenter(scene) {
  const p = scene.projection;
  if (p && p.invert) {
    const ll = p.invert([scene.width / 2, scene.height / 2]);
    if (ll && isFinite(ll[0]) && isFinite(ll[1])) return { lat: ll[1], lon: ll[0] };
  }
  const b = viewBbox(scene);
  return { lat: (b[1] + b[3]) / 2, lon: (b[0] + b[2]) / 2 };
}

/**
 * WSR-88D nearest the view centre, for the "auto" site setting.
 *
 * Only WSR-88D is eligible: the site table also holds TDWR and profiler
 * stations, and neither publishes a Level 2 volume, so picking one would
 * guarantee a "no volume listed" failure.
 */
async function nearestSite(scene) {
  let sites;
  try { sites = await loadRadarSites(); } catch (e) { sites = null; }
  if (!sites || !sites.length) return null;

  const { lat, lon } = viewCenter(scene);
  let best = null, bestD = Infinity;
  for (const s of sites) {
    if (!s || !isFinite(s.lat) || !isFinite(s.lon)) continue;
    if (!isLevel2Site(s)) continue;
    const dy = s.lat - lat;
    const dx = (s.lon - lon) * Math.cos(lat * Math.PI / 180);
    const d = dy * dy + dx * dx;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best ? best.id : null;
}

/**
 * Load the radar for the current view.
 *
 * Note what is NOT here: the view. A decoded volume covers the radar's whole
 * ~230 km disc, so panning and zooming inside it need no new data — the caller
 * should key this on the SITE and the PRODUCT, not on the camera.
 *
 * @returns {Promise<object>} shape-compatible with the old server-render result:
 *   { sweep, location, opacity, meta } — plus the pieces the rasteriser needs.
 */
export async function fetchRadarL2(scene, opts = {}) {
  const {
    opacity = 0.9, product = 'reflectivity', site = null, palette = null,
    onProgress = null,
  } = opts;

  const siteId = site || await nearestSite(scene);
  if (!siteId) throw new Error('no radar site for this view');

  const radar = await loadSweep({ site: siteId, product, onProgress });

  // Explicit pick wins; otherwise follow whatever the viewer chose on the radar
  // page, so a graphic does not quietly disagree with the radar they are
  // looking at.
  radar.palette = palette || chosenPalette(product);
  radar.opacity = opacity;

  // Caption material: what was ACTUALLY drawn, not what was asked for.
  radar.meta = {
    site: radar.site,
    product,
    productLabel: (PRODUCTS[product] || PRODUCTS.reflectivity).label,
    scanTime: radar.time ? radar.time.toISOString() : null,
    elevationAngle: radar.sweep.elevationAngle,
    palette: radar.palette || radar.code,
    source: 'aws',
    gates: radar.sweep.ranges.length,
    radials: radar.sweep.azimuths.length,
  };
  return radar;
}

/* ── layer ────────────────────────────────────────────────────────────────── */

// Cheap signature of the projection geometry, so the raster is only rebuilt
// when the view actually changes rather than on every unrelated rerender.
function projSig(scene) {
  const p = scene.projection;
  const pts = [[-98, 39], [-118, 34], [-80, 42]];
  let s = `${scene.width}x${scene.height}|`;
  for (const pt of pts) { const q = p(pt); s += q ? `${Math.round(q[0])},${Math.round(q[1])};` : 'n;'; }
  return s;
}

function getRaster(radar, scene, o) {
  const sig = [
    projSig(scene), o.quality, o.smooth ? 1 : 0, o.minDbz, radar.palette || '',
  ].join('|');
  if (radar._raster && radar._raster.sig === sig) return radar._raster.canvas;
  const canvas = rasterize(radar, scene, {
    quality: o.quality,
    smooth: o.smooth,
    minDbz: o.minDbz,
    palette: radar.palette,
  });
  radar._raster = { sig, canvas };
  return canvas;
}

/**
 * Scene layer for the Level 2 radar.
 *
 * `quality` is the raster width. engine/radar.js caps its equivalent at 900
 * because a national mosaic is fuzzy anyway; here the source is super-res gate
 * data, so a higher resolution is the difference between a crisp storm core and
 * a soft blob. Drop it while the map is being dragged — this is a per-pixel
 * projection inversion, so it is the difference between a smooth drag and a
 * stuttering one.
 */
export function radarL2Layer(radar, { quality = 1600, smooth = true, minDbz = 15 } = {}) {
  return {
    name: 'radar-l2',
    draw(ctx, scene) {
      if (!radar || !radar.sweep) return;
      const raster = getRaster(radar, scene, { quality, smooth, minDbz });
      if (!raster) return;
      ctx.save();
      ctx.globalAlpha = radar.opacity == null ? 0.9 : radar.opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(raster, 0, 0, scene.width, scene.height);
      ctx.restore();
    },
  };
}

export { awsLatestVolumeUrl, chosenPalette };
