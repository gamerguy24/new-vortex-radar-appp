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

// GOES-East domain we render (CONUS + Gulf + nearby Atlantic, useful for storms).
const DOM = { W: -128, E: -62, S: 18, N: 52 };
const CORNERS = [[DOM.W, DOM.N], [DOM.E, DOM.N], [DOM.E, DOM.S], [DOM.W, DOM.S]];

/*
 * 2400px across 66° of longitude is about 2.5 km per pixel, near enough to
 * ABI's native 2 km at this latitude. At the old 1600 the overlay was being
 * drawn at half the resolution the satellite actually flies.
 */
const IMG_WIDTH = 2400;

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

let _enabled = false;
let _timer = null;
let _objectUrl = null;
let _alphaLut = null;

function merc(lon, lat) {
    const x = lon * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
    return [x, y];
}

function wmsUrl() {
    const [minx, miny] = merc(DOM.W, DOM.S);
    const [maxx, maxy] = merc(DOM.E, DOM.N);
    const height = Math.round(IMG_WIDTH * (maxy - miny) / (maxx - minx));
    const p = new URLSearchParams({
        SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
        LAYERS: 'GOES-East_ABI_Band13_Clean_Infrared',
        CRS: 'EPSG:3857', BBOX: `${minx},${miny},${maxx},${maxy}`,
        WIDTH: IMG_WIDTH, HEIGHT: height, FORMAT: 'image/png',
        _: Date.now(), // cache-bust so refreshes fetch the newest scan
    });
    return 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?' + p.toString();
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
function buildImage(cb) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imgData.data;
            const lut = alphaLut();
            for (let i = 0; i < d.length; i += 4) {
                // Nothing there to begin with stays nothing: off the disk, or
                // a gap between scans.
                if (d[i + 3] === 0) continue;
                d[i + 3] = lut[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)];
            }
            ctx.putImageData(imgData, 0, 0);
            canvas.toBlob((blob) => {
                if (!blob) { cb(null); return; }
                cb(URL.createObjectURL(blob));
            }, 'image/png');
        } catch (e) { console.warn('[GOES] recolor failed:', e); cb(null); }
    };
    img.onerror = () => { console.warn('[GOES] image load failed'); cb(null); };
    img.src = wmsUrl();
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
    el.innerHTML = `<div class="vml-title">SATELLITE · CLOUD TOP TEMPERATURE <span style="opacity:.6">(°C)</span></div>
      <div class="vml-bar" style="background:linear-gradient(90deg, ${stops.join(', ')})"></div>
      <div class="vml-scale"><span>-90</span><span>-60</span><span>-30</span><span>0</span><span>+30</span></div>
      <div class="vml-age">GOES-East Band 13 · colder tops are taller storms</div>`;
    document.body.appendChild(el);
}

function render() {
    buildImage((url) => {
        if (!url) return;
        if (!_enabled) { URL.revokeObjectURL(url); return; }
        const src = map.getSource(SRC);
        if (src) {
            src.updateImage({ url, coordinates: CORNERS });
        } else {
            map.addSource(SRC, { type: 'image', url, coordinates: CORNERS });
            map.addLayer({
                id: LAYER, type: 'raster', source: SRC,
                paint: { 'raster-opacity': 0.95, 'raster-fade-duration': 0 },
            }, _beforeId());
        }
        // Revoke the one it replaced, not the one just handed over.
        if (_objectUrl) { try { URL.revokeObjectURL(_objectUrl); } catch (e) { /* already gone */ } }
        _objectUrl = url;
    });
}

function _remove() {
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SRC)) map.removeSource(SRC);
    if (_objectUrl) { try { URL.revokeObjectURL(_objectUrl); } catch (e) { /* already gone */ } }
    _objectUrl = null;
    clearLegend();
}

function enable() {
    _enabled = true;
    render();
    drawLegend();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => { if (_enabled) render(); }, 5 * 60 * 1000);
}

function disable() {
    _enabled = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
    _remove();
}

module.exports = { enable, disable };
