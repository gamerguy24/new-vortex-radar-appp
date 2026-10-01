/*
 * broadcast/site_radar.js
 * Puts ONE radar site's Level 2 scan on the broadcast map.
 *
 * WHY NOT MRMS FOR THIS
 * The national mosaic is the right picture of the country and the wrong picture
 * of a storm: a 1 km grid, already smoothed and merged across sites, with no
 * tilt and no velocity behind it. Zoom it to a warned county and it turns to
 * blocks. A single WSR-88D at super-res is 0.25 km gates on a 0.5 degree
 * azimuth grid — the hook, the inflow notch and the core all survive the zoom.
 *
 * WHY THERE IS NO DECODER IN THIS FILE
 * The app already decodes Level 2 in the browser, and the Graphics Studio
 * already drew a sweep into a map projection. Both live in
 * graphics/studio/engine/radar_l2_raster.js, which imports nothing and reads the
 * app's own parser out of window.VortexL2 (dist/l2_bundle.js). This file is only
 * the bridge from that raster to a Mapbox image source. A second decoder is how
 * two views of the same radar start disagreeing with each other.
 *
 * The download and the draw are separate on purpose: on a cut to a new storm the
 * volume starts downloading WHILE the camera flies, which is the difference
 * between a two-second basemap-only shot and a five-second one.
 */

import { listLatestVolume, loadSweepFromUrl, rasterize, chosenPalette, setL2Relay }
  from '/graphics/studio/engine/radar_l2_raster.js?v=bcast2';

/*
 * THROUGH OUR OWN ORIGIN, NOT STRAIGHT TO S3.
 *
 * Two reasons, and the first is fatal on its own: the NEXRAD bucket refuses a
 * LISTING request from a browser origin (CORS), so the page can never find out
 * which volume is current by asking the bucket. And the relay the studio falls
 * back to needs a session, which this page does not have — hence the public
 * /broadcast/l2-* pair, the same handlers behind a different door.
 *
 * preferRelay also stops three guaranteed CORS failures being logged per scan,
 * which on an unattended page is three per scan for weeks.
 */
setL2Relay('/broadcast', { preferRelay: true });

const SRC = 'site-radar-src';
const LAYER = 'site-radar-layer';

/*
 * How wide the rasteriser draws, in pixels.
 *
 * This was 2200 — finer than the 1920 stage, on the reasoning that super-res
 * gates carry more detail than one screen pixel per gate. They do, but the
 * rasteriser inverts the projection per output pixel, and at 2200 that was 364
 * milliseconds of blocked main thread per redraw. The encoder captures the
 * screen at a fixed frame rate, so that is a third of a second of frozen
 * picture every camera move and every scan: the shudder.
 *
 * 1600 is the Graphics Studio default and costs roughly half as much. Mapbox
 * scales it the rest of the way, which is a far smaller loss than a stutter.
 */
const QUALITY = 1600;
/*
 * The weakest echo drawn, in dBZ.
 *
 * The studio uses 15, which is right for a graphic of one storm. On air it is
 * not: this palette paints 9.9-25 dBZ light grey, so 15 lays a grey sheet of
 * clear-air return and ground clutter across the whole in-range disc and the
 * map underneath disappears. 20 keeps real light rain and drops most of the
 * clutter. Exported because the legend must describe the same range that was
 * actually drawn.
 */
export const MIN_DBZ = 20;

export const BUSY = 'already loading a scan';

let state = {
  site: null,
  product: 'reflectivity',
  volumeUrl: null,
  radar: null,            // last decoded { sweep, location, time, ... }
  scanTime: null,
  busy: false,
};

export function siteRadarState() {
  const sweep = state.radar ? state.radar.sweep : null;
  return {
    site: state.site,
    product: state.product,
    scanTime: state.scanTime,
    elevationAngle: sweep ? sweep.elevationAngle : null,
    superRes: !!(sweep && sweep.superRes),
    volumeKey: state.volumeUrl ? state.volumeUrl.split('/').pop() : null,
    loaded: !!state.radar,
  };
}

/**
 * The map's own projection, in the shape rasterize() wants.
 *
 * rasterize() inverts a projection per output pixel, and takes a fast path when
 * longitude depends only on x and latitude only on y. A north-up Mapbox mercator
 * map satisfies that exactly, which is why this view never rotates or tilts the
 * camera. unproject() is the map's real inverse, so the raster lands on the
 * basemap to the pixel.
 */
function sceneFor(map) {
  const el = map.getContainer();
  return {
    width: el.clientWidth || 1920,
    height: el.clientHeight || 1080,
    projection: {
      invert: ([x, y]) => {
        const ll = map.unproject([x, y]);
        return [ll.lng, ll.lat];
      },
    },
  };
}

/**
 * Corners of the current view, in the order an image source expects.
 *
 * The raster was drawn THROUGH the map's projection, and Mapbox interpolates an
 * image quad linearly in mercator space — the same space the rows and columns
 * were sampled in. So pinning the image to the view corners is exact rather than
 * an approximation, as long as the camera stays north-up.
 */
