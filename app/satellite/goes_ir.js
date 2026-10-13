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

/*
 * BANDS 7–16 come from somewhere else. GIBS publishes Band 13 and GeoColor
 * but none of the other infrared channels, so those are SSEC RealEarth's
 * GOES-East CONUS imagery (UW-Madison): every ABI band, every five minutes,
 * fetched as one picture of the view per scan (not tiles — see BAND_MAX_PX).
 * They are drawn as they come — the standard greyscale, cold and high is
 * bright — so none of the recolouring below applies to them. RealEarth's
 * terms ask for the credit line the legend carries.
 */

const map = require('../core/map/map');
const { IR_TABLE } = require('./ir_colormap');
const playback = require('../core/playback/playback_settings');

/*
 * The satellites, and the piece of the world each is asked for.
 *
 * They meet at 126W rather than overlapping: two rasters over the same
 * ground would double the opacity along the join and draw a bright seam down
 * the Rockies. East reaches to 30W, which is well inside its disk, so the
 * Atlantic is covered as far as the map is likely to be taken.
 *
 * West's coverage moves with its scan schedule — asked for 168W it answered
 * empty one afternoon and 100% that night — so a satellite with nothing to
 * show is dropped for that run rather than emptying the whole loop.
 */
const SATS = [
    {
        id: 'east',
        ir: 'GOES-East_ABI_Band13_Clean_Infrared',
        geo: 'GOES-East_ABI_GeoColor',
        domain: { W: -126, E: -30, S: 2, N: 52 },
        // 96 degrees across; the wider patch earns the larger picture.
        width: 2400,
    },
    {
        id: 'west',
        ir: 'GOES-West_ABI_Band13_Clean_Infrared',
        geo: 'GOES-West_ABI_GeoColor',
        domain: { W: -152, E: -126, S: 2, N: 56 },
        // A quarter the longitude, so a quarter the pixels for the same detail.
        width: 800,
    },
];
const srcIdOf = (sat) => `goes-${sat.id}-src`;
const layerIdOf = (sat) => `goes-${sat.id}-layer`;

// Trimmed each run to the satellites that can actually see their patch.
let _sats = SATS.slice();
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
    geocolor: {
        kind: 'gibs',
        wms: 'GOES-East_ABI_GeoColor',
        label: 'GeoColor',
        name: 'GOES · GeoColor',
        enhanced: false,
    },
    ir: {
        kind: 'gibs',
        wms: 'GOES-East_ABI_Band13_Clean_Infrared',
        label: 'Band 13 · Enhanced IR',
        name: 'GOES Band 13 · Clean Infrared',
        enhanced: true,
    },
};

/*
 * The infrared bands, as RealEarth names them. `what` is the one line a
 * viewer needs to know what they are looking at.
 */
const BANDS = [
    [7, '3.9 µm', 'Shortwave IR', 'Fire hot spots, and fog and low cloud at night.'],
    [8, '6.2 µm', 'Upper-Level Water Vapor', 'Moisture high in the atmosphere; jet streams and upper lows.'],
    [9, '6.9 µm', 'Mid-Level Water Vapor', 'Moisture in the middle levels; troughs and dry slots.'],
    [10, '7.3 µm', 'Lower-Level Water Vapor', 'Moisture lower down; elevated mixed layers and plumes.'],
    [11, '8.4 µm', 'Cloud-Top Phase', 'Separates ice-topped from water cloud.'],
    [12, '9.6 µm', 'Ozone', 'Stratospheric intrusions and upper-level dynamics.'],
    [13, '10.3 µm', 'Clean Longwave IR', 'Cloud-top temperature, day and night.'],
    [14, '11.2 µm', 'Longwave IR', 'Cloud-top temperature, with a little more moisture signal.'],
    [15, '12.3 µm', 'Dirty Longwave IR', 'Low-level moisture and dust; cloud tops.'],
    [16, '13.3 µm', 'CO₂ Longwave IR', 'Cloud-top height; air-mass boundaries.'],
];
for (const [n, um, title, what] of BANDS) {
    const id = 'b' + String(n).padStart(2, '0');
    PRODUCTS[id] = {
        kind: 'band',
        realearth: 'G19-ABI-CONUS-BAND' + String(n).padStart(2, '0'),
        label: `Band ${n} · ${title}`,
        name: `GOES-East Band ${n} · ${title}`,
        title: `BAND ${n} · ${title.toUpperCase()}`,
        note: `${um}. ${what} Brighter is colder and higher.`,
        enhanced: false,
    };
}

function storedProduct() {
    try {
        const v = localStorage.getItem(PRODUCT_KEY);
        return PRODUCTS[v] ? v : 'ir';
    } catch (e) { return 'ir'; }
}
let _product = storedProduct();
function product() { return PRODUCTS[_product]; }

