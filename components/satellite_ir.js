/*
 * components/satellite_ir.js
 * GOES ABI Band 13 "Clean" longwave infrared (10.3 µm), as a looping overlay,
 * for pages that are not part of the app bundle — the 24/7 broadcast above all.
 *
 * The app has its own copy in app/satellite/goes_ir.js, because that one is
 * CommonJS and bundled while this is a module served as it stands. What they
 * must NOT have two of is the colour table, so that lives in
 * components/ir_colormap.json and both read it.
 *
 * WHAT THE SERVICE SENDS, since it is the whole basis of this: not greyscale.
 * NASA GIBS renders Band 13 through its own published enhancement — greys for
 * low cloud and the surface, then cyan, green, yellow, orange, red, a grey
 * wedge, magenta and white as tops get colder. All 237 entries are distinct
 * colours, so a pixel's colour recovers its brightness temperature exactly,
 * and the overlay hides cloud by how COLD it is rather than how bright it
 * looks. Hiding by brightness erases the coldest tops, which are dark reds and
 * magentas — the core of every deep storm.
 *
 * Verified against the live service before this was written:
 *   - a time with no scan answers 200 with a fully transparent PNG, so an
 *     empty frame is recognised by its pixels, not its status;
 *   - a time between steps snaps to the nearest scan, so frames must be asked
 *     for on the exact ten-minute grid or the same picture arrives twice;
 *   - the feed runs roughly half an hour behind, and by a varying amount, so
 *     the newest scan is found by probing rather than assumed;
 *   - GOES-West publishes on the same grid, so the two satellites can share
 *     one clock.
 *
 * TWO SATELLITES, ONE LOOP. East and West are separate layers over separate
 * parts of the world, and running them as two overlays with two timers would
 * animate them out of step — the join between them would crawl. So there is
 * one set of frame times, and a time is only kept if EVERY satellite has a
 * scan for it. Fewer frames, all of them honest.
 */

const WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
const SCAN_MS = 10 * 60 * 1000;    // the service's own cadence
const PROBE_BACK = 18;             // three hours; past that the feed is down

/* Where cloud starts being drawn, in °C of brightness temperature. Above
   WARM_C is ground, sea and anything at their temperature: not drawn, so the
   map below stays readable. Solid by COLD_C, which is just warmer than where
   the enhancement's colours begin, so every coloured band is at full strength. */
const WARM_C = 15;
const COLD_C = -25;

export const GOES_EAST = 'GOES-East_ABI_Band13_Clean_Infrared';
export const GOES_WEST = 'GOES-West_ABI_Band13_Clean_Infrared';
export const GEO_EAST = 'GOES-East_ABI_GeoColor';
export const GEO_WEST = 'GOES-West_ABI_GeoColor';

let _table = null;
let _lut = null;
let _greyLut = null;
let _state = null;

function merc(lon, lat) {
    const x = lon * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
    return [x, y];
}

export function scanTime(ms) { return Math.floor(ms / SCAN_MS) * SCAN_MS; }

function url(src, width, at, format) {
    const dom = src.domain;
    const [minx, miny] = merc(dom.W, dom.S);
    const [maxx, maxy] = merc(dom.E, dom.N);
    const height = Math.round(width * (maxy - miny) / (maxx - minx));
    const p = new URLSearchParams({
        SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
        LAYERS: src.wms, CRS: 'EPSG:3857',
        BBOX: `${minx},${miny},${maxx},${maxy}`,
        WIDTH: width, HEIGHT: height, FORMAT: format || 'image/png',
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
    _table = (await r.json()).table;
    return _table;
}

/*
 * Greys, at full resolution. The enhancement's -70 to -79 °C wedge is grey
 * and its levels sit one or two from warm greys meaning the opposite — 102
 * is -74.1 °C, 100 is +18.9 °C — so a quantised lookup reads the inside of
 * a storm as warm ground and draws it transparent.
 */
async function greyLut() {
    if (_greyLut) return _greyLut;
    const T = await table();
    const greys = T.filter((e) => e[0] === e[1] && e[1] === e[2]);
    const out = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
        let best = greys[0], bd = Infinity;
        for (const g of greys) {
            const d = Math.abs(g[0] - v);
            if (d < bd) { bd = d; best = g; }
        }
        out[v] = alphaForC(best[3]);
    }
    _greyLut = out;
    return out;
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

/*
 * One scan, ready to go on the map. null if there is nothing usable there.
 *
 * An ENHANCEMENT (Band 13) has its opacity set from the temperature its
 * colours encode. A finished picture (GeoColor) is passed through as the
 * service sent it: there is nothing to read out of it, nothing to recolour,
 * and rewriting it would cost a decode and a re-encode for no change.
 */
async function frameUrl(src, width, at) {
    if (src.mode === 'rgb') return await rgbFrame(src, width, at);
    const L = await lut();
    const G = await greyLut();
    const img = await new Promise((resolve) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i);
        i.onerror = () => resolve(null);
        i.src = url(src, width, at);
    });
    if (!img) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = data.data;
    let present = 0;
    // How dominated is this frame by one colour? A real scan is not:
    // measured, 73,177 distinct colours with the commonest at 2.6%.
    let first = -1, firstCount = 0;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        present++;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const packed = (r << 16) | (g << 8) | b;
        if (first < 0) first = packed;
        if (packed === first) firstCount++;
        // Grey at full resolution; see greyLut.
        d[i + 3] = (r === g && g === b)
            ? G[r]
            : L[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
    }
    // A time with no scan behind it comes back fully transparent, and a 200.
    if (!present) return null;
    /*
     * And a solid frame looks like data and is not. Verified on the service:
     * the 16:40Z scan returned one distinct value, 255,255,255,255, over every
     * pixel — white being -91.1 °C, the coldest in the table, so it painted the
     * whole domain opaque. That was the white flash in the loop.
     */
    if (firstCount / present > 0.9) {
        console.warn('[GOES] a blank frame was served ('
            + Math.round(100 * firstCount / present) + '% one colour); skipping it');
        return null;
    }
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
}

