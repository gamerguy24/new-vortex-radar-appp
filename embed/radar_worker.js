/*
 * embed/radar_worker.js — decodes and draws one radar site's Level 2 for the
 * public embed, off the main thread.
 *
 * Same decoder and rasteriser as the app's Graphics Studio and the 24/7
 * broadcast (dist/l2_bundle.js + graphics/studio/engine/radar_l2_raster.js), so
 * the embed shows exactly what the radar page shows. The difference is where
 * the bytes come from: the embed has no server relay, so it lists and downloads
 * straight from the public unidata-nexrad-level2 bucket (CORS open). Nothing
 * passes through the Echo Radar box.
 *
 * Messages: { id, type: 'load', payload: { site, product } }
 *           { id, type: 'cover', payload: { width, minDbz } }  the radar's whole range
 *           { id, type: 'draw', payload: { view } }             one view, finer
 * Replies:  { id, result }
 */
globalThis.window = globalThis;   // the decoder bundle looks for window
const ready = import('/dist/l2_bundle.js?v=embed1');
import {
  listLatestVolume, loadSweepFromUrl, rasterize, paletteStops, setL2Bucket, setL2Relay, setCacheLimits, releaseVolumeCaches,
} from '/graphics/studio/engine/radar_l2_raster.js?v=embed4';

setL2Bucket('https://unidata-nexrad-level2.s3.amazonaws.com');
// No relay for the public embed: point the fallback at nothing rather than at
// a session-gated route.
setL2Relay('/embed/no-relay', { preferRelay: false });
// One volume at a time: an embed draws the newest scan and never looks back.
setCacheLimits({ volumes: 1, bytes: 1 });

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const invMercY = (y) => (2 * (Math.atan(Math.exp(y)) - Math.PI / 4)) * R2D;
// Web mercator for the view's bounds, the projection Mapbox draws in, so the
// picture pinned to the view corners lines up exactly.
function projectionFor(v) {
    const yTop = mercY(v.north), yBot = mercY(v.south);
    return { invert: ([x, y]) => [v.west + (x / v.width) * (v.east - v.west), invMercY(yTop + (y / v.height) * (yBot - yTop))] };
}

let radar = null, volumeUrl = null;

function meta() {
    const sw = radar && radar.sweep;
    return {
        site: radar ? radar.site : null,
        product: radar ? radar.product : null,
        scanTime: radar && radar.time ? radar.time.getTime() : null,
        elevationAngle: sw ? sw.elevationAngle : null,
        volumeKey: volumeUrl ? volumeUrl.split('/').pop() : null,
        // The colours the picture is drawn in, for the page's legend.
        legend: radar ? paletteStops(radar.code || (radar.product === 'velocity' ? 'VEL' : 'REF'), null, 24) : null,
    };
}

async function load({ site, product = 'reflectivity' }) {
    const id = String(site || '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(id)) return { ok: false, reason: `"${site}" is not a radar id` };
    const found = await listLatestVolume(id);
    if (!found.url) return { ok: false, reason: found.reason || 'no scan listed' };
    if (found.url === volumeUrl && radar && radar.site === id && radar.product === product) {
        return { ok: true, changed: false, meta: meta() };
    }
    radar = await loadSweepFromUrl({ url: found.url, site: id, product });
    volumeUrl = found.url;
    releaseVolumeCaches();
    return { ok: true, changed: true, meta: meta() };
}

// The box around the radar's furthest gate. Drawn once per scan, it sits
// under every view, so panning and zooming out never uncover a blank edge.
function coverageBox() {
    const ranges = radar.sweep && radar.sweep.ranges;
    const km = (ranges && ranges.length ? ranges[ranges.length - 1] : 460) + 2;
    const { lat, lon } = radar.location;
    const dLat = km / 111.32, dLon = km / (111.32 * Math.max(0.2, Math.cos(lat * D2R)));
    return { west: lon - dLon, east: lon + dLon, north: Math.min(85, lat + dLat), south: Math.max(-85, lat - dLat) };
}

async function cover({ width = 2400, minDbz }) {
    if (!radar) return { ok: false, reason: 'no scan loaded' };
    const box = coverageBox();
    // Height in mercator, so the square-in-km box keeps its true shape.
    const height = Math.max(1, Math.round(width * (mercY(box.north) - mercY(box.south)) / ((box.east - box.west) * D2R)));
    const view = { ...box, width, height };
    const canvas = rasterize(radar, { width, height, projection: projectionFor(view) },
        { quality: width, smooth: true, softEdges: true, minDbz, palette: null });
    const out = canvas || new OffscreenCanvas(2, 2);
    return { ok: true, blob: await out.convertToBlob({ type: 'image/png' }), box, meta: meta() };
}

async function draw({ view }) {
    if (!radar) return { ok: false, reason: 'no scan loaded' };
    const canvas = rasterize(radar, { width: view.width, height: view.height, projection: projectionFor(view) },
        { quality: view.quality, maxQuality: view.quality, smooth: true, softEdges: true, minDbz: view.minDbz, palette: null });
    const out = canvas || new OffscreenCanvas(2, 2);
    return { ok: true, blob: await out.convertToBlob({ type: 'image/png' }), painted: !!canvas, meta: meta() };
}

self.onmessage = async (e) => {
    const { id, type, payload } = e.data || {};
    let result;
    try {
        await ready;
        if (type === 'load') result = await load(payload || {});
        else if (type === 'draw') result = await draw(payload || {});
        else if (type === 'cover') result = await cover(payload || {});
        else if (type === 'clear') { radar = null; volumeUrl = null; releaseVolumeCaches(); result = { ok: true }; }
        else result = { ok: false, reason: 'unknown request: ' + type };
    } catch (err) {
        result = { ok: false, reason: (err && err.message) || String(err) };
    }
    self.postMessage({ id, result });
};