// GOES-East domain we render (CONUS + Gulf + nearby Atlantic, useful for storms).
const cornersOf = (d) => [[d.W, d.N], [d.E, d.N], [d.E, d.S], [d.W, d.S]];

/*
 * 2000px across 66° of longitude is about 3 km per pixel, against ABI's
 * native 2 km — sharper than the 1600 this used to draw, and deliberately
 * short of the 2.5 km it could have, because every frame of the loop is
 * decoded and pushed to the GPU each time it comes round. Sharpness that
 * costs the loop its smoothness is a bad trade on a weather map.
 */
const IMG_WIDTH = 2000;

/*
 * Phones get smaller frames, and fewer of them.
 *
 * Every step of the loop decodes a whole frame. At 2400px that is roughly
 * three megapixels, on hardware with a fraction of the memory bandwidth of a
 * laptop — which is where the skipping came from. Half the width is a quarter
 * of the pixels.
 *
 * Judged on the screen rather than the user agent string: a small screen is
 * the thing that correlates with a small budget, and it does not lie.
 */
function onPhone() {
    try {
        const shortest = Math.min(window.screen.width, window.screen.height);
        return shortest > 0 && shortest <= 820;
    } catch (e) { return false; }
}
const SIZE_SCALE = onPhone() ? 0.5 : 1;

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
/*
 * How many frames: Settings › Playback's Max Frames, held under a ceiling.
 *
 * A GIBS frame is a whole multi-megabyte picture, decoded at every step, so
 * those stay short — fewer still on a phone, where four is a forty-minute
 * loop and still reads as motion. A band frame is one picture of the view at
 * no more than 1024px, so it can run longer: 24 at five minutes is two hours.
 */
const GIBS_CAP = onPhone() ? 4 : 12;
const BAND_CAP = onPhone() ? 12 : 24;
function frameBudget() {
    return Math.min(playback.get().frames, product().kind === 'band' ? BAND_CAP : GIBS_CAP);
}
// How long each frame is held at 1×. The speed scales it and the loop pause
// is added on the frame that ends a pass, both from Settings › Playback.
const STEP_MS = 420;
const PROBE_BACK = 18;          // three hours; past that the feed is down

const RE_BASE = 'https://realearth.ssec.wisc.edu';
// GOES-East's CONUS sector [W, S, E, N]; nothing outside it is asked for.
const RE_BOUNDS = [-152, 14, -52, 57];
/*
 * RealEarth's ceiling for anonymous use: 1024px in either dimension, and
 * "successive geographically adjacent image requests cumulatively count
 * toward the threshold". A screenful of map tiles is one image as far as that
 * rule is concerned — a 1900px-wide view came back with every tile past the
 * fourth column stamped "Size limit exceeded". So a band frame is ONE picture
 * of the view, at most this size, and the map stretches it.
 */
const BAND_MAX_PX = 1024;
// How far past the screen edges a band picture reaches, as a share of the
// view, so an ordinary pan stays inside it and costs nothing.
const VIEW_PAD = 0.2;
// Re-ask only once the map has stopped moving, and only if the picture held
// no longer covers the view or has gone this much softer than a new one.
const VIEW_SETTLE_MS = 800;
const VIEW_SOFTER = 1.6;
/*
 * Back-to-back pictures of neighbouring areas add up, too. Measured: a view
 * asked for straight after the one beside it came back stamped at 0s and 5s
 * apart, and clean from 10s. So the first picture of a new area waits until
 * this long after the last picture of the old one; the old ones stay on
 * screen meanwhile. (RealEarth also caps anonymous volume at 500 megapixels
 * a day; a two-hour loop at 1024px is about 14 of those per view.)
 */
const AREA_GAP_MS = 12000;
const BAND_FETCHES = 3;          // band frames downloading at once
const TILE_OPACITY = 0.9;

let _enabled = false;
let _timer = null;             // the refresh clock
let _playTimer = null;         // the loop clock
let _alphaLut = null;
let _greyLut = null;

