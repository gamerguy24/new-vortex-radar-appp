/*
 * goes_ir.js
 * GOES-East ABI Band 13 "Clean" Longwave IR window (10.3 µm) overlay, from
 * NASA GIBS' near-real-time imagery.
 *
 * WHAT GIBS ACTUALLY SENDS, because this was wrong before and it mattered:
 * not a greyscale image. GIBS renders Band 13 through its own published
 * enhancement (see ir_colormap.js) — greys for warm low cloud and the surface,
 * then cyan, green, yellow, orange, red, a grey wedge, magenta and white as
 * cloud tops get colder. That enhancement is the thing a viewer reads a storm
 * from: the difference between a -40 °C anvil and a -80 °C overshooting top is
 * the difference between rain and a tornado warning, and it is written in
 * colour, not in brightness.
 *
 * The overlay used to decide what to hide from each pixel's LUMINANCE. On a
 * coloured image that is close to the worst possible rule, because the colours
 * marking the coldest tops are dark: dark red (230,0,0) has a luminance of 69,
 * magenta (127,0,127) has 53, and both fell under the old cutoff of 92 and
 * were erased outright. Checked against the real table: 32 of its 74 coloured
 * bands, spanning -91 °C to -25 °C, were being deleted — which is to say the
 * core of every deep storm, while the harmless warm cloud around it stayed.
 *
 * So opacity comes from TEMPERATURE now. The table is a bijection — 237
 * entries, 237 distinct colours — so a pixel's colour recovers its brightness
 * temperature exactly, and a cloud top is hidden or shown according to how
 * cold it is, which is the only thing that should decide it. The colours
 * themselves are passed through untouched.
 */

const map = require('../core/map/map');
const { IR_TABLE } = require('./ir_colormap');

const SRC = 'goes19_clean_ir_src';
const LAYER = 'goes19_clean_ir_layer';
const LEGEND_ID = 'vortexSatLegend';
const COLLAPSE_KEY = 'vortexSatLegendCollapsed';
const PRODUCT_KEY = 'vortexSatProduct';

/*
 * What can be shown, and how each has to be treated.
 *
 * `enhanced` is the distinction that matters: Band 13 is NASA's enhancement
 * of a single temperature channel, so its colours are data and this file
 * reads them back. GeoColor is a finished picture — true colour by day, an
 * infrared blend and city lights by night — with nothing to read out of it
 * and nothing to recolour.
 */
const PRODUCTS = {
    ir: {
        wms: 'GOES-East_ABI_Band13_Clean_Infrared',
        label: 'Infrared',
        name: 'GOES-East Band 13 · Clean Infrared',
        enhanced: true,
    },
    geocolor: {
        wms: 'GOES-East_ABI_GeoColor',
        label: 'GeoColor',
        name: 'GOES-East · GeoColor',
        enhanced: false,
    },
};

function storedProduct() {
    try {
        const v = localStorage.getItem(PRODUCT_KEY);
        return PRODUCTS[v] ? v : 'ir';
    } catch (e) { return 'ir'; }
}
let _product = storedProduct();
function product() { return PRODUCTS[_product]; }

// GOES-East domain we render (CONUS + Gulf + nearby Atlantic, useful for storms).
const DOM = { W: -128, E: -62, S: 18, N: 52 };
const CORNERS = [[DOM.W, DOM.N], [DOM.E, DOM.N], [DOM.E, DOM.S], [DOM.W, DOM.S]];

/*
 * 2000px across 66° of longitude is about 3 km per pixel, against ABI's
 * native 2 km — sharper than the 1600 this used to draw, and deliberately
 * short of the 2.5 km it could have, because every frame of the loop is
 * decoded and pushed to the GPU each time it comes round. Sharpness that
 * costs the loop its smoothness is a bad trade on a weather map.
 */
const IMG_WIDTH = 2000;

/*
 * Where cloud starts being drawn, in °C of brightness temperature.
 *
 * Above WARM_C is the ground, the sea and whatever sits at their temperature:
 * drawn not at all, so the map underneath is readable. From there opacity ramps
 * in with falling temperature, and by COLD_C — which is just warmer than where
 * the enhancement's colours begin — it is solid, so every coloured band is at
 * full strength. Low cloud therefore veils the map; a thunderstorm covers it.
 */
