/*
 * components/satellite_ir.js
 * GOES-East ABI Band 13 "Clean" longwave infrared (10.3 µm), as a looping
 * overlay, for pages that are not part of the app bundle — the 24/7 broadcast
 * above all.
 *
 * The app has its own copy of this in app/satellite/goes_ir.js, because that
 * one is CommonJS and bundled while this is a module served as it stands. What
 * they must NOT have two of is the colour table, so that lives in
 * components/ir_colormap.json and both read it.
 *
 * WHAT THE SERVICE SENDS, since it is the whole basis of this: not greyscale.
 * NASA GIBS renders Band 13 through its own published enhancement — greys for
 * low cloud and the surface, then cyan, green, yellow, orange, red, a grey
 * wedge, magenta and white as tops get colder. All 237 entries are distinct
 * colours, so a pixel's colour recovers its brightness temperature exactly,
 * and the overlay hides cloud by how COLD it is rather than how bright it
 * looks. Doing it by brightness erases the coldest tops, which are dark reds
 * and magentas — the core of every deep storm.
 *
 * Verified against the live service before this was written:
 *   - a time with no scan answers 200 with a fully transparent PNG, so an
 *     empty frame is recognised by its pixels, not its status;
 *   - a time between steps snaps to the nearest scan, so frames must be asked
 *     for on the exact ten-minute grid or the same picture arrives twice;
 *   - the feed runs roughly half an hour behind, and by a varying amount, so
 *     the newest scan is found by probing rather than assumed.
 */

const WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
const LAYER_NAME = 'GOES-East_ABI_Band13_Clean_Infrared';
const SRC = 'goes-ir-src';
const LAYER = 'goes-ir-layer';

const SCAN_MS = 10 * 60 * 1000;    // the service's own cadence
const PROBE_BACK = 18;             // three hours; past that the feed is down

/* Where cloud starts being drawn, in °C of brightness temperature. Above WARM_C
   is ground, sea and anything at their temperature: not drawn, so the map below
   stays readable. Solid by COLD_C, which is just warmer than where the
   enhancement's colours begin, so every coloured band is at full strength. */
const WARM_C = 15;
const COLD_C = -25;

let _table = null;                 // [[r,g,b,degC], ...]
let _lut = null;                   // RGB(5 bits each) -> alpha
let _state = null;                 // the live overlay, or null

function merc(lon, lat) {
    const x = lon * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
    return [x, y];
}

export function scanTime(ms) { return Math.floor(ms / SCAN_MS) * SCAN_MS; }

function url(dom, width, at) {
    const [minx, miny] = merc(dom.W, dom.S);
    const [maxx, maxy] = merc(dom.E, dom.N);
    const height = Math.round(width * (maxy - miny) / (maxx - minx));
    const p = new URLSearchParams({
        SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
        LAYERS: LAYER_NAME, CRS: 'EPSG:3857',
        BBOX: `${minx},${miny},${maxx},${maxy}`,
        WIDTH: width, HEIGHT: height, FORMAT: 'image/png',
    });
    // A fixed scan never changes, so it is cached hard. Only the open-ended
    // request needs busting, where that is the entire point of it.
    if (at) p.set('TIME', new Date(at).toISOString().replace(/\.\d+Z$/, 'Z'));
    else p.set('_', String(Date.now()));
    return WMS + '?' + p.toString();
}

async function table() {
    if (_table) return _table;
    const r = await fetch('/components/ir_colormap.json', { cache: 'force-cache' });
    const j = await r.json();
    _table = j.table;
    return _table;
}

function alphaForC(c) {
    if (c >= WARM_C) return 0;
    if (c <= COLD_C) return 255;
    return Math.round((WARM_C - c) / (WARM_C - COLD_C) * 255);
}

/*
 * Opacity for any colour, by nearest table entry, over RGB quantised to five
 * bits a channel. Nearest rather than exact because the server resamples to
 * the size asked for, which blends neighbouring bands along their edges; an
 * exact lookup would miss those and punch holes through the cloud.
 */
async function lut() {
    if (_lut) return _lut;
    const T = await table();
    const out = new Uint8Array(1 << 15);
    for (let r = 0; r < 256; r += 8) {
        for (let g = 0; g < 256; g += 8) {
            for (let b = 0; b < 256; b += 8) {
                let best = 0, bestD = Infinity;
                for (let i = 0; i < T.length; i++) {
                    const e = T[i];
                    const dr = e[0] - r, dg = e[1] - g, db = e[2] - b;
                    const d = dr * dr + dg * dg + db * db;
                    if (d < bestD) { bestD = d; best = i; }
                }
                out[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)] = alphaForC(T[best][3]);
            }
        }
    }
    _lut = out;
    return _lut;
}

/** Load one scan and set its opacity from temperature. null if nothing is there. */
async function frameUrl(dom, width, at) {
    const L = await lut();
    const img = await new Promise((resolve) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i);
        i.onerror = () => resolve(null);
        i.src = url(dom, width, at);
    });
    if (!img) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = data.data;
    let present = 0;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        present++;
        d[i + 3] = L[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)];
    }
    // A time with no scan behind it comes back fully transparent and a 200.
    if (!present) return null;
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
}

/** Cheap existence check: 32px wide, a couple of kilobytes. */
async function exists(dom, at) {
    return await new Promise((resolve) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => {
            try {
                const c = document.createElement('canvas');
                c.width = i.width; c.height = i.height;
                const x = c.getContext('2d');
                x.drawImage(i, 0, 0);
                const d = x.getImageData(0, 0, c.width, c.height).data;
                for (let k = 3; k < d.length; k += 4) if (d[k]) { resolve(true); return; }
                resolve(false);
            } catch (e) { resolve(false); }
        };
        i.onerror = () => resolve(false);
        i.src = url(dom, 32, at);
    });
}