// time (epoch ms) -> { url }. The newest scan is the last key.
const _frames = new Map();
let _shown = null;             // which frame is on the map
let _playing = true;
let _rock = { sign: 1 };       // which way a rocking loop is heading
let _token = 0;                // bumped to orphan work from a previous run
let _followTimer = null;       // watches the app player
let _following = false;
let _bandView = null;          // the area the band pictures in hand cover
let _viewTimer = null;         // waits for the map to settle after a move
let _lastAsked = { at: 0, view: null };   // the latest band picture requested

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
function wmsUrl(sat, width, at, format) {
    const [minx, miny] = merc(sat.domain.W, sat.domain.S);
    const [maxx, maxy] = merc(sat.domain.E, sat.domain.N);
    const height = Math.round(width * (maxy - miny) / (maxx - minx));
    const p = new URLSearchParams({
        SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
        LAYERS: product().enhanced ? sat.ir : sat.geo,
        CRS: 'EPSG:3857', BBOX: `${minx},${miny},${maxx},${maxy}`,
        WIDTH: width, HEIGHT: height, FORMAT: format || 'image/png',
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
/*
 * A finished picture (GeoColor), fetched as BYTES and kept as a blob.
 *
 * It used to be handed to the map as the service's own URL, to save a decode.
 * That was a bad trade: GIBS sends no-store, so every step of the loop
 * re-downloaded the whole frame. A blob is local — one download per frame,
 * and every step after that is just a decode.
 *
 * Asked for as JPEG: 454 KB against 3.4 MB as PNG at the size this requests.
 * Safe because GeoColor covers the whole domain — verified 100% opaque —
 * and JPEG, having no alpha, would otherwise paint black wherever it did not.
 */
function rgbFrame(sat, at, cb, width) {
    const url = wmsUrl(sat, width || Math.round((sat.width || IMG_WIDTH) * SIZE_SCALE), at, 'image/jpeg');
    fetch(url)
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
            if (!blob || !blob.size) { cb(null); return; }
            const objectUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                try {
                    // Blankness on a thumbnail: the service serves the odd
                    // empty or solid frame whatever the product, and one of
                    // those full-screen is the white wall again.
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
                    if (!seen || same / seen > 0.9) {
                        URL.revokeObjectURL(objectUrl);
                        cb(null);
                        return;
                    }
                } catch (e) {
                    // A check that could not run is not a reason to throw away
                    // a frame that downloaded perfectly well.
                }
                cb(objectUrl);
            };
            img.onerror = () => { URL.revokeObjectURL(objectUrl); cb(null); };
            img.src = objectUrl;
        })
        .catch(() => cb(null));
}

function buildImage(sat, at, cb, width) {
    if (!product().enhanced) { rgbFrame(sat, at, cb, width); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        try {
            /*
             * Handled before this, as bytes — see rgbFrame. Reached only if
             * something routed an enhanced product down the wrong path.
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
    img.src = wmsUrl(sat, width || Math.round((sat.width || IMG_WIDTH) * SIZE_SCALE), at);
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
    if (fr.band) { removeBandFrame(fr.band); return; }
    for (const u of fr.urls) {
        if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* already gone */ } }
    }
}

/* The GIBS pictures, east and west. A band frame does not replace them — it
   is a layer of its own — so moving to a band has to take them down. */
function removeGibsLayers() {
    // Every satellite, not just the ones in the shot right now: one dropped
    // for having nothing to show may still have a layer from an earlier run.
    for (const sat of SATS) {
        try {
            if (map.getLayer(layerIdOf(sat))) map.removeLayer(layerIdOf(sat));
            if (map.getSource(srcIdOf(sat))) map.removeSource(srcIdOf(sat));
        } catch (e) { /* the style went first */ }
    }
}

/* Both pickers — the legend's and the menu's — show the same product. */
function showProductInPickers() {
    for (const el of document.querySelectorAll('#armrSatProduct, #vortexSatLegend .vml-select')) {
        if (el.value !== _product) el.value = _product;
    }
}

function setProduct(next) {
    if (!PRODUCTS[next] || next === _product) return;
    _product = next;
    try { localStorage.setItem(PRODUCT_KEY, next); } catch (e) { /* not remembered, still applied */ }
    _token++;                 // orphan anything still downloading
    stopPlaying();
    for (const at of [..._frames.keys()]) dropFrame(at);
    removeGibsLayers();
    _shown = null;
    // Both satellites are back in play: one may have been dropped for having
    // nothing in the OTHER product, which says nothing about this one.
    _sats = SATS.slice();
    showProductInPickers();
    if (_enabled) {
        drawLegend();         // the scale belongs to the product
        sync();
    }
}