const WARM_C = 15;
const COLD_C = -25;

/*
 * The loop.
 *
 * SCAN_MS is the service's own cadence, not a choice: a request off that
 * grid is snapped to the nearest scan, so stepping by anything else would
 * fetch the same picture twice. An hour of frames is enough to see which way
 * a storm is building without holding a morning of imagery in memory.
 */
const SCAN_MS = 10 * 60 * 1000;
const FRAMES = 6;
const STEP_MS = 420;            // how long each frame is held
const HOLD_LAST_MS = 1400;      // and the pause on the newest, as loops do
const PROBE_BACK = 18;          // three hours; past that the feed is down

let _enabled = false;
let _timer = null;             // the refresh clock
let _playTimer = null;         // the loop clock
let _alphaLut = null;
let _greyLut = null;

// time (epoch ms) -> { url }. The newest scan is the last key.
const _frames = new Map();
let _shown = null;             // which frame is on the map
let _playing = true;
let _token = 0;                // bumped to orphan work from a previous run
let _followTimer = null;       // watches the app player
let _following = false;

function merc(lon, lat) {
    const x = lon * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
    return [x, y];
}

/** The ten-minute grid the service publishes on. */
function scanTime(ms) { return Math.floor(ms / SCAN_MS) * SCAN_MS; }

/*
 * `at` is a scan time, or null for whatever is newest.
 *
 * A frame of the loop is cached hard: it is a fixed ten-minute scan and will
 * never change again, so the cache-buster belongs only on the open-ended
 * request, where it is the whole point.
 */
function wmsUrl(width, at) {
    const [minx, miny] = merc(DOM.W, DOM.S);
    const [maxx, maxy] = merc(DOM.E, DOM.N);
    const height = Math.round(width * (maxy - miny) / (maxx - minx));
    const p = new URLSearchParams({
        SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
        LAYERS: product().wms,
        CRS: 'EPSG:3857', BBOX: `${minx},${miny},${maxx},${maxy}`,
        WIDTH: width, HEIGHT: height, FORMAT: 'image/png',
    });
    if (at) p.set('TIME', new Date(at).toISOString().replace(/\.\d+Z$/, 'Z'));
    else p.set('_', String(Date.now()));
    return 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?' + p.toString();
}

/*
 * Greys, at full resolution, because this is where the table is subtle.
 *
 * The enhancement's -70 to -79 °C wedge is grey, and its levels sit one or
 * two away from warm greys meaning the opposite: 102 is -74.1 °C and 100 is
 * +18.9 °C. Eight-level buckets put those together and the warm one won, so
 * the inside of every deep storm was drawn transparent. 256 entries is a
 * quarter of a kilobyte and removes the whole class of error.
 */
function greyLut() {
    if (_greyLut) return _greyLut;
    const greys = IR_TABLE.filter((e) => e[0] === e[1] && e[1] === e[2]);
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

/** How opaque a cloud top at `c` °C should be drawn. */
function alphaForC(c) {
    if (c >= WARM_C) return 0;
    if (c <= COLD_C) return 255;
    return Math.round((WARM_C - c) / (WARM_C - COLD_C) * 255);
}

/*
 * Opacity for any colour, by nearest entry in the table.
 *
 * Built once, over RGB quantised to five bits a channel — 32,768 cells, each
 * resolved against all 237 entries. A nearest match rather than an exact one
 * because the server resamples our requested size, which blends neighbouring
 * bands along their edges; those blends land on one side or the other, one
 * degree out, on a one-pixel boundary. An exact lookup would instead fail and
 * leave holes in the cloud wherever it had been resized.
 */
function alphaLut() {
    if (_alphaLut) return _alphaLut;
    const lut = new Uint8Array(1 << 15);
    for (let r = 0; r < 256; r += 8) {
        for (let g = 0; g < 256; g += 8) {
            for (let b = 0; b < 256; b += 8) {
                let best = 0, bestD = Infinity;
                for (let i = 0; i < IR_TABLE.length; i++) {
                    const e = IR_TABLE[i];
                    const dr = e[0] - r, dg = e[1] - g, db = e[2] - b;
                    const d = dr * dr + dg * dg + db * db;
                    if (d < bestD) { bestD = d; best = i; }
                }
                lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)] = alphaForC(IR_TABLE[best][3]);
            }
        }
    }
    _alphaLut = lut;
    return lut;
}

