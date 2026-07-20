/*
 * goes_ir.js
 * GOES-19 (GOES-East) ABI Band 13 "Clean" Longwave IR window (10.3 µm) as a
 * raster overlay, from NASA GIBS' near-real-time WMTS. GIBS labels the current
 * GOES-East satellite "GOES-East" — which is GOES-19 as of 2025. Tiles are
 * public and CORS-enabled, so they load straight from the browser (no proxy).
 *
 * The layer sits beneath the radar so cloud-top temps read as a backdrop, and
 * refreshes every 5 minutes to pull the latest scan.
 */

const map = require('../core/map/map');

const SRC = 'goes19_clean_ir_src';
const LAYER = 'goes19_clean_ir_layer';
// {Layer}/{Style=default}/{Time=default→latest}/{TileMatrixSet}/{z}/{y}/{x}.png
const TILE_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
    'GOES-East_ABI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png';

let _enabled = false;
let _timer = null;

// Keep the IR under the radar so reflectivity stays on top.
function _beforeId() {
    for (const id of ['radar-webgl', 'baseReflectivity']) {
        if (map.getLayer(id)) return id;
    }
    return undefined;
}

function _add() {
    // Cache-bust so each (re)add fetches the newest scan rather than stale tiles.
    const url = `${TILE_BASE}?t=${Date.now()}`;
    map.addSource(SRC, {
        type: 'raster',
        tiles: [url],
        tileSize: 256,
        maxzoom: 6, // GIBS tops out at zoom 6; Mapbox overzooms past that
        attribution: 'GOES-19 (GOES-East) ABI Band 13 · NASA GIBS / NOAA',
    });
    map.addLayer({
        id: LAYER,
        type: 'raster',
        source: SRC,
        paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 },
    }, _beforeId());
}

function _remove() {
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SRC)) map.removeSource(SRC);
}

function refresh() {
    if (!_enabled) return;
    _remove();
    _add();
}

function enable() {
    _enabled = true;
    _remove(); // ensure a clean, fresh add
    _add();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(refresh, 5 * 60 * 1000);
}

function disable() {
    _enabled = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
    _remove();
}

module.exports = { enable, disable };