/* <option>s for every product, the finished pictures first, then the bands. */
function productOptions() {
    const opt = (id) => `<option value="${id}"${_product === id ? ' selected' : ''}>${PRODUCTS[id].label}</option>`;
    const bands = Object.keys(PRODUCTS).filter((id) => PRODUCTS[id].kind === 'band');
    return `<optgroup label="Imagery">${opt('geocolor')}${opt('ir')}</optgroup>`
        + `<optgroup label="Infrared bands">${bands.map(opt).join('')}</optgroup>`;
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
    /*
     * A raw band has no scale either: its greys are a stretch of brightness
     * temperature chosen per band, not a table this file can read back. It
     * gets what it is and what it shows, and the credit RealEarth asks for.
     */
    const p = product();
    let scale;
    if (p.enhanced) {
        scale = `<div class="vml-title">SATELLITE · CLOUD TOP TEMPERATURE <span style="opacity:.6">(°C)</span></div>
        <div class="vml-bar" style="background:linear-gradient(90deg, ${stops.join(', ')})"></div>
        <div class="vml-scale"><span>-90</span><span>-60</span><span>-30</span><span>0</span><span>+30</span></div>`;
    } else if (p.kind === 'band') {
        scale = `<div class="vml-title">SATELLITE · ${p.title}</div>
        <div class="vml-note">${p.note}</div>
        <div class="vml-credit">Source: SSEC RealEarth, UW-Madison</div>`;
    } else {
        scale = '<div class="vml-title">SATELLITE · GEOCOLOR</div>'
          + '<div class="vml-note">True colour by day, infrared and city lights by night.</div>';
    }

    el.innerHTML = `<div class="vml-body">
        ${scale}
        <select class="vml-select" aria-label="Satellite view">${productOptions()}</select>
        <div class="vml-age">${p.name} · <span class="vml-when">loading…</span></div>
      </div>
      <div class="vml-btns">
        <button class="vml-play" type="button"></button>
        <button class="vml-toggle" type="button"></button>
      </div>`;
    el.querySelector('.vml-toggle')
        .addEventListener('click', () => foldLegend(el, !el.classList.contains('vml-folded')));
    el.querySelector('.vml-play')
        .addEventListener('click', () => setPlaying(el, !_playing));
    const sel = el.querySelector('.vml-select');
    sel.addEventListener('change', () => setProduct(sel.value));
    document.body.appendChild(el);
    foldLegend(el, legendFolded());
    setPlaying(el, _playing);
}

/*
 * The newest scan the first satellite has, and which of the others can see
 * their own patch at that moment.
 *
 * Requiring every satellite to have a frame is right when each can see what
 * it is asked about, and a disaster when one cannot: it would reject every
 * scan there has ever been and leave the map bare.
 */
/*
 * The newest scan there actually is, found by FETCHING it.
 *
 * There used to be a cheap probe here — a 32px version of the frame, asked
 * only whether that time had data. It was wrong in both directions, because
 * GIBS serves from a tile pyramid and a 32px request for a 96-degree domain
 * lands on a different zoom level from the real one. The two fill at
 * different times, so the probe answered a different question from the one
 * being asked, and the picture ran over an hour behind:
 *
 *   infrared 16:20Z  probe said empty, the real frame was 2.9 MB of data
 *   GeoColor 15:50Z  probe said data, the real frame was empty
 *
 * Matching the resolution helps and does not fix it: one sample point is
 * still unreliable at the boundary that matters, because the pyramid fills
 * unevenly as a scan lands.
 *
 * Fetching the real frame costs nothing when the answer is no — an empty
 * scan is transparent and compresses to about 8 KB — and when the answer is
 * yes it is a frame we wanted, so it is kept rather than refetched.
 */
async function newestFrame() {
    let at = scanTime(Date.now());
    for (let i = 0; i < PROBE_BACK; i++) {
        /*
         * Full size, then half, then a quarter, before giving up on this
         * minute. GIBS fills its pyramid from the top down, so the fine
         * tiles of a scan land ten to twenty minutes after the coarse ones —
         * measured: GeoColor at 16:00Z had imagery at 500px and nothing at
         * 1000 or 2000. Insisting on full size means waiting for the
         * sharpest version of a picture that already exists.
         */
        const full = Math.round((SATS[0].width || IMG_WIDTH) * SIZE_SCALE);
        let first = null, usedScale = 1;
        for (const scale of [1, 0.5, 0.25]) {
            first = await new Promise((res) => buildImage(SATS[0], at, res, Math.round(full * scale)));
            if (first) { usedScale = scale; break; }
        }
        if (first) {
            if (usedScale < 1) console.log('[GOES] newest scan taken at ' + (usedScale * 100) + '% size; the sharp tiles are still landing');
            const keep = [SATS[0]];
            const urls = [first];
            for (const sat of SATS.slice(1)) {
                const w = Math.round((sat.width || IMG_WIDTH) * SIZE_SCALE * usedScale);
                const u = await new Promise((res) => buildImage(sat, at, res, w));
                if (u) { keep.push(sat); urls.push(u); }
                else console.warn('[GOES] ' + sat.id + ' has nothing for its area right now');
            }
            /*
             * A frame holds one picture PER SATELLITE, in this order, so a
             * change to the list makes every frame already held unreadable —
             * showFrame would pair the west picture with the east domain. The
             * loop restarts rather than being drawn wrong.
             */
            const before = _sats.map((x) => x.id).join();
            _sats = keep;
            if (before !== keep.map((x) => x.id).join()) {
                for (const t of [..._frames.keys()]) dropFrame(t);
                _shown = null;
            }
            return { at, urls, scale: usedScale };
        }
        at -= SCAN_MS;
    }
    return null;
}

