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
 * app's own parser out of globalThis.VortexL2 (dist/l2_bundle.js). This file is
 * the bridge from that raster to a Mapbox image source. A second decoder is how
 * two views of the same radar start disagreeing with each other.
 *
 * WHY IT ALL HAPPENS IN A WORKER
 * Measured on the live page: decoding a newly arrived volume blocked the main
 * thread for 2.6 SECONDS, during which nothing renders — about eighty frozen
 * frames to an encoder capturing at a fixed rate, every few minutes. That was
 * the shudder. The decode and the rasterisation now happen in
 * broadcast/radar_worker.js and this file receives a finished PNG. If a worker
 * cannot be created the old in-page path still runs: it stutters, but an
 * unattended stream never goes dark for want of a worker.
 */

import { listLatestVolume, loadSweepFromUrl, rasterize, chosenPalette, setL2Relay }
  from '/graphics/studio/engine/radar_l2_raster.js?v=bcast3';

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
 * rasteriser inverts the projection per output pixel, and at 2200 that cost 364
 * milliseconds per redraw. The work is off the main thread now so it freezes
 * nothing, but there is still no point drawing detail the stage cannot show:
 * 1600 is the Graphics Studio default and Mapbox scales it the rest of the way.
 */
const QUALITY = 1600;

/*
 * The weakest echo drawn, in dBZ.
 *
 * The studio uses 15, which is right for a graphic of one storm. On air it is
 * not: this palette paints 9.9-25 dBZ light grey, so 15 lays a grey sheet of
 * clear-air return and ground clutter across the whole in-range disc and the map
 * underneath disappears. 20 keeps real light rain and drops most of the clutter.
 * Exported because the legend must describe the same range that was drawn.
 */
export const MIN_DBZ = 20;

export const BUSY = 'already loading a scan';

let state = {
  site: null,
  product: 'reflectivity',
  volumeUrl: null,
  radar: null,            // only the in-page fallback holds a decoded volume
  scanTime: null,
  elevationAngle: null,
  superRes: false,
  volumeKey: null,
  busy: false,
};

export function siteRadarState() {
  return {
    site: state.site,
    product: state.product,
    scanTime: state.scanTime,
    elevationAngle: state.elevationAngle,
    superRes: state.superRes,
    volumeKey: state.volumeKey,
    loaded: !!(state.radar || state.volumeKey),
  };
}

/* ── the worker ───────────────────────────────────────────────────────────── */

let worker = null;
let workerBroken = false;
/*
 * How many times a dead worker is replaced before the page gives up on workers
 * entirely. A crash is usually memory — five volumes in a row is a lot to pass
 * through one thread — and a fresh worker handles it. A fault that survives
 * three replacements is not going to be fixed by a fourth.
 */
let workerSpawns = 0;
const MAX_WORKER_SPAWNS = 4;
let nextId = 1;
const pending = new Map();
const progress = new Map();     // id -> per-frame callback, for loops

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      throw new Error('workers or OffscreenCanvas unavailable');
    }
    workerSpawns++;
    worker = new Worker('/broadcast/radar_worker.js?v=bcast2', { type: 'module' });
    worker.onmessage = (e) => {
      const { id, result, frame } = e.data || {};
      // A loop reports each frame as it finishes, then resolves once at the end.
      if (frame) { const onFrame = progress.get(id); if (onFrame) onFrame(frame); return; }
      const resolve = pending.get(id);
      if (resolve) { pending.delete(id); progress.delete(id); resolve(result); }
    };
    worker.onerror = (e) => {
      /*
       * Let the in-flight work fall back to the page, then allow a fresh worker
       * on the next request. Only after several deaths is the page assumed to be
       * somewhere workers simply do not work.
       */
      const fatal = workerSpawns >= MAX_WORKER_SPAWNS;
      console.error('[broadcast] radar worker died (' + (e.message || e) + '); '
        + (fatal ? 'decoding in the page from now on' : 'a new one will be started'));
      workerBroken = fatal;
      for (const [, resolve] of pending) resolve(null);   // null = fall back for now
      pending.clear();
      progress.clear();
      try { worker.terminate(); } catch (err) { /* already gone */ }
      worker = null;
    };
  } catch (e) {
    console.warn('[broadcast] no radar worker (' + e.message + '); decoding in the page instead');
    workerBroken = true;
    worker = null;
  }
  return worker;
}