function viewQuad(map, scene) {
  const c = (x, y) => { const ll = map.unproject([x, y]); return [ll.lng, ll.lat]; };
  return [c(0, 0), c(scene.width, 0), c(scene.width, scene.height), c(0, scene.height)];
}

/*
 * Hand the canvas to Mapbox without stalling the page.
 *
 * toDataURL() base64-encodes the PNG synchronously on the main thread; at this
 * size that is a freeze long enough for a 30fps capture to record it as a
 * shudder, once per camera move and once per scan. toBlob does the same work
 * off-thread and hands back an object URL, which is revoked when the next one
 * replaces it so a week of scans does not accumulate in memory.
 */
let _objectUrl = null;
function canvasUrl(canvas) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') { resolve(canvas.toDataURL('image/png')); return; }
    canvas.toBlob((blob) => {
      if (!blob) { resolve(canvas.toDataURL('image/png')); return; }
      const url = URL.createObjectURL(blob);
      if (_objectUrl) { try { URL.revokeObjectURL(_objectUrl); } catch (e) {} }
      _objectUrl = url;
      resolve(url);
    }, 'image/png');
  });
}

async function putImage(map, canvas, quad) {
  const url = await canvasUrl(canvas);
  const src = map.getSource(SRC);
  if (src) {
    // One call: setCoordinates() followed by a separate image swap shows the
    // previous scan stretched onto the new corners for a frame.
    src.updateImage({ url, coordinates: quad });
    return;
  }
  map.addSource(SRC, { type: 'image', url, coordinates: quad });
  // Beneath the warning boxes by construction, not by being re-raised later.
  const before = map.getLayer('warn-fill') ? 'warn-fill' : undefined;
  map.addLayer({
    id: LAYER,
    type: 'raster',
    source: SRC,
    paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
  }, before);
}

/**
 * Download and decode the newest volume for a site. Does not touch the map.
 *
 * Never throws: an unattended page must keep whatever is already on screen
 * rather than go black because one scan failed to download.
 *
 * @returns {Promise<{ok: boolean, changed?: boolean, reason?: string}>}
 */
export async function loadSite(site, { product = 'reflectivity', force = false } = {}) {
  const id = String(site || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(id)) return { ok: false, reason: `"${site}" is not a radar id` };
  if (state.busy) return { ok: false, reason: BUSY };
  state.busy = true;
  try {
    const found = await listLatestVolume(id);
    if (!found.url) return { ok: false, reason: found.reason || 'no scan listed' };

    if (found.url === state.volumeUrl && state.site === id && state.product === product && !force) {
      return { ok: true, changed: false };     // nothing new posted yet
    }

    const radar = await loadSweepFromUrl({ url: found.url, site: id, product });
    state.site = id;
    state.product = product;
    state.volumeUrl = found.url;
    state.radar = radar;
    state.scanTime = radar.time ? radar.time.getTime() : null;
    return { ok: true, changed: true };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  } finally {
    state.busy = false;
  }
}

/**
 * Draw the sweep we already hold into the current view. No download.
 *
 * Async only because the PNG encode is: see canvasUrl(). Callers that do not
 * await it still get the draw, just not a promise of when.
 */
export async function redrawSite(map) {
  if (!state.radar) return false;
  try {
    const scene = sceneFor(map);
    const canvas = rasterize(state.radar, scene, {
      quality: QUALITY,
      smooth: true,
      minDbz: MIN_DBZ,
      palette: chosenPalette(state.product),
    });
    /*
     * A null canvas means the rasteriser painted NOTHING — every gate in view
     * was below the 15 dBZ floor. That is clear air, not a broken radar, and it
     * must not be reported as a failure or this site gets stood down from for
     * being quiet. A transparent frame is drawn so the previous scan is not left
     * smeared across the new camera position.
     */
    if (!canvas) {
      const blank = document.createElement('canvas');
      blank.width = 2; blank.height = 2;
      await putImage(map, blank, viewQuad(map, scene));
      return true;
    }
    await putImage(map, canvas, viewQuad(map, scene));
    return true;
  } catch (e) {
    console.warn('[broadcast] site radar draw failed:', e.message);
    return false;
  }
}

/** Load (if needed) and draw. Used by the refresh timer. */
export async function showSite(map, site, opts = {}) {
  const r = await loadSite(site, opts);
  if (r.ok && (r.changed || opts.force)) {
    if (!await redrawSite(map)) return { ok: false, reason: 'could not draw the scan' };
  }
  return r;
}

/** Take the site radar off the map (going back to the national view). */
export function clearSite(map) {
  try { if (map.getLayer(LAYER)) map.removeLayer(LAYER); } catch (e) { /* style reloading */ }
  try { if (map.getSource(SRC)) map.removeSource(SRC); } catch (e) { /* style reloading */ }
  if (_objectUrl) { try { URL.revokeObjectURL(_objectUrl); } catch (e) {} _objectUrl = null; }
  state = { site: null, product: 'reflectivity', volumeUrl: null, radar: null, scanTime: null, busy: false };
}

export function siteRadarLayerId() { return LAYER; }