function putOnMap(sat, url) {
    const srcId = srcIdOf(sat);
    const existing = map.getSource(srcId);
    const coordinates = cornersOf(sat.domain);
    if (existing) { existing.updateImage({ url, coordinates }); return; }
    map.addSource(srcId, { type: 'image', url, coordinates });
    map.addLayer({
        id: layerIdOf(sat), type: 'raster', source: srcId,
        paint: { 'raster-opacity': 0.95, 'raster-fade-duration': 0 },
    }, _beforeId());
}

/*
 * A band frame: one picture of the view per scan, each its own image layer,
 * all of them on the map at once and all but one at zero opacity, so a step
 * of the loop is an opacity change rather than a decode.
 *
 * The picture is asked for at no more than BAND_MAX_PX on its long side —
 * see there for why tiles cannot be used — and covers the view plus a margin,
 * so panning about inside it costs nothing. When the map moves outside it, or
 * zooms in far enough that it has gone soft, every frame is asked for again
 * at the new view.
 */
function bandIds(at) { return { src: `goes-band-${at}-src`, layer: `goes-band-${at}-layer` }; }

const mercY = (lat) => merc(0, lat)[1];
const latOfMercY = (y) => (360 / Math.PI) * Math.atan(Math.exp(y * Math.PI / 20037508.34)) - 90;

/*
 * The area a band picture should cover, and at what size: the view, padded,
 * cut to the sector, at the most pixels the picture may have. Null when the
 * view is nowhere near the sector.
 */
function wantedBandView() {
    let b;
    try { b = map.getBounds(); } catch (e) { return null; }
    const vw = b.getWest(), ve = b.getEast();
    const vs = Math.max(-85, b.getSouth()), vn = Math.min(85, b.getNorth());
    const padX = (ve - vw) * VIEW_PAD;
    const padY = (mercY(vn) - mercY(vs)) * VIEW_PAD;
    const W = Math.max(RE_BOUNDS[0], vw - padX);
    const E = Math.min(RE_BOUNDS[2], ve + padX);
    const S = Math.max(RE_BOUNDS[1], latOfMercY(mercY(vs) - padY));
    const N = Math.min(RE_BOUNDS[3], latOfMercY(mercY(vn) + padY));
    if (!(E > W) || !(N > S)) return null;

    // Sized in mercator, because that is the shape it is drawn in. No more
    // pixels than the screen would show at this size, either.
    const spanX = merc(E, 0)[0] - merc(W, 0)[0];
    const spanY = mercY(N) - mercY(S);
    let screen = BAND_MAX_PX;
    try {
        const c = map.getCanvas();
        const viewX = merc(ve, 0)[0] - merc(vw, 0)[0];
        screen = c.width * spanX / Math.max(viewX, 1);
    } catch (e) { /* no canvas yet: take the ceiling */ }
    const longest = Math.min(BAND_MAX_PX, Math.max(256, screen));
    const scale = longest / Math.max(spanX, spanY);
    return {
        W, E, S, N,
        width: Math.max(1, Math.round(spanX * scale)),
        height: Math.max(1, Math.round(spanY * scale)),
        mPerPx: 1 / scale,
        // What the screen covers, for deciding later whether it still fits.
        view: { W: vw, E: ve, S: vs, N: vn },
    };
}

/* Whether the pictures in hand still serve the view the map is showing. */
function bandViewStillGood(held, wanted) {
    if (!held || !wanted) return !wanted;
    const v = wanted.view;
    // The screen has gone past the picture's edge, where the sector allows.
    if (Math.max(v.W, RE_BOUNDS[0]) < held.W - 1e-6 || Math.min(v.E, RE_BOUNDS[2]) > held.E + 1e-6) return false;
    if (Math.max(v.S, RE_BOUNDS[1]) < held.S - 1e-6 || Math.min(v.N, RE_BOUNDS[3]) > held.N + 1e-6) return false;
    // Zoomed in so far that the picture is drawn a lot coarser than a new one.
    return held.mPerPx / wanted.mPerPx < VIEW_SOFTER;
}