/**
 * A failure that says the worker itself is unusable, rather than that a radar
 * has no data or the network was slow.
 *
 * A TIMEOUT is deliberately not one of these. A volume is tens of megabytes and
 * a slow minute proves nothing about the worker; retiring it for that would
 * trade one slow scan for a permanently stuttering stream.
 */
function isWorkerFault(reason) {
  const r = String(reason || "");
  if (/timed out/i.test(r)) return false;
  return /decoder not loaded|OffscreenCanvas|not defined|import|module|Worker/.test(r);
}

/** Give up on the CURRENT worker. Permanent only once it has happened enough. */
function retireWorker() {
  workerBroken = workerSpawns >= MAX_WORKER_SPAWNS;
  try { if (worker) worker.terminate(); } catch (e) { /* already gone */ }
  worker = null;
}

/** Ask the worker. Resolves null when there is no worker, so callers fall back. */
function ask(type, payload, onFrame) {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    if (onFrame) progress.set(id, onFrame);
    /*
     * A worker that never answers must not wedge the page forever. Generous,
     * because this covers listing, downloading tens of megabytes and decoding,
     * and the only cost of waiting is that this scan is late.
     */
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        progress.delete(id);
        resolve({ ok: false, reason: 'radar worker timed out' });
      }
    }, 180000);
    w.postMessage({ id, type, payload });
  });
}

/* ── the map's viewport, as numbers a worker can use ──────────────────────── */

function viewOf(map) {
  const el = map.getContainer();
  const width = el.clientWidth || 1920;
  const height = el.clientHeight || 1080;
  const nw = map.unproject([0, 0]);
  const se = map.unproject([width, height]);
  return {
    west: nw.lng, north: nw.lat, east: se.lng, south: se.lat,
    width, height, quality: QUALITY, minDbz: MIN_DBZ,
  };
}

/**
 * Corners of the current view, in the order an image source expects.
 *
 * The raster is drawn THROUGH the map's projection, and Mapbox interpolates an
 * image quad linearly in mercator space — the same space the rows and columns
 * were sampled in. So pinning the image to the view corners is exact rather than
 * an approximation, as long as the camera stays north-up.
 */
function quadOf(view) {
  return [[view.west, view.north], [view.east, view.north],
    [view.east, view.south], [view.west, view.south]];
}

let objectUrl = null;

function showImage(map, url, quad) {
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

function useBlob(map, blob, quad) {
  const url = URL.createObjectURL(blob);
  if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (e) { /* already gone */ } }
  objectUrl = url;
  showImage(map, url, quad);
}

/* ── the in-page fallback, for when a worker cannot be had ────────────────── */

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

async function drawInPage(map) {
  if (!state.radar) return false;
  const canvas = rasterize(state.radar, sceneFor(map), {
    quality: QUALITY, smooth: true, minDbz: MIN_DBZ, palette: chosenPalette(state.product),
  });
  /*
   * A null canvas means every gate in view was below the floor: clear air, not a
   * broken radar. A transparent frame is drawn so the previous scan is not left
   * smeared across the new camera position.
   */
  const c = canvas || Object.assign(document.createElement('canvas'), { width: 2, height: 2 });
  const blob = await new Promise((resolve) => {
    if (typeof c.toBlob === 'function') c.toBlob(resolve, 'image/png');
    else resolve(null);
  });
  if (!blob) return false;
  useBlob(map, blob, quadOf(viewOf(map)));
  return true;
}