/*
 * Fetch the scan and set each pixel's opacity from its temperature. cb(url|null).
 *
 * toBlob rather than toDataURL: this canvas is 2400px across, and encoding one
 * that size to base64 blocks the page for long enough to be seen.
 */
function buildImage(at, cb) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        try {
            /*
             * A finished picture goes to the map as it came, which skips the
             * decode, the recolour and the re-encode entirely. It is still
             * checked for blankness, on a small scratch canvas — the service
             * serves the odd empty frame whatever the product.
             */
            if (!product().enhanced) {
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
                if (!seen || same / seen > 0.9) { cb(null); return; }
                cb(img.src);
                return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imgData.data;
            const lut = alphaLut();
            const grey = greyLut();
            let present = 0;
            // How dominated is this frame by one colour? A real scan is not:
            // measured, 73,177 distinct colours with the commonest at 2.6%.
            let first = -1, firstCount = 0;
            for (let i = 0; i < d.length; i += 4) {
                // Nothing there to begin with stays nothing: off the disk, or
                // a gap between scans.
                if (d[i + 3] === 0) continue;
                present++;
                const r = d[i], g = d[i + 1], b = d[i + 2];
                const packed = (r << 16) | (g << 8) | b;
                if (first < 0) first = packed;
                if (packed === first) firstCount++;
                /*
                 * Grey gets the full-resolution table. Its cold wedge and its
                 * warm end are a level or two apart and mean opposite things,
                 * so a quantised lookup confuses them and erases storm cores.
                 */
                d[i + 3] = (r === g && g === b)
                    ? grey[r]
                    : lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
            }
            // A time with no scan behind it comes back as a fully transparent
            // image and a 200, so emptiness is a property of the pixels. Airing
            // one would put a hole in the middle of the loop.
            if (!present) { cb(null); return; }
            /*
             * And a blank frame is just as useless, while looking like data.
             * Verified on the real service: one scan came back with a single
             * value, 255,255,255,255, over every pixel — and white is -91.1 °C
             * here, the coldest reading in the table, so it painted the whole
             * domain opaque. That was the white flash, and the white wall.
             *
             * Judged on the SHARE held by the commonest colour rather than on
             * the colour count, because a blank with a trace of variation in it
             * passed a count and looked identical on screen.
             */
            if (firstCount / present > 0.9) {
                console.warn('[GOES] a blank frame was served ('
                    + Math.round(100 * firstCount / present) + '% one colour); skipping it');
                cb(null); return;
            }
            ctx.putImageData(imgData, 0, 0);
            canvas.toBlob((blob) => {
                if (!blob) { cb(null); return; }
                cb(URL.createObjectURL(blob));
            }, 'image/png');
        } catch (e) { console.warn('[GOES] recolor failed:', e); cb(null); }
    };
    img.onerror = () => { console.warn('[GOES] image load failed'); cb(null); };
    img.src = wmsUrl(IMG_WIDTH, at);
}

function _beforeId() {
    for (const id of ['radar-webgl', 'baseReflectivity']) {
        if (map.getLayer(id)) return id;
    }
    return undefined;
}

function clearLegend() {
    const el = document.getElementById(LEGEND_ID);
    if (el) el.remove();
}

/* Folded or not, from last time. Storage can be unavailable; open is the
   safe answer, since a scale nobody asked to hide should be visible. */
function legendFolded() {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) { return false; }
}

function foldLegend(el, folded) {
    el.classList.toggle('vml-folded', folded);
    const btn = el.querySelector('.vml-toggle');
    if (btn) {
        btn.textContent = folded ? '\u2039' : '\u203A';
        const label = folded ? 'Show the temperature scale' : 'Hide the temperature scale';
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
    }
    try { localStorage.setItem(COLLAPSE_KEY, folded ? '1' : '0'); } catch (e) { /* private mode */ }
}

/*
 * The time of the frame ON SCREEN, which during a loop is not the newest one
 * held — they differ by up to an hour, and a radar or satellite picture
 * labelled with the wrong time is worse than one labelled with none.
 */