function bandUrl(productId, stamp, v) {
    // Stamps are listed as YYYYMMDD.HHMMSS and asked for as YYYYMMDD_HHMMSS.
    return `${RE_BASE}/api/image?products=${encodeURIComponent(productId + '_' + stamp.replace('.', '_'))}`
        + `&bounds=${v.S.toFixed(4)},${v.W.toFixed(4)},${v.N.toFixed(4)},${v.E.toFixed(4)}`
        + `&width=${v.width}&height=${v.height}`;
}

/*
 * Fetch one band picture and put it in web mercator. cb(objectUrl|null).
 *
 * RealEarth draws it in plain latitude/longitude. The map stretches an image
 * linearly between its corners in mercator, so a picture handed over as it
 * comes would sit over half a degree south of where it belongs in the middle.
 * Longitude is linear in both, so only the rows need moving: each output row
 * takes the source row at its latitude.
 */
function bandFrame(url, v, cb) {
    fetch(url)
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => (blob && blob.size && /^image\//.test(blob.type) ? createImageBitmap(blob) : null))
        .then((img) => {
            if (!img) { cb(null); return; }
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            const yN = mercY(v.N), yS = mercY(v.S);
            for (let row = 0; row < c.height; row++) {
                const lat = latOfMercY(yN + (yS - yN) * (row + 0.5) / c.height);
                const src = Math.min(img.height - 1, Math.max(0, Math.floor((v.N - lat) / (v.N - v.S) * img.height)));
                ctx.drawImage(img, 0, src, img.width, 1, 0, row, c.width, 1);
            }
            if (img.close) img.close();
            c.toBlob((out) => cb(out ? URL.createObjectURL(out) : null), 'image/png');
        })
        .catch((e) => { console.warn('[GOES] band frame failed:', e && e.message); cb(null); });
}

function addBandFrame(b) {
    if (!b.url || !b.view) return;
    const coordinates = cornersOf(b.view);
    try {
        const src = map.getSource(b.src);
        if (src) { if (src._vxUrl !== b.url) { src.updateImage({ url: b.url, coordinates }); src._vxUrl = b.url; } }
        else {
            map.addSource(b.src, { type: 'image', url: b.url, coordinates });
            map.getSource(b.src)._vxUrl = b.url;
        }
        if (!map.getLayer(b.layer)) {
            map.addLayer({
                id: b.layer, type: 'raster', source: b.src,
                paint: {
                    'raster-opacity': _shown === b.at ? TILE_OPACITY : 0,
                    'raster-opacity-transition': { duration: 0 }, 'raster-fade-duration': 0,
                },
            }, _beforeId());
        }
    } catch (e) { console.warn('[GOES] could not add a band frame:', e && e.message); }
}

function removeBandFrame(b) {
    try {
        if (map.getLayer(b.layer)) map.removeLayer(b.layer);
        if (map.getSource(b.src)) map.removeSource(b.src);
    } catch (e) { /* the style went first */ }
    if (b.url) { try { URL.revokeObjectURL(b.url); } catch (e) { /* already gone */ } }
}

/* Whether a frame can be shown without a blank: a band frame whose picture is
   still arriving is passed over by the loop until it has. After a move, the
   pictures of the old view stand in only until the first of the new lands —
   a loop that alternated between two areas would jump about. */
function frameReady(at) {
    const fr = _frames.get(at);
    if (!fr) return false;
    if (!fr.band) return true;
    if (!fr.band.url) return false;
    if (fr.band.view === _bandView) return true;
    for (const f of _frames.values()) {
        if (f.band && f.band.url && f.band.view === _bandView) return false;
    }
    return true;
}

function showFrame(at) {
    const fr = _frames.get(at);
    if (!fr) return;
    if (fr.band) {
        if (!fr.band.url) return;
        // A change of map style takes every added layer with it; put this one
        // back rather than show nothing.
        addBandFrame(fr.band);
        const was = (_shown !== null && _shown !== at) ? _frames.get(_shown) : null;
        try {
            map.setPaintProperty(fr.band.layer, 'raster-opacity', TILE_OPACITY);
            if (was && was.band && map.getLayer(was.band.layer)) {
                map.setPaintProperty(was.band.layer, 'raster-opacity', 0);
            }
        } catch (e) { /* the style is mid-change */ }
    } else {
        for (let i = 0; i < _sats.length; i++) {
            if (fr.urls[i]) putOnMap(_sats[i], fr.urls[i]);
        }
    }
    _shown = at;
    setLegendTime(at);
}

/*
 * Play through what we have — forwards, backwards or rocking, at the speed
 * and with the pause at the end of a pass that Settings › Playback says.
 */
function step() {
    _playTimer = null;
    const times = sortedTimes();
    if (!times.length) return;
    let i = times.indexOf(_shown);
    if (i < 0) i = times.length - 1;
    // Skip frames whose tiles have not landed, but never go round more than
    // once looking: if none are ready, hold where we are and try again.
    let nxt = null;
    for (let tries = 0; tries < times.length; tries++) {
        const cand = playback.advance(i, times.length, _rock);
        if (frameReady(times[cand.index])) { nxt = cand; break; }
        i = cand.index;
    }
    if (nxt) showFrame(times[nxt.index]);
    _playTimer = setTimeout(step, playback.holdMs(STEP_MS, nxt ? nxt.end : false));
}

function startPlaying() {
    stopPlaying();
    // Not while the app player is driving: two clocks on one map is how the
    // satellite ended up animating against the radar instead of with it.
    if (_following || !_playing || _frames.size < 2) return;
    _playTimer = setTimeout(step, playback.holdMs(STEP_MS, false));
    playback.setPlaying('satellite', true);
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
    playback.setPlaying('satellite', false);
}

/*
 * The band products' frames: the newest scans RealEarth lists, one picture
 * each. Topped up like the GIBS loop — scans that have aged out of the
 * window are dropped, new ones added, and the rest left alone.
 */
async function syncBands(token) {
    const p = product();
    let stamps = [];
    try {
        const r = await fetch(`${RE_BASE}/api/times?products=${encodeURIComponent(p.realearth)}`);
        const j = r.ok ? await r.json() : null;
        stamps = (j && Array.isArray(j[p.realearth])) ? j[p.realearth] : [];
    } catch (e) {
        console.warn('[GOES] could not list band scans:', e && e.message);
    }
    if (token !== _token || !_enabled || product() !== p) return;
    if (!stamps.length) { setLegendError('no recent scans'); return; }

    // "YYYYMMDD.HHMMSS", UTC.
    const msOf = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
        +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));
    const want = stamps.slice().sort().slice(-frameBudget())
        .map((stamp) => ({ stamp, at: msOf(stamp) }))
        .filter((w) => Number.isFinite(w.at));
    const keep = new Set(want.map((w) => w.at));

    for (const at of [..._frames.keys()]) {
        if (!keep.has(at)) dropFrame(at);
    }
    const wanted = wantedBandView();
    if (!wanted) { setLegendError('outside the GOES-East sector'); return; }
    if (!bandViewStillGood(_bandView, wanted)) _bandView = wanted;
    for (const w of want) {
        const have = _frames.get(w.at);
        if (have) { addBandFrame(have.band); continue; }   // back after a style change
        const band = Object.assign({ at: w.at, product: p.realearth, stamp: w.stamp, url: null, view: null }, bandIds(w.at));
        _frames.set(w.at, { band });
    }
    startPlaying();
    await fillBands(token);
    if (_shown === null || !frameReady(_shown)) showNewestReady();
}