async function newestScan(dom) {
    let at = scanTime(Date.now());
    for (let i = 0; i < PROBE_BACK; i++) {
        if (await exists(dom, at)) return at;
        at -= SCAN_MS;
    }
    return null;
}

function maps(st) {
    const w = st.wrapper || window.vortexMap || {};
    return w.map ? [w.map] : [];
}

function corners(dom) {
    return [[dom.W, dom.N], [dom.E, dom.N], [dom.E, dom.S], [dom.W, dom.S]];
}

function paint(st, url_) {
    for (const map of maps(st)) {
        const src = map.getSource(SRC);
        if (src) { src.updateImage({ url: url_, coordinates: corners(st.dom) }); continue; }
        map.addSource(SRC, { type: 'image', url: url_, coordinates: corners(st.dom) });
        map.addLayer({
            id: LAYER, type: 'raster', source: SRC,
            paint: { 'raster-opacity': st.opacity, 'raster-fade-duration': 0 },
        }, st.beforeId && map.getLayer(st.beforeId) ? st.beforeId : undefined);
    }
}

function showFrame(st, at) {
    const fr = st.frames.get(at);
    if (!fr) return;
    paint(st, fr.url);
    st.shown = at;
    if (typeof st.onFrame === 'function') { try { st.onFrame(at, st.frames.size); } catch (e) { /* a readout must not stop the loop */ } }
}

function stepLoop(st) {
    const times = [...st.frames.keys()].sort((a, b) => a - b);
    if (times.length < 2) return;
    const i = times.indexOf(st.shown);
    const next = times[(i + 1) % times.length];
    showFrame(st, next);
    const last = next === times[times.length - 1];
    st.timer = setTimeout(() => stepLoop(st), last ? st.holdMs : st.stepMs);
}

function play(st) {
    stop(st);
    if (!st.playing || st.frames.size < 2) return;
    st.timer = setTimeout(() => stepLoop(st), st.stepMs);
}

function stop(st) {
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
}

/*
 * Top up rather than rebuild: a refresh is normally one new scan arriving and
 * one falling off the back, and re-fetching the whole run every time would be
 * megabytes to change one picture — and would drop the loop while it happened.
 */
async function sync(st) {
    const token = ++st.token;
    const newest = await newestScan(st.dom);
    if (!newest || token !== st.token || !st.active) return;

    const want = [];
    for (let i = st.count - 1; i >= 0; i--) want.push(newest - i * SCAN_MS);

    for (const at of [...st.frames.keys()]) {
        if (want.indexOf(at) !== -1) continue;
        const fr = st.frames.get(at);
        st.frames.delete(at);
        try { URL.revokeObjectURL(fr.url); } catch (e) { /* already gone */ }
    }

    // Newest first, so something is on screen at once and the rest fills in
    // behind it. One at a time: several multi-megabyte decodes together would
    // take the page with them, and this one has to stream.
    for (const at of want.slice().reverse()) {
        if (token !== st.token || !st.active) return;
        if (st.frames.has(at)) continue;
        const u = await frameUrl(st.dom, st.width, at);
        if (!u) continue;
        if (token !== st.token || !st.active) { URL.revokeObjectURL(u); return; }
        st.frames.set(at, { url: u });
        if (st.shown === null) { showFrame(st, at); play(st); }
    }
    if (st.shown === null || !st.frames.has(st.shown)) showFrame(st, newest);
    play(st);
}

/**
 * Put the IR overlay on the map and keep it looping.
 *
 * opts: { domain, width, count, stepMs, holdMs, opacity, beforeId, onFrame }
 */
export function addSatelliteIR(mapWrapper, opts = {}) {
    removeSatelliteIR();
    _state = {
        wrapper: mapWrapper || window.vortexMap,
        dom: opts.domain || { W: -128, E: -62, S: 18, N: 52 },
        width: opts.width || 1800,
        count: Math.max(1, opts.count || 6),
        stepMs: opts.stepMs || 420,
        holdMs: opts.holdMs || 1400,
        opacity: opts.opacity == null ? 0.95 : opts.opacity,
        beforeId: opts.beforeId || null,
        onFrame: opts.onFrame || null,
        frames: new Map(),
        shown: null,
        playing: opts.playing !== false,
        timer: null,
        refresh: null,
        token: 0,
        active: true,
    };
    sync(_state);
    _state.refresh = setInterval(() => { if (_state && _state.active) sync(_state); }, 5 * 60 * 1000);
    return _state;
}

export function removeSatelliteIR() {
    const st = _state;
    if (!st) return;
    st.active = false;
    st.token++;
    stop(st);
    if (st.refresh) clearInterval(st.refresh);
    for (const map of maps(st)) {
        try {
            if (map.getLayer(LAYER)) map.removeLayer(LAYER);
            if (map.getSource(SRC)) map.removeSource(SRC);
        } catch (e) { /* the map went first */ }
    }
    for (const fr of st.frames.values()) {
        try { URL.revokeObjectURL(fr.url); } catch (e) { /* already gone */ }
    }
    st.frames.clear();
    _state = null;
}

/** For a readout: how many frames, which one is up, and when it was taken. */
export function satelliteState() {
    if (!_state) return { frames: 0, shown: null, playing: false };
    return {
        frames: _state.frames.size,
        shown: _state.shown,
        playing: !!_state.timer,
        newest: _state.frames.size
            ? Math.max(...[..._state.frames.keys()])
            : null,
    };
}
