/*
 * broadcast/radar_worker.js
 * Decodes and draws NEXRAD Level 2 off the main thread.
 *
 * WHY THIS EXISTS
 * Measured on the live page: when a new volume arrives, decoding it blocked the
 * main thread for 2.6 SECONDS. Everything else about the page was smooth — a
 * median frame of 7ms either side of it — but nothing renders during a parse, so
 * an encoder capturing at a fixed frame rate records about eighty frozen frames
 * every few minutes. That is the shudder.
 *
 * Nothing here touches the DOM. The volume is fetched and parsed here, the sweep
 * is rasterised into an OffscreenCanvas here, and the main thread receives a
 * finished PNG blob — its only remaining job is URL.createObjectURL.
 *
 * THE PROJECTION IS REBUILT, NOT SENT
 * The rasteriser draws through the map's own projection, and a Mapbox map cannot
 * cross a worker boundary. It does not need to: with the camera north-up and
 * unpitched — which this page enforces — a Web Mercator viewport is completely
 * described by its four edges and its size. Longitude is linear in x, and
 * latitude is linear in y once passed through the mercator transform. What is
 * rebuilt below is exact, not an approximation.
 */

/*
 * THE DECODER, AND A `window` THAT IS REALLY THIS WORKER.
 *
 * The page gets the decoder from a <script> tag; a worker has none, so it is
 * imported here for its side effect (the bundle's UMD header resolves the global
 * to `self`, and the entry publishes on globalThis). Without it every scan fails
 * with "Level 2 decoder not loaded".
 *
 * The shim is for the Level 2 parser's own decompression path, which reaches for
 * window.URL. The parser now decompresses inline when there is no document, so
 * this should no longer be needed — it stays because anything else in that
 * dependency tree that probes for a window should find one rather than throw on
 * air, and the cost is a single assignment.
 *
 * Imported dynamically, and started BEFORE the message handler is installed
 * below rather than awaited at the top level: with a top-level await the handler
 * is registered only after the module finishes evaluating, and the first message
 * — which is the one that matters — arrives before that and is lost. The worker
 * simply never answered.
 */
globalThis.window = globalThis;
const ready = import('/dist/l2_bundle.js?v=bcast3');

import {
  listLatestVolume, listRecentVolumes, loadSweepFromUrl, rasterize,
  setL2Relay, setCacheLimits, releaseVolumeCaches,
} from '/graphics/studio/engine/radar_l2_raster.js?v=bcast5';

// Same public relay the page uses, and for the same reasons: no session here
// either, and the bucket will not accept a listing request from a browser.
setL2Relay('/broadcast', { preferRelay: true });

/*
 * Keep almost nothing. The decoder defaults to ten downloaded volumes and two
 * decoded ones, which is right for the Graphics Studio — a Play loop steps back
 * and forth over the same frames there. Here every scan is rasterised once and
 * never revisited, so a cache is just memory held until something gets killed.
 * One of each is enough to cover a retry.
 */
setCacheLimits({ volumes: 1, bytes: 1 });

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const invMercY = (y) => (2 * (Math.atan(Math.exp(y)) - Math.PI / 4)) * R2D;

/** The map's viewport, as a projection the rasteriser can invert. */
function projectionFor(view) {
  const { west, east, north, south, width, height } = view;
  const yTop = mercY(north);
  const yBot = mercY(south);
  return {
    invert: ([x, y]) => [
      west + (x / width) * (east - west),
      invMercY(yTop + (y / height) * (yBot - yTop)),
    ],
  };
}

let radar = null;        // the decoded volume currently held
let volumeUrl = null;

/*
 * What this worker is holding, in megabytes, when the browser will say.
 *
 * performance.memory is Chrome-only and non-standard, which is fine: the thing
 * that runs this unattended for weeks is Chrome. It is the only view the page
 * gets of the memory that actually matters, because the decoding all happens
 * in here and the page cannot see a worker heap from outside.
 */
function heapMB() {
  try {
    const m = performance.memory;
    return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
  } catch (e) { return null; }
}

function meta() {
  const sweep = radar ? radar.sweep : null;
  return {
    heapMB: heapMB(),
    site: radar ? radar.site : null,
    scanTime: radar && radar.time ? radar.time.getTime() : null,
    elevationAngle: sweep ? sweep.elevationAngle : null,
    superRes: !!(sweep && sweep.superRes),
    volumeKey: volumeUrl ? volumeUrl.split('/').pop() : null,
    loaded: !!radar,
  };
}