/*
 * Draw every band frame that is not yet a picture of the current view,
 * newest first so there is something on screen at once, a few at a time.
 * A move of the map mid-way leaves the rest to the fill the move starts.
 */
async function fillBands(token) {
    const view = _bandView;
    if (!view) return;
    const todo = sortedTimes().reverse().filter((at) => _frames.get(at).band.view !== view);
    if (!todo.length) return;
    // A different area from the last one asked for: let AREA_GAP_MS pass.
    const wait = _lastAsked.at + AREA_GAP_MS - Date.now();
    if (_lastAsked.view && _lastAsked.view !== view && wait > 0) {
        await new Promise((res) => setTimeout(res, wait));
        if (token !== _token || !_enabled || view !== _bandView) return;
    }
    let next = 0;
    const worker = async () => {
        while (next < todo.length) {
            const at = todo[next++];
            const fr = _frames.get(at);
            if (!fr) continue;
            const b = fr.band;
            _lastAsked = { at: Date.now(), view };
            const url = await new Promise((res) => bandFrame(bandUrl(b.product, b.stamp, view), view, res));
            if (token !== _token || !_enabled || view !== _bandView || _frames.get(at) !== fr) {
                if (url) URL.revokeObjectURL(url);
                return;
            }
            if (!url) continue;
            const old = b.url;
            b.url = url;
            b.view = view;
            addBandFrame(b);
            if (old) { try { URL.revokeObjectURL(old); } catch (e) { /* already gone */ } }
            if (_shown === at || _shown === null || !frameReady(_shown)) showFrame(at);
        }
    };
    await Promise.all(Array.from({ length: BAND_FETCHES }, worker));
}

function showNewestReady() {
    const ready = sortedTimes().filter(frameReady);
    if (ready.length) showFrame(ready[ready.length - 1]);
}

/*
 * The map moved. Once it settles, ask for the view again if the pictures in
 * hand no longer cover it or have gone soft; otherwise nothing is fetched.
 */