/* ── what the page calls ──────────────────────────────────────────────────── */

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
    const viaWorker = await ask('load', { site: id, product, force });
    if (viaWorker) {
      /*
       * Tell a BROKEN worker apart from a radar that has no data.
       *
       * The first version of this believed everything the worker said, so when
       * the worker could not find the decoder it reported failure for every
       * site in turn and the page stood down from five working radars and went
       * back to the national view. A worker that cannot do the job at all is
       * not evidence about the weather: retire it and decode here instead.
       */
      if (!viaWorker.ok && isWorkerFault(viaWorker.reason)) {
        console.warn('[broadcast] radar worker is not usable (' + viaWorker.reason
          + '); decoding in the page from now on');
        retireWorker();
      } else if (!viaWorker.ok) {
        return { ok: false, reason: viaWorker.reason };
      } else {
        const m = viaWorker.meta || {};
        state.site = m.site || id;
        state.product = product;
        state.scanTime = m.scanTime;
        state.elevationAngle = m.elevationAngle;
        state.superRes = m.superRes;
        state.volumeKey = m.volumeKey;
        state.radar = null;               // the worker holds the decoded volume
        return { ok: true, changed: viaWorker.changed };
      }
    }

    // No worker: decode here instead. Slower, and it stutters, but it works.
    const found = await listLatestVolume(id);
    if (!found.url) return { ok: false, reason: found.reason || 'no scan listed' };
    if (found.url === state.volumeUrl && state.site === id && state.product === product && !force) {
      return { ok: true, changed: false };          // nothing new posted yet
    }
    const radar = await loadSweepFromUrl({ url: found.url, site: id, product });
    state.site = id;
    state.product = product;
    state.volumeUrl = found.url;
    state.radar = radar;
    state.scanTime = radar.time ? radar.time.getTime() : null;
    state.elevationAngle = radar.sweep ? radar.sweep.elevationAngle : null;
    state.superRes = !!(radar.sweep && radar.sweep.superRes);
    state.volumeKey = found.url.split('/').pop();
    return { ok: true, changed: true };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  } finally {
    state.busy = false;
  }
}