async function load({ site, product = 'reflectivity', force = false, known = null }) {
  const id = String(site || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(id)) return { ok: false, reason: '"' + site + '" is not a radar id' };

  const found = await listLatestVolume(id);
  if (!found.url) return { ok: false, reason: found.reason || 'no scan listed' };

  /*
   * `known` is what the PAGE already has on screen. This worker may have been
   * started seconds ago and decoded nothing, but that says nothing about what
   * the viewer is looking at — without this, every refresh would decode the
   * current volume again only to discover it had not changed.
   */
  const haveIt = (found.url === volumeUrl && radar && radar.site === id && radar.product === product)
    || (known && found.url === known);
  if (haveIt && !force) {
    return { ok: true, changed: false, url: found.url, meta: meta() };
  }

  radar = await loadSweepFromUrl({ url: found.url, site: id, product });
  volumeUrl = found.url;
  return { ok: true, changed: true, url: found.url, meta: meta() };
}

async function draw({ view, palette }) {
  if (!radar) return { ok: false, reason: 'no scan loaded' };
  const canvas = rasterize(radar, {
    width: view.width,
    height: view.height,
    projection: projectionFor(view),
  }, { quality: view.quality, smooth: true, minDbz: view.minDbz, palette: palette || null });

  /*
   * A null canvas means every gate in view was below the floor: clear air, not a
   * broken radar. A 2x2 transparent frame clears the previous scan rather than
   * leaving it smeared across the new camera position.
   */
  const out = canvas || new OffscreenCanvas(2, 2);
  const blob = await out.convertToBlob({ type: 'image/png' });
  return { ok: true, blob, painted: !!canvas, meta: meta() };
}

/**
 * Render a run of recent scans into finished frames, newest last.
 *
 * Each frame is sent back as it is ready rather than all at the end, so the
 * loop can start playing as soon as there are two of them instead of waiting
 * for the whole run to download. A volume at a time, because holding five
 * decoded volumes at once is hundreds of megabytes for no gain — once a frame
 * is a PNG, the volume behind it can go.
 */
async function loop({ site, product = 'reflectivity', count = 5, view, palette }, post) {
  const id = String(site || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(id)) return { ok: false, reason: '"' + site + '" is not a radar id' };

  const found = await listRecentVolumes(id, count);
  if (!found.urls || !found.urls.length) return { ok: false, reason: found.reason || 'no scans listed' };

  let made = 0;
  for (const url of found.urls) {            // oldest first, as the archive lists them
    let r;
    try {
      r = await loadSweepFromUrl({ url, site: id, product });
    } catch (err) {
      // One bad scan costs one frame, not the loop.
      post({ type: 'frame', ok: false, reason: (err && err.message) || String(err) });
      continue;
    }
    const canvas = rasterize(r, {
      width: view.width, height: view.height, projection: projectionFor(view),
    }, { quality: view.quality, smooth: true, minDbz: view.minDbz, palette: palette || null });
    const out = canvas || new OffscreenCanvas(2, 2);
    const blob = await out.convertToBlob({ type: 'image/png' });

    /*
     * The frame is a PNG now, so the volume behind it — hundreds of megabytes of
     * decoded sweeps — has done its job. Dropping the reference and clearing the
     * caches is what keeps a five-frame loop costing one volume instead of five.
     */
    radar = r;                 // newest wins, so a camera move redraws this one
    volumeUrl = url;
    releaseVolumeCaches();

    made++;
    post({
      type: 'frame', ok: true, blob,
      scanTime: r.time ? r.time.getTime() : null,
      volumeKey: url.split('/').pop(),
      painted: !!canvas,
      index: made, of: found.urls.length,
    });
  }
  return { ok: made > 0, frames: made, reason: made ? undefined : 'no frame could be drawn' };
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data || {};
  let result;
  try {
    await ready;              // the decoder, which may still be loading
    if (type === 'load') result = await load(payload || {});
    else if (type === 'draw') result = await draw(payload || {});
    else if (type === 'loop') {
      result = await loop(payload || {}, (frame) => self.postMessage({ id, frame }));
    }
    else if (type === 'clear') {
      radar = null; volumeUrl = null;
      releaseVolumeCaches();     // going back to the national view: hold nothing
      result = { ok: true };
    }
    else result = { ok: false, reason: 'unknown request: ' + type };
  } catch (err) {
    /*
     * Never throw out of the worker: an unattended page must keep whatever is
     * already on screen rather than go black because one scan failed. The stack
     * travels with the reason, because a failure in here is otherwise invisible
     * — the page only ever sees "it did not work".
     */
    const stack = String((err && err.stack) || '');
    result = {
      ok: false,
      reason: (err && err.message) || String(err),
      where: stack.split('\n').slice(0, 5).join(' | '),
    };
  }
  self.postMessage({ id, result });
};
