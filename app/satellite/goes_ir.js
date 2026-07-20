/*
 * goes_ir.js
 * GOES-19 (GOES-East) ABI Band 13 "Clean" Longwave IR window (10.3 µm) overlay,
 * from NASA GIBS' near-real-time imagery. (GIBS labels the current GOES-East
 * satellite "GOES-East" — which is GOES-19 as of 2025.)
 *
 * Clean IR is a grayscale image where warm/clear ground is near-black and cold
 * cloud tops are white. Drawn as-is over a dark basemap it just blackens the
 * whole map, so instead of using the raw raster tiles we fetch one CONUS image,
 * recolor it on a canvas so warm/clear pixels become fully transparent (map
 * shows through) and only clouds are drawn — opacity ramping with how cold/high
 * the tops are. Refreshes every 5 minutes. Tiles are CORS-enabled, so no proxy.
 */

const map = require('../core/map/map');

const SRC = 'goes19_clean_ir_src';
const LAYER = 'goes19_clean_ir_layer';

// GOES-East domain we render (CONUS + Gulf + nearby Atlantic, useful for storms).
const DOM = { W: -128, E: -62, S: 18, N: 52 };
const CORNERS = [[DOM.W, DOM.N], [DOM.E, DOM.N], [DOM.E, DOM.S], [DOM.W, DOM.S]];
const IMG_WIDTH = 1600;

// Luminance→alpha ramp. At/below CLEAR (warm/clear surface) → transparent so the
// map shows; ramps to near-opaque by FULL (cold cloud tops).
const CLEAR = 92;
const FULL = 200;
const MAX_ALPHA = 235;

let _enabled = false;
let _timer = null;

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

// Fetch the IR image and recolor warm/clear pixels to transparent. cb(dataUrl|null).
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
            for (let i = 0; i < d.length; i += 4) {
                const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                d[i + 3] = L <= CLEAR ? 0
                    : Math.min(MAX_ALPHA, Math.round((L - CLEAR) / (FULL - CLEAR) * MAX_ALPHA));
            }
            ctx.putImageData(imgData, 0, 0);
            cb(canvas.toDataURL('image/png'));
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

function render() {
    buildImage((dataUrl) => {
        if (!dataUrl || !_enabled) return;
        const src = map.getSource(SRC);
        if (src) {
            src.updateImage({ url: dataUrl, coordinates: CORNERS });
        } else {
            map.addSource(SRC, { type: 'image', url: dataUrl, coordinates: CORNERS });
            map.addLayer({
                id: LAYER, type: 'raster', source: SRC,
                paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0 },
            }, _beforeId());
        }
    });
}

function _remove() {
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SRC)) map.removeSource(SRC);
}

function enable() {
    _enabled = true;
    render();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => { if (_enabled) render(); }, 5 * 60 * 1000);
}

function disable() {
    _enabled = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
    _remove();
}

module.exports = { enable, disable };