function setLegendTime(at) {
    const el = document.getElementById(LEGEND_ID);
    if (!el) return;
    const slot = el.querySelector('.vml-when');
    if (!slot) return;
    const d = new Date(at);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const age = Math.round((Date.now() - at) / 60000);
    slot.textContent = `${hh}:${mm}Z · ${age < 1 ? 'just now' : age + ' min ago'}`;
}

function setPlaying(el, on) {
    _playing = on;
    const btn = el.querySelector('.vml-play');
    if (btn) {
        btn.textContent = on ? '\u2016' : '\u25B6';
        const label = on ? 'Pause the satellite loop' : 'Play the satellite loop';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    }
    if (on) startPlaying(); else stopPlaying();
}

/*
 * Change product, and start that one from nothing.
 *
 * The frames in hand are pictures of a different kind and cannot be mixed
 * with the new ones — a loop that alternated infrared and GeoColor would be
 * unreadable — so they are thrown away and the run begins again. The choice
 * is remembered, because it is a preference rather than a moment.
 */
/*
 * Let a frame go.
 *
 * revokeObjectURL on a plain https URL is a no-op, which is what makes this
 * safe for both products: the infrared frames are blobs we made and must
 * release, and the GeoColor ones are the service's own URLs, passed through
 * untouched and owned by nobody.
 */
function dropFrame(at) {
    const fr = _frames.get(at);
    if (!fr) return;
    _frames.delete(at);
    try { URL.revokeObjectURL(fr.url); } catch (e) { /* already gone */ }
}

function setProduct(next) {
    if (!PRODUCTS[next] || next === _product) return;
    _product = next;
    try { localStorage.setItem(PRODUCT_KEY, next); } catch (e) { /* not remembered, still applied */ }
    _token++;                 // orphan anything still downloading
    stopPlaying();
    for (const at of [..._frames.keys()]) dropFrame(at);
    _shown = null;
    drawLegend();             // the scale belongs to the product
    if (_enabled) sync();
}

/*
 * The scale, because an enhancement nobody can read is just a colourful cloud.
 *
 * Cold on the left, warm on the right, the way every published IR scale is
 * drawn. Every fourth entry is enough for a smooth bar and keeps the gradient
 * from running to several thousand characters.
 */
function drawLegend() {
    clearLegend();
    const warm = IR_TABLE[IR_TABLE.length - 1][3];
    const cold = IR_TABLE[0][3];
    const span = (warm - cold) || 1;
    const stops = [];
    for (let i = 0; i < IR_TABLE.length; i += 4) {
        const e = IR_TABLE[i];
        stops.push(`rgb(${e[0]},${e[1]},${e[2]}) ${((e[3] - cold) / span * 100).toFixed(1)}%`);
    }
    const el = document.createElement('div');
    el.id = LEGEND_ID;
    /*
     * The arrow sits outside the body it hides, so that folding leaves it
     * behind rather than taking it with it — a control that disappears when
     * used cannot be used twice.
     */
    /*
     * Only the infrared gets a temperature bar. Its colours are temperatures,
     * so the bar is what makes it readable. GeoColor is a picture — true
     * colour by day, infrared and city lights by night — and a temperature
     * scale beside it would be inventing a meaning its colours do not carry.
     */
    const scale = product().enhanced
        ? `<div class="vml-title">SATELLITE · CLOUD TOP TEMPERATURE <span style="opacity:.6">(°C)</span></div>
        <div class="vml-bar" style="background:linear-gradient(90deg, ${stops.join(', ')})"></div>
        <div class="vml-scale"><span>-90</span><span>-60</span><span>-30</span><span>0</span><span>+30</span></div>`
        : '<div class="vml-title">SATELLITE · GEOCOLOR</div>'
          + '<div class="vml-note">True colour by day, infrared and city lights by night.</div>';

    const pick = (id) => `<button class="vml-pick${_product === id ? ' on' : ''}"
        type="button" data-product="${id}">${PRODUCTS[id].label}</button>`;

    el.innerHTML = `<div class="vml-body">
        ${scale}
        <div class="vml-picks">${pick('geocolor')}${pick('ir')}</div>
        <div class="vml-age">${product().name} · <span class="vml-when">loading…</span></div>
      </div>
      <div class="vml-btns">
        <button class="vml-play" type="button"></button>
        <button class="vml-toggle" type="button"></button>
      </div>`;
    el.querySelector('.vml-toggle')
        .addEventListener('click', () => foldLegend(el, !el.classList.contains('vml-folded')));
    el.querySelector('.vml-play')
        .addEventListener('click', () => setPlaying(el, !_playing));
    for (const b of el.querySelectorAll('.vml-pick')) {
        b.addEventListener('click', () => setProduct(b.dataset.product));
    }
    document.body.appendChild(el);
    foldLegend(el, legendFolded());
    setPlaying(el, _playing);
}

