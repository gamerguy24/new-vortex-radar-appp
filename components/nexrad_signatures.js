/*
 * components/nexrad_signatures.js
 * Drives the Storm Centers layer (js/nexrad_signatures.js) from two LAYERS
 * toggles: TVS signatures and hail signatures.
 *
 * The class expects a map wrapper with .map/.dualMap, isSplit(), and
 * currentMainStation/currentSplitStation. This app exposes the map as
 * window.vortexMap = { map, dualMap } and the open radar site as
 * window.atticData.currentStation, so we pass a thin adapter that bridges them.
 * Storm attributes update per volume scan, so we refresh on an interval while on.
 */
import StormCentersLayer from '../js/nexrad_signatures.js';

const TVS_ID = 'toggle-tvs-signatures-layer';
const HAIL_ID = 'toggle-hail-signatures-layer';
const REFRESH_MS = 2 * 60 * 1000; // 2 minutes

let _layer = null;
let _timer = null;

function adapter() {
    const w = window.vortexMap;
    if (!w || !w.map) return null;
    return {
        get map() { return w.map; },
        get dualMap() { return w.dualMap; },
        get layers() { return w.layers; },
        // The currently open radar site drives which storm cells are shown.
        get currentMainStation() { return window.atticData?.currentStation; },
        get currentSplitStation() { return window.atticData?.currentStation; },
        isSplit() { return typeof w.isSplit === 'function' ? w.isSplit() : !!w.dualMap; },
    };
}

// The class reads these localStorage flags (via _areStormCentersEnabled) before
// falling back to the checkboxes, so keep them in sync with the toggles.
function setFlags(tvs, hail) {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('layerSettings') || '{}'); } catch {}
    s.tvsSignaturesEnabled = tvs;
    s.hailSignaturesEnabled = hail;
    try { localStorage.setItem('layerSettings', JSON.stringify(s)); } catch {}
}

async function apply() {
    const tvs = !!document.getElementById(TVS_ID)?.checked;
    const hail = !!document.getElementById(HAIL_ID)?.checked;
    setFlags(tvs, hail);

    if (!tvs && !hail) {
        clearInterval(_timer);
        _timer = null;
        if (_layer) { _layer.clearStormCenters('main'); _layer.clearStormCenters('dual'); }
        return;
    }

    const a = adapter();
    if (!a) { console.warn('[StormCenters] Map not ready yet.'); return; }
    if (!_layer) _layer = new StormCentersLayer(a);

    _layer.setEnabledTypes({ tvs, hail });
    await _layer.fetchStormCenters();

    clearInterval(_timer);
    _timer = setInterval(async () => {
        if (!_layer) return;
        await _layer.fetchStormCenters();
    }, REFRESH_MS);
}

function init() {
    const tvsCb = document.getElementById(TVS_ID);
    const hailCb = document.getElementById(HAIL_ID);
    if (!tvsCb && !hailCb) return;

    // Start disabled so stale flags don't auto-enable on reload.
    setFlags(false, false);
    if (tvsCb) tvsCb.checked = false;
    if (hailCb) hailCb.checked = false;

    tvsCb?.addEventListener('change', apply);
    hailCb?.addEventListener('change', apply);

    // Re-render on split toggle so the dual pane gains/loses storm centers.
    window.addEventListener('vortexsplitchange', () => {
        if (_layer && (tvsCb?.checked || hailCb?.checked)) _layer.displayStormCenters();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
