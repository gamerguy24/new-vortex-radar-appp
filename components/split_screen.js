/*
 * components/split_screen.js
 * Overlay-compare split screen. Adds a second Mapbox map in #mapDual that stays
 * pan/zoom-synced with the main map. Radar stays on the primary (left) pane; the
 * standalone vector overlays (earthquakes, METAR, storm centers) render on the
 * dual pane too via window.vortexMap.isSplit().
 *
 * State is published on window.vortexMap:
 *   - dualMap : the second map instance (created lazily on first enable)
 *   - isSplit(): whether split is currently active
 * A 'vortexsplitchange' CustomEvent ({ detail: { active } }) fires on toggle so
 * overlay drivers can (re)render onto / off the dual pane.
 */

// Same base style the primary map uses (see app/core/map/map.js).
const STYLE_URL = 'mapbox://styles/mapbox/dark-v11';

let dualMap = null;
let splitActive = false;
let syncing = false;

function GL() { return window.mapboxgl || window.maplibregl; }
function mainMap() { return window.vortexMap && window.vortexMap.map; }

function syncView(from, to) {
    if (!from || !to || syncing) return;
    syncing = true;
    try {
        to.jumpTo({
            center: from.getCenter(),
            zoom: from.getZoom(),
            bearing: from.getBearing(),
            pitch: from.getPitch(),
        });
    } finally {
        syncing = false;
    }
}

function ensureDual() {
    if (dualMap) return dualMap;
    const gl = GL();
    const main = mainMap();
    if (!gl || !main) return null;

    dualMap = new gl.Map({
        container: 'mapDual',
        style: STYLE_URL,
        center: main.getCenter(),
        zoom: main.getZoom(),
        bearing: main.getBearing(),
        pitch: main.getPitch(),
        maxZoom: 20,
        maxPitch: 0,
        attributionControl: false,
        projection: 'mercator',
        fadeDuration: 0,
    });

    // Wear the same basemap theme as the primary map — otherwise the compare
    // view shows Vortex's grey/blue map beside a stock Mapbox dark one.
    dualMap.on('style.load', () => {
        if (window.vortexBasemap) window.vortexBasemap.apply(dualMap);
    });

    // Match the primary map's interaction restrictions.
    dualMap.touchZoomRotate.disableRotation();
    dualMap.dragRotate.disable();
    dualMap.keyboard.disableRotation();
    dualMap.addControl(new gl.AttributionControl({ compact: true }), 'bottom-right');

    // Two-way pan/zoom sync.
    main.on('move', () => { if (splitActive) syncView(main, dualMap); });
    dualMap.on('move', () => { if (splitActive) syncView(dualMap, main); });

    window.vortexMap.dualMap = dualMap;
    return dualMap;
}

function setBtn(on) {
    const icon = document.getElementById('vortexSplitIcon');
    if (icon) {
        icon.classList.toggle('menu_item_selected', on);
        icon.classList.toggle('menu_item_not_selected', !on);
    }
}

function enable() {
    const main = mainMap();
    if (!main) { console.warn('[SplitScreen] Map not ready yet.'); return; }
    if (!ensureDual()) return;

    splitActive = true;
    document.body.classList.add('vortex-split');
    syncView(main, dualMap);

    // Let the CSS width change apply, then resize both GL canvases.
    requestAnimationFrame(() => { main.resize(); if (dualMap) dualMap.resize(); });

    // Re-assert the Vortex theme every time the compare view opens. The
    // style.load hook in ensureDual() covers the first time, but this is the
    // moment the two maps are actually seen side by side, so it is the moment
    // worth being certain about — and re-applying is idempotent.
    if (window.vortexBasemap && dualMap) {
        try { window.vortexBasemap.apply(dualMap); } catch (e) { /* theme is cosmetic */ }
    }
    setBtn(true);
    window.dispatchEvent(new CustomEvent('vortexsplitchange', { detail: { active: true } }));
}

function disable() {
    splitActive = false;
    document.body.classList.remove('vortex-split');
    requestAnimationFrame(() => { const m = mainMap(); if (m) m.resize(); });
    setBtn(false);
    window.dispatchEvent(new CustomEvent('vortexsplitchange', { detail: { active: false } }));
}

function toggle() { splitActive ? disable() : enable(); }

function publishState() {
    if (window.vortexMap) window.vortexMap.isSplit = () => splitActive;
}

function init() {
    // Publish split state so overlay layers can target the dual pane. The map
    // wrapper may not exist yet (bundle load order), so also set it on ready.
    publishState();
    window.addEventListener('vortexmapready', publishState, { once: true });

    const btn = document.getElementById('vortexSplitBtn');
    if (btn) btn.addEventListener('click', toggle);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
