/*
 * components/metar_stations.js
 * Drives the second METAR stations layer (js/metar.js) from a LAYERS toggle.
 *
 * js/metar.js is a standalone class ported from another app. It expects a map
 * wrapper with .map/.dualMap plus an isSplit() method and an optional .layers
 * manager. This app's wrapper is window.vortexMap = { map, dualMap }, so we pass
 * a thin adapter that adds isSplit(). While enabled we refresh on an interval
 * (METAR observations update roughly hourly).
 */
import MetarStationsLayer from '../js/metar.js';

const TOGGLE_ID = 'toggle-metars-layer';
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

let _layer = null;
let _timer = null;

function adapter() {
    const w = window.vortexMap;
    if (!w || !w.map) return null;
    return {
        get map() { return w.map; },
        get dualMap() { return w.dualMap; },
        get layers() { return w.layers; },
        isSplit() { return typeof w.isSplit === 'function' ? w.isSplit() : !!w.dualMap; },
    };
}

// metar.js._isEnabled() checks this localStorage flag before the checkbox, so
// keep them in sync.
function setEnabledFlag(on) {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('layerSettings') || '{}'); } catch {}
    s.metarStationsEnabled = on;
    try { localStorage.setItem('layerSettings', JSON.stringify(s)); } catch {}
}

async function refresh() {
    if (!_layer) return;
    await _layer.fetchMetarStations();
    _layer.displayMetarStations();
}

async function enable() {
    const a = adapter();
    if (!a) { console.warn('[MetarStations] Map not ready yet.'); return; }
    if (!_layer) _layer = new MetarStationsLayer(a);
    setEnabledFlag(true);
    await refresh();

    clearInterval(_timer);
    _timer = setInterval(refresh, REFRESH_MS);
}

function disable() {
    setEnabledFlag(false);
    clearInterval(_timer);
    _timer = null;
    if (_layer) { _layer.clearMetarStations('main'); _layer.clearMetarStations('dual'); }
}

function init() {
    const cb = document.getElementById(TOGGLE_ID);
    if (!cb) return;
    // Start disabled so a stale flag doesn't auto-enable on reload.
    setEnabledFlag(false);
    cb.checked = false;
    cb.addEventListener('change', () => (cb.checked ? enable() : disable()));

    // When split screen toggles, re-render so the dual pane gains/loses stations.
    window.addEventListener('vortexsplitchange', () => { if (cb.checked) _layer && _layer.displayMetarStations(); });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