/*
 * Is there a scan at this time? Asked at 32x21, which is a couple of
 * kilobytes.
 *
 * It has to be asked, because how far behind the newest scan runs varies with
 * the pipeline, and a time with nothing behind it answers 200 with a fully
 * transparent image rather than an error. Guessing would put a hole in the
 * loop; this costs one small request to be sure.
 */
function probe(at) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                const x = c.getContext('2d');
                x.drawImage(img, 0, 0);
                const d = x.getImageData(0, 0, c.width, c.height).data;
                for (let i = 3; i < d.length; i += 4) if (d[i]) { resolve(true); return; }
                resolve(false);
            } catch (e) { resolve(false); }
        };
        img.onerror = () => resolve(false);
        img.src = wmsUrl(32, at);
    });
}

/** The newest scan actually published, walking back from now. */
async function newestScan() {
    let at = scanTime(Date.now());
    for (let i = 0; i < PROBE_BACK; i++) {
        if (await probe(at)) return at;
        at -= SCAN_MS;
    }
    return null;
}

function putOnMap(url) {
    const src = map.getSource(SRC);
    if (src) { src.updateImage({ url, coordinates: CORNERS }); return; }
    map.addSource(SRC, { type: 'image', url, coordinates: CORNERS });
    map.addLayer({
        id: LAYER, type: 'raster', source: SRC,
        paint: { 'raster-opacity': 0.95, 'raster-fade-duration': 0 },
    }, _beforeId());
}

function showFrame(at) {
    const fr = _frames.get(at);
    if (!fr) return;
    putOnMap(fr.url);
    _shown = at;
    setLegendTime(at);
}

/** Play through what we have, oldest first, pausing on the newest. */
function step() {
    const times = [..._frames.keys()].sort((a, b) => a - b);
    if (!times.length) return;
    const i = times.indexOf(_shown);
    const next = times[(i + 1) % times.length];
    showFrame(next);
    const last = next === times[times.length - 1];
    _playTimer = setTimeout(step, last ? HOLD_LAST_MS : STEP_MS);
}

function startPlaying() {
    stopPlaying();
    // Not while the app player is driving: two clocks on one map is how the
    // satellite ended up animating against the radar instead of with it.
    if (_following || !_playing || _frames.size < 2) return;
    _playTimer = setTimeout(step, STEP_MS);
}

/** The scan nearest a moment in time, which is how the two loops line up. */
function nearestFrame(ms) {
    let best = null, bestD = Infinity;
    for (const at of _frames.keys()) {
        const d = Math.abs(at - ms);
        if (d < bestD) { bestD = d; best = at; }
    }
    return best;
}

/*
 * Follow the player at the bottom of the screen.
 *
 * Polled rather than subscribed, because the player does not announce
 * itself and reaching into it to make it would couple the two together for
 * no gain. Four times a second is below what anyone can see and costs a
 * property read.
 */
function followTick() {
    const vl = (typeof window !== 'undefined') ? window.vortexLoop : null;
    const at = (vl && vl.count > 1) ? vl.frameTime : null;

    if (at === null) {
        // Nothing in the player: the satellite is on its own again.
        if (_following) { _following = false; markFollowing(); startPlaying(); }
        return;
    }
    if (!_following) { _following = true; markFollowing(); stopPlaying(); }

    const want = nearestFrame(at);
    if (want !== null && want !== _shown) showFrame(want);
}

/** Frame times, oldest first — the order the player scrubs through. */
function sortedTimes() {
    return [..._frames.keys()].sort((a, b) => a - b);
}

/* Play or pause, through the legend button when there is one, so the two
   controls can never disagree about which state they are in. */