/** Draw the scan we already hold into the current view. No download. */
export async function redrawSite(map) {
  try {
    const view = viewOf(map);
    const viaWorker = await ask('draw', { view, palette: chosenPalette(state.product) });
    if (viaWorker) {
      if (viaWorker.ok && viaWorker.blob) {
        useBlob(map, viaWorker.blob, quadOf(view));
        return true;
      }
      if (!isWorkerFault(viaWorker.reason)) return false;
      retireWorker();          // fall through and draw here instead
    }
    return await drawInPage(map);
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

/* ── the loop ─────────────────────────────────────────────────────────────
 * A still radar picture is indistinguishable from a broken stream. Looping the
 * last few scans is what tells a viewer this is live — and it is also simply
 * how radar is read: one frame says where the rain is, five say where it is
 * going.
 *
 * Frames are rendered for ONE camera position. The camera only moves when the
 * shot changes, and a shot change throws the loop away, so they stay valid for
 * exactly as long as they are used.
 */
const LOOP_HOLD_LAST_MS = 1300;      // pause on the newest frame, as radar loops do
const LOOP_STEP_MS = 420;
const LOOP_MAX_FRAMES = 8;

let loop = {
  frames: [],        // [{ url, scanTime }] oldest first
  timer: null,
  idx: 0,
  token: 0,          // bumped on every rebuild, so a late frame is dropped
  building: false,
};

function revokeFrames(frames) {
  for (const fr of frames) { try { URL.revokeObjectURL(fr.url); } catch (e) { /* already gone */ } }
}

/** What the loop is doing, for the caption on screen. */
export function loopState() {
  const cur = loop.frames[loop.idx];
  return {
    frames: loop.frames.length,
    playing: !!loop.timer,
    building: loop.building,
    index: loop.idx,
    scanTime: cur ? cur.scanTime : null,
    newest: loop.frames.length ? loop.frames[loop.frames.length - 1].scanTime : null,
  };
}

/** Stop playing. Says nothing about what is being built. */
export function stopLoop() {
  if (loop.timer) { clearTimeout(loop.timer); loop.timer = null; }
}

/**
 * Leave the loop behind entirely: stop it, free the frames, and abandon any
 * build still running for it.
 *
 * Separate from stopLoop on purpose. An earlier version bumped the token inside
 * stopLoop, and since buildLoop takes its token and THEN calls stopLoop, every
 * frame it rendered was immediately discarded as superseded — the loop built
 * nothing, for ever, while reporting that it was still building.
 */
function abandonLoop() {
  stopLoop();
  revokeFrames(loop.frames);
  loop.frames = [];
  loop.idx = 0;
  loop.token++;
  loop.building = false;
}

/** Show frame `i`, then schedule the next. */
function showFrame(map, i) {
  if (!loop.frames.length) return;
  loop.idx = ((i % loop.frames.length) + loop.frames.length) % loop.frames.length;
  const fr = loop.frames[loop.idx];
  try {
    const src = map.getSource(SRC);
    if (src) src.updateImage({ url: fr.url });
  } catch (e) {
    stopLoop();
    return;
  }
  const last = loop.idx === loop.frames.length - 1;
  loop.timer = setTimeout(() => showFrame(map, loop.idx + 1), last ? LOOP_HOLD_LAST_MS : LOOP_STEP_MS);
}

export function startLoop(map) {
  stopLoop();
  if (loop.frames.length < 2) return false;      // one frame is not a loop
  showFrame(map, 0);
  return true;
}

/**
 * Build the loop for whatever is on air, and start playing as soon as there are
 * two frames rather than waiting for the whole run.
 *
 * Never throws: a failure leaves the still frame on screen, which is what was
 * there before.
 */
export async function buildLoop(map, site, opts = {}) {
  const product = opts.product || 'reflectivity';
  const count = opts.count || 5;
  const token = ++loop.token;
  stopLoop();
  revokeFrames(loop.frames);
  loop.frames = [];
  loop.idx = 0;
  loop.building = true;
  const view = viewOf(map);
  try {
    const r = await ask('loop', { site, product, count, view, palette: chosenPalette(product) },
      (frame) => {
        if (token !== loop.token) return;        // the shot moved on while this rendered
        if (!frame.ok || !frame.blob) return;
        loop.frames.push({ url: URL.createObjectURL(frame.blob), scanTime: frame.scanTime });
        if (loop.frames.length === 2) startLoop(map);
      });
    if (token !== loop.token) return { ok: false, reason: 'superseded' };
    /*
     * Play whatever arrived, whatever else went wrong.
     *
     * These returns used to come first, so a run that produced four good frames
     * and then lost the worker left all four sitting still — a frozen picture
     * produced by the very code that exists to stop pictures freezing.
     */
    if (loop.frames.length >= 2 && !loop.timer) startLoop(map);
    if (!r) return { ok: loop.frames.length >= 2, frames: loop.frames.length, reason: 'worker went away' };
    if (!r.ok) return { ok: loop.frames.length >= 2, frames: loop.frames.length, reason: r.reason };
    return { ok: true, frames: loop.frames.length };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  } finally {
    if (token === loop.token) loop.building = false;
  }
}

/** Put the scan just loaded on the end of the loop, dropping the oldest. */
export function appendToLoop(blob, scanTime) {
  if (!loop.frames.length || !blob) return false;
  if (loop.frames.some((fr) => fr.scanTime === scanTime)) return false;   // already have it
  loop.frames.push({ url: URL.createObjectURL(blob), scanTime });
  while (loop.frames.length > LOOP_MAX_FRAMES) revokeFrames(loop.frames.splice(0, 1));
  return true;
}

/** Take the site radar off the map (going back to the national view). */
export function clearSite(map) {
  abandonLoop();
  try { if (map.getLayer(LAYER)) map.removeLayer(LAYER); } catch (e) { /* style reloading */ }
  try { if (map.getSource(SRC)) map.removeSource(SRC); } catch (e) { /* style reloading */ }
  if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (e) { /* already gone */ } objectUrl = null; }
  ask('clear', {});
  state = {
    site: null, product: 'reflectivity', volumeUrl: null, radar: null,
    scanTime: null, elevationAngle: null, superRes: false, volumeKey: null, busy: false,
  };
}

export function siteRadarLayerId() { return LAYER; }