function onMapMoved() {
    if (_viewTimer) clearTimeout(_viewTimer);
    _viewTimer = setTimeout(() => {
        _viewTimer = null;
        if (!_enabled || product().kind !== 'band' || !_frames.size) return;
        const wanted = wantedBandView();
        if (!wanted || bandViewStillGood(_bandView, wanted)) return;
        _bandView = wanted;
        const token = _token;
        fillBands(token).then(() => {
            if (token === _token && (_shown === null || !frameReady(_shown))) showNewestReady();
        });
    }, VIEW_SETTLE_MS);
}

function setLegendError(msg) {
    const slot = document.querySelector('#' + LEGEND_ID + ' .vml-when');
    if (slot) slot.textContent = msg;
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
    if (product().kind === 'band') { await syncBands(token); return; }
    const found = await newestFrame();
    if (!found || token !== _token || !_enabled) {
        // Whatever was fetched belongs to a run that has been superseded.
        if (found) for (const u of found.urls) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } }
        return;
    }
    const newest = found.at;

    const want = [];
    for (let i = frameBudget() - 1; i >= 0; i--) want.push(newest - i * SCAN_MS);

    // Anything outside the window is gone for good; its blobs go with it.
    for (const at of [..._frames.keys()]) {
        if (want.indexOf(at) === -1) dropFrame(at);
    }

    /*
     * Newest first, so there is a picture on screen as soon as possible and
     * the rest fills in behind it. One at a time: six of these at once is six
     * simultaneous multi-megabyte decodes, and the page has to stay usable.
     */
    // The newest is already in hand from the search above; keeping it is the
    // whole reason the search fetches real frames.
    const held = _frames.get(newest);
    if (!held) {
        _frames.set(newest, { urls: found.urls, scale: found.scale });
        if (_shown === null) { showFrame(newest); startPlaying(); }
    } else if ((held.scale || 1) < found.scale) {
        // The fine tiles have landed since: trade up.
        dropFrame(newest);
        _frames.set(newest, { urls: found.urls, scale: found.scale });
        if (_shown === newest) showFrame(newest);
    } else {
        for (const u of found.urls) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } }
    }

    for (const at of want.slice().reverse()) {
        if (token !== _token || !_enabled) return;
        /*
         * A frame taken at a coarse width while its fine tiles were still
         * landing counts as missing, so it is fetched again at full size and
         * replaced below. Otherwise its softness would ride round the loop
         * for the next two hours.
         */
        const have = _frames.get(at);
        if (have && (have.scale || 1) >= 1) continue;

        const urls = [];
        let complete = true;
        for (const sat of _sats) {
            const url = await new Promise((res) => buildImage(sat, at, res));
            if (token !== _token || !_enabled) {
                for (const u of urls) if (u) URL.revokeObjectURL(u);
                if (url) URL.revokeObjectURL(url);
                return;
            }
            if (!url) complete = false;
            urls.push(url);
        }
        /*
         * Every satellite or none, among the ones still in the shot. A frame
         * with one half missing shows the west coast standing still while the
         * east advances, which looks like a fault and is worse than a shorter
         * loop. A satellite that can never see its patch was already dropped
         * from _sats, so this cannot empty the loop on its own.
         */
        if (!complete) {
            for (const u of urls) if (u) URL.revokeObjectURL(u);
            continue;
        }
        if (_frames.has(at)) dropFrame(at);          // the soft version
        _frames.set(at, { urls, scale: 1 });
        if (_shown === null) { showFrame(at); startPlaying(); }
        else if (_shown === at) showFrame(at);       // swap the sharp one in
    }
    if (_shown === null || !_frames.has(_shown)) {
        const times = [..._frames.keys()].sort((a, b) => a - b);
        if (times.length) showFrame(times[times.length - 1]);
    }
    startPlaying();
}

function _remove() {
    stopPlaying();
    removeGibsLayers();
    for (const at of [..._frames.keys()]) dropFrame(at);
    _shown = null;
    _bandView = null;
    if (_viewTimer) { clearTimeout(_viewTimer); _viewTimer = null; }
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
    map.off('moveend', onMapMoved);
    map.on('moveend', onMapMoved);
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
    map.off('moveend', onMapMoved);
    _following = false;
    try {
        require('../radar/animation/radar_loop').setDriver(null);
    } catch (e) { /* it was never reached */ }
    _remove();
}

/*
 * Settings › Playback changed. A new length is a new window of scans; speed,
 * direction and the end pause only need the clock restarted on them.
 */
playback.on((key) => {
    if (!_enabled) return;
    if (key === 'frames') { sync(); return; }
    if (key === 'direction') _rock = { sign: 1 };
    if (_playTimer) startPlaying();
});

module.exports = { enable, disable, setProduct, productOptions };
