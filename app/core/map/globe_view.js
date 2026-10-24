/*
 * Globe View — draw the main map as a 3D globe instead of a flat Mercator map.
 *
 * Mapbox GL 2.9 does the globe itself (map.setProjection('globe')). Two of its
 * rules shape how this behaves:
 *
 *   - Past zoom 6 Mapbox switches back to flat Mercator by itself, while the
 *     projection still reports 'globe'. So zoomed in, nothing changes.
 *   - Custom WebGL layers are not drawn on the globe. The single-site radar
 *     (app/radar/plot/plot_to_map.js) is one, so it disappears below zoom 6
 *     and comes back past it. The national mosaic, warnings and markers are
 *     image/geojson/marker layers and stay on the globe throughout.
 *     The hint below explains the missing radar rather than leaving it a mystery.
 *
 * Main pane only: the split-screen pane is built flat (components/split_screen.js).
 */
const map = require('./map');

const STORE_KEY = 'echo.globeView';
const RADAR_LAYER = 'baseReflectivity';
// Mapbox's GLOBE_ZOOM_THRESHOLD_MAX: at and above this the globe is drawn flat.
const FLAT_FROM_ZOOM = 6;

const FOG = {
    'range': [0.8, 8],
    'color': 'rgb(16, 24, 40)',
    'high-color': 'rgb(36, 92, 223)',
    'horizon-blend': 0.03,
    'space-color': 'rgb(6, 8, 16)',
    'star-intensity': 0.35,
};

function storedChoice() {
    try { return localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; }
}

let enabled = storedChoice();
let hintEl = null;

function radarShowing() {
    try {
        return !!map.getLayer(RADAR_LAYER) && map.getLayoutProperty(RADAR_LAYER, 'visibility') !== 'none';
    } catch (e) { return false; }
}

function updateHint() {
    const show = enabled && map.getZoom() < FLAT_FROM_ZOOM && radarShowing();
    if (show && !hintEl) {
        hintEl = document.createElement('div');
        hintEl.className = 'globeViewHint';
        hintEl.textContent = 'Zoom in to see single-site radar on the globe';
        hintEl.style.cssText = 'position:absolute;left:50%;bottom:90px;transform:translateX(-50%);'
            + 'padding:6px 12px;border-radius:6px;background:rgba(10,14,24,0.85);color:#fff;'
            + 'font-size:13px;pointer-events:none;z-index:5;white-space:nowrap;';
        map.getContainer().appendChild(hintEl);
    }
    if (hintEl) hintEl.style.display = show ? '' : 'none';
}

function apply() {
    map.setProjection(enabled ? 'globe' : 'mercator');
    try { map.setFog(enabled ? FOG : null); } catch (e) { /* style not ready; applied on load */ }
    updateHint();
}

function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(STORE_KEY, enabled ? '1' : '0'); } catch (e) { /* applied, not remembered */ }
    apply();
}

function install() {
    map.on('zoomend', updateHint);
    // The radar layer is added and hidden as stations and products change.
    map.on('styledata', updateHint);
    if (map.loaded()) apply(); else map.once('load', apply);
}

module.exports = {
    install,
    isEnabled: () => enabled,
    enable: () => setEnabled(true),
    disable: () => setEnabled(false),
};
