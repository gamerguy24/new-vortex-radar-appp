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

import { loadSweep, rasterize, chosenPalette, awsLatestVolumeUrl, PRODUCTS } from './radar_l2_raster.js?v=cachefix1';
import { loadRadarSites } from './radar_sites.js?v=cachefix1';

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
// Rough great-circle distance in km. Good enough for ranking stations.
function kmBetween(aLat, aLon, bLat, bLon) {
  const dy = (bLat - aLat) * 111.32;
  const dx = (bLon - aLon) * 111.32 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  return Math.sqrt(dy * dy + dx * dx);
}

/** WSR-88D stations, nearest to the view centre first. */
async function sitesByDistance(scene) {
  let sites;
  try { sites = await loadRadarSites(); } catch (e) { sites = null; }
  if (!sites || !sites.length) return [];

  const { lat, lon } = viewCenter(scene);
  return sites
    .filter((s) => s && isFinite(s.lat) && isFinite(s.lon) && isLevel2Site(s))
    .map((s) => ({ ...s, km: kmBetween(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.km - b.km);
}

/**
 * The radar the viewer last had open on the radar page, if it is relevant here.
 *
 * The point of the studio is to make a graphic of the storm you were just
 * looking at, so when the view is inside that radar's coverage it is the right
 * default — not whichever station happens to sit closest to the centre of the
 * frame. Outside its range it is ignored, because a graphic of empty sky is
 * worse than picking a different radar.
 *
 * The radar page records this in localStorage when it plots a Level 2 volume
 * (see plot() in app/radar/libnexrad/level2/level2_factory.js).
 */
const CURRENT_SITE_KEY = 'vortexCurrentRadarSite';
const CURRENT_SITE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const L2_RANGE_KM = 230;

export function radarPageView() {
  try {
    const raw = JSON.parse(localStorage.getItem(CURRENT_SITE_KEY) || 'null');
    if (!raw || typeof raw.site !== 'string') return null;
    // Stale entries are worse than no entry: a site from last week says nothing
    // about what the viewer is working on now.
    if (!raw.at || Date.now() - raw.at > CURRENT_SITE_MAX_AGE_MS) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

function radarPageSite() {
  const v = radarPageView();
  return v ? v.site : null;
}

/**
 * Candidate sites for the "auto" setting, best first.
 *
 * More than one, deliberately. A single station can be down for maintenance or
 * simply have nothing in the archive, and hard-failing on it means the operator
 * sees an error for a radar they never chose. Trying the next nearest turns
 * that into a graphic.
 */
async function autoCandidates(scene, limit = 4) {
  const ranked = await sitesByDistance(scene);
  if (!ranked.length) return [];

  const ids = ranked.slice(0, limit).map((s) => s.id);

  const preferred = radarPageSite();
  if (preferred) {
    const match = ranked.find((s) => s.id === preferred);
    if (match && match.km <= L2_RANGE_KM) {
      return [preferred, ...ids.filter((id) => id !== preferred)];
    }
  }
  return ids;
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

  // An explicit pick is honoured exactly — if the operator chose a station, a
  // silent substitution would be a lie. "Auto" gets to try alternatives.
  const candidates = site ? [site] : await autoCandidates(scene);
  if (!candidates.length) throw new Error('no radar site for this view');

  let radar = null;
  const failures = [];
  for (const id of candidates) {
    try {
      radar = await loadSweep({ site: id, product, onProgress });
      break;
    } catch (e) {
      failures.push(`${id}: ${e.message}`);
    }
  }
  if (!radar) {
    // Report every station tried, so the message says what actually happened
    // rather than naming one radar the operator never picked.
    throw new Error(failures.length === 1 ? failures[0] : failures.join('; '));
  }

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
    superRes: radar.sweep.superRes,
    gateSpacingKm: radar.sweep.gateSpacingKm,
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