/*
 * A finished picture, checked and handed over as it stands.
 *
 * Only the blankness test needs pixels, and that can be done on a thumbnail
 * — the service serves the odd empty or solid frame whatever the product,
 * and one of those drawn full-screen is the white wall again.
 */
async function rgbFrame(src, width, at) {
    /*
     * Fetched as BYTES and kept as a blob, not handed over as a URL.
     *
     * GIBS answers with "no-store", so a service URL given to the map is
     * downloaded again every time the loop reaches that frame. A blob is
     * local: one download, and every step after it is a decode. Passing the
     * URL through saved a decode and cost a network round trip per step,
     * which is the wrong way round.
     *
     * JPEG because this is a photograph: 454 KB against 3.4 MB as PNG at the
     * sizes asked for here. Safe because GeoColor covers the whole domain —
     * JPEG has no alpha and would paint black anywhere it did not.
     */
    const url_ = url(src, width, at, 'image/jpeg');
    const blob = await fetch(url_).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
    if (!blob || !blob.size) return null;
    const objectUrl = URL.createObjectURL(blob);
    const img = await new Promise((resolve) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => resolve(null);
        i.src = objectUrl;
    });
    if (!img) { URL.revokeObjectURL(objectUrl); return null; }
    const w = 64;
    const h = Math.max(1, Math.round(w * img.height / img.width));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, w, h);
    const q = x.getImageData(0, 0, w, h).data;
    let seen = 0, head = -1, same = 0;
    for (let i = 0; i < q.length; i += 4) {
        if (!q[i + 3]) continue;
        seen++;
        const packed = (q[i] << 16) | (q[i + 1] << 8) | q[i + 2];
        if (head < 0) head = packed;
        if (packed === head) same++;
    }
    if (!seen || same / seen > 0.9) { URL.revokeObjectURL(objectUrl); return null; }
    return objectUrl;
}

/** Cheap existence check: 32px wide, a couple of kilobytes. */
async function exists(src, at) {
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
        i.src = url(src, 32, at);
    });
}

/*
 * The newest scan the FIRST satellite has, and which of the others can see
 * their own patch at that moment.
 *
 * Requiring every satellite to have a frame is right when each can see the
 * place it is being asked about, and a disaster when one cannot: a layer
 * asked for a region outside its sector answers empty every time, which
 * rejected every scan there has ever been and left the map bare. A satellite
 * with nothing to show is dropped from the shot; the rest carry on together.
 */