function applyPlaying(on) {
    const el = document.getElementById(LEGEND_ID);
    if (el) { setPlaying(el, on); return; }
    _playing = on;
    if (on) startPlaying(); else stopPlaying();
}

/*
 * What the app player needs in order to drive this layer.
 *
 * It takes over only while the radar loop is empty, so this is what the
 * controls do when satellite is the only thing on the map.
 */
function playerDriver() {
    return {
        count: () => _frames.size,
        index: () => {
            const t = sortedTimes();
            const i = t.indexOf(_shown);
            return i < 0 ? Math.max(0, t.length - 1) : i;
        },
        isPlaying: () => !!_playTimer,
        play: () => applyPlaying(true),
        pause: () => applyPlaying(false),
        setIndex: (i) => {
            const t = sortedTimes();
            if (!t.length) return;
            // Wrapped, so stepping off either end comes round rather than
            // sticking, which is what the radar loop does.
            showFrame(t[((i % t.length) + t.length) % t.length]);
        },
        goLive: () => {
            const t = sortedTimes();
            if (!t.length) return;
            applyPlaying(false);
            showFrame(t[t.length - 1]);
        },
    };
}

/* The legend's own pause is meaningless while the player is driving. */
function markFollowing() {
    const el = document.getElementById(LEGEND_ID);
    if (el) el.classList.toggle('vml-following', _following);
}

function stopPlaying() {
    if (_playTimer) { clearTimeout(_playTimer); _playTimer = null; }
}

/*
 * Top up rather than rebuild.
 *
 * A refresh normally means one new scan has appeared and one has fallen off
 * the back. Re-fetching the whole hour each time would be twenty megabytes an
 * hour to change one picture, and would drop the loop on the floor while it
 * happened.
 */
async function sync() {
    const token = ++_token;
    const newest = await newestScan();
    if (!newest || token !== _token || !_enabled) return;

    const want = [];
    for (let i = FRAMES - 1; i >= 0; i--) want.push(newest - i * SCAN_MS);

    // Anything outside the window is gone for good; its blob goes with it.
    for (const at of [..._frames.keys()]) {
        if (want.indexOf(at) !== -1) continue;
        const fr = _frames.get(at);
        _frames.delete(at);
        try { URL.revokeObjectURL(fr.url); } catch (e) { /* already gone */ }
    }

    /*
     * Newest first, so there is a picture on screen as soon as possible and
     * the rest fills in behind it. One at a time: six of these at once is six
     * simultaneous multi-megabyte decodes, and the page has to stay usable.
     */
    for (const at of want.slice().reverse()) {
        if (token !== _token || !_enabled) return;
        if (_frames.has(at)) continue;
        const url = await new Promise((res) => buildImage(at, res));
        if (!url) continue;                       // no scan at that minute
        if (token !== _token || !_enabled) { URL.revokeObjectURL(url); return; }
        _frames.set(at, { url });
        if (_shown === null) { showFrame(at); startPlaying(); }
    }
    if (_shown === null || !_frames.has(_shown)) showFrame(newest);
    startPlaying();
}

function _remove() {
    stopPlaying();
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SRC)) map.removeSource(SRC);
    for (const fr of _frames.values()) {
        try { URL.revokeObjectURL(fr.url); } catch (e) { /* already gone */ }
    }
    _frames.clear();
    _shown = null;
    clearLegend();
}

function enable() {
    _enabled = true;
    _token++;
    drawLegend();
    sync();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => { if (_enabled) sync(); }, 5 * 60 * 1000);
    if (_followTimer) clearInterval(_followTimer);
    _followTimer = setInterval(followTick, 250);
    /*
     * Required here rather than at the top of the file: the player is radar's
     * module, and loading it the moment this file is parsed would tie the two
     * together at startup for something only wanted once this layer is on.
     */
    try {
        require('../radar/animation/radar_loop').setDriver(playerDriver());
    } catch (e) {
        console.warn('[GOES] could not reach the player:', e && e.message);
    }
}

function disable() {
    _enabled = false;
    _token++;
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_followTimer) { clearInterval(_followTimer); _followTimer = null; }
    _following = false;
    try {
        require('../radar/animation/radar_loop').setDriver(null);
    } catch (e) { /* it was never reached */ }
    _remove();
}

module.exports = { enable, disable };