async function newestCommon(st) {
    let at = scanTime(Date.now());
    for (let i = 0; i < PROBE_BACK; i++) {
        if (await exists(st.sources[0], at)) {
            const keep = [st.sources[0]];
            for (const src of st.sources.slice(1)) {
                if (await exists(src, at)) keep.push(src);
                else console.warn('[GOES] ' + src.wms + ' has nothing for this view; leaving it out');
            }
            st.sources = keep;
            return at;
        }
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

function paint(st, i, url_) {
    const src = st.sources[i];
    for (const map of maps(st)) {
        const existing = map.getSource(src.srcId);
        if (existing) { existing.updateImage({ url: url_, coordinates: corners(src.domain) }); continue; }
        map.addSource(src.srcId, { type: 'image', url: url_, coordinates: corners(src.domain) });
        map.addLayer({
            id: src.layerId, type: 'raster', source: src.srcId,
            paint: { 'raster-opacity': st.opacity, 'raster-fade-duration': 0 },
        }, st.beforeId && map.getLayer(st.beforeId) ? st.beforeId : undefined);
    }
}

function showFrame(st, at) {
    const fr = st.frames.get(at);
    if (!fr) return;
    for (let i = 0; i < st.sources.length; i++) {
        if (fr.urls[i]) paint(st, i, fr.urls[i]);
    }
    st.shown = at;
    if (typeof st.onFrame === 'function') {
        try { st.onFrame(at, st.frames.size); } catch (e) { /* a readout must not stop the loop */ }
    }
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
 * revokeObjectURL on a plain https URL is a no-op, which is what makes this
 * right for both kinds: the enhanced frames are blobs we built and must
 * release, and the finished ones are the service's own URLs, owned by
 * nobody and passed straight through.
 */
function dropFrame(st, at) {
    const fr = st.frames.get(at);
    if (!fr) return;
    st.frames.delete(at);
    for (const u of fr.urls) {
        if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* already gone */ } }
    }
}

/*
 * Top up rather than rebuild: a refresh is normally one new scan arriving and
 * one falling off the back, and re-fetching the whole run every time would be
 * megabytes to change one picture — and would drop the loop while it happened.
 */
async function sync(st) {
    const token = ++st.token;
    const newest = await newestCommon(st);
    if (!newest || token !== st.token || !st.active) return;

    const want = [];
    for (let i = st.count - 1; i >= 0; i--) want.push(newest - i * SCAN_MS);

    for (const at of [...st.frames.keys()]) {
        if (want.indexOf(at) === -1) dropFrame(st, at);
    }

    // Newest first, so something is on screen at once and the rest fills in
    // behind it. One at a time: several multi-megabyte decodes together would
    // take the page with them, and this one has to keep streaming.
    for (const at of want.slice().reverse()) {
        if (token !== st.token || !st.active) return;
        if (st.frames.has(at)) continue;

        const urls = [];
        let complete = true;
        for (const src of st.sources) {
            // A source may ask for fewer pixels than the rest: a narrow
            // domain at the edge of the frame does not need the detail
            // the one being watched does.
            const u = await frameUrl(src, src.width || st.width, at);
            if (token !== st.token || !st.active) {
                for (const v of urls) if (v) URL.revokeObjectURL(v);
                if (u) URL.revokeObjectURL(u);
                return;
            }
            if (!u) complete = false;
            urls.push(u);
        }
        /*
         * Every satellite or none. A frame with one half missing would show
         * one side of the country advancing while the other stood still,
         * which looks like a fault and is worse than a shorter loop.
         */
        if (!complete) {
            for (const v of urls) if (v) URL.revokeObjectURL(v);
            continue;
        }
        st.frames.set(at, { urls });
        if (st.shown === null) { showFrame(st, at); play(st); }
    }
    if (st.shown === null || !st.frames.has(st.shown)) {
        const times = [...st.frames.keys()].sort((a, b) => a - b);
        if (times.length) showFrame(st, times[times.length - 1]);
    }
    play(st);
}

/**
 * Put the IR overlay on the map and keep it looping.
 *
 * opts: { sources:[{wms,domain}], domain, width, count, stepMs, holdMs,
 *         opacity, beforeId, onFrame, playing }
 */
export function addSatelliteIR(mapWrapper, opts = {}) {
    removeSatelliteIR();
    const sources = (opts.sources && opts.sources.length
        ? opts.sources
        : [{ wms: GOES_EAST, domain: opts.domain || { W: -128, E: -62, S: 18, N: 52 } }]
    ).map((src, i) => ({
        wms: src.wms || GOES_EAST,
        domain: src.domain,
        width: src.width || null,
        // 'rgb' for a finished picture, anything else for an enhancement.
        mode: src.mode || 'ir',
        srcId: 'goes-ir-src-' + i,
        layerId: 'goes-ir-layer-' + i,
    }));

    _state = {
        wrapper: mapWrapper || window.vortexMap,
        sources,
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
        for (const src of st.sources) {
            try {
                if (map.getLayer(src.layerId)) map.removeLayer(src.layerId);
                if (map.getSource(src.srcId)) map.removeSource(src.srcId);
            } catch (e) { /* the map went first */ }
        }
    }
    for (const at of [...st.frames.keys()]) dropFrame(st, at);
    _state = null;
}

/** For a readout: how many frames, which one is up, and when it was taken. */
export function satelliteState() {
    if (!_state) return { frames: 0, shown: null, playing: false, newest: null };
    const times = [..._state.frames.keys()];
    return {
        frames: _state.frames.size,
        shown: _state.shown,
        playing: !!_state.timer,
        newest: times.length ? Math.max(...times) : null,
        satellites: _state.sources.length,
    };
}
