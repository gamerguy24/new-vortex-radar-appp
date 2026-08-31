/*
 * app/radar/dual/dual_radar.js
 * Right-pane (dual) radar controller for split screen. Lives inside the bundle
 * so it can use loaders_nexrad; the split-screen toggle itself is the ES-module
 * component components/split_screen.js, which fires a 'vortexsplitchange' event.
 *
 * When split screen turns on we show a compact station + product picker over the
 * right pane and load NEXRAD into the 'dual' pane, independently of the main
 * pane (its own updater, its own state — see app/core/map/radar_panes.js). When
 * split turns off we tear the dual radar down.
 */

const loaders_nexrad = require('../libnexrad/loaders_nexrad');
const { pane_state, get_pane } = require('../../core/map/radar_panes');

// Tilt-1 Level 3 products (labels + codes mirror core/menu/productSelectionMenu).
const PRODUCTS = [
    { label: 'Base Reflectivity', value: 'N0B', srvel: false },
    { label: 'Base Velocity', value: 'N0G', srvel: false },
    { label: 'Storm-Rel Velocity', value: 'N0G', srvel: true },
    { label: 'Correlation Coeff', value: 'N0C', srvel: false },
    { label: 'Differential Refl (ZDR)', value: 'N0X', srvel: false },
    { label: 'Hydrometeor Class', value: 'N0H', srvel: false },
    { label: 'Specific Diff Phase (KDP)', value: 'N0K', srvel: false },
];

function dual_map() {
    return (window.vortexMap && window.vortexMap.dualMap) || null;
}

function set_status(msg) {
    const el = document.getElementById('drcStatus');
    if (el) el.textContent = msg || '';
}

function build_panel() {
    if (document.getElementById('dualRadarControls')) return;
    const opts = PRODUCTS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
    const wrap = document.createElement('div');
    wrap.id = 'dualRadarControls';
    wrap.style.display = 'none';
    wrap.innerHTML = `
        <div class="drc-title">Right pane radar</div>
        <div class="drc-row">
            <input id="drcStation" class="drc-input" placeholder="ICAO" maxlength="4" />
            <select id="drcProduct" class="drc-input">${opts}</select>
            <button id="drcLoad" class="drc-btn">Load</button>
        </div>
        <div id="drcStatus" class="drc-status"></div>`;
    document.body.appendChild(wrap);
    document.getElementById('drcLoad').addEventListener('click', load_dual);
    document.getElementById('drcStation').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') load_dual();
    });
}

// Normalize a user-typed site to an ICAO id (3-letter -> prefixed with K).
function normalize_station(raw) {
    const s = (raw || '').trim().toUpperCase();
    if (!s) return null;
    return s.length === 3 ? `K${s}` : s;
}

function when_style_ready(map, cb) {
    if (map && map.isStyleLoaded && map.isStyleLoaded()) return cb();
    if (map && map.once) {
        let done = false;
        const run = () => { if (!done) { done = true; cb(); } };
        map.once('load', run);
        map.once('style.load', run);
        setTimeout(run, 4000);
    }
}

function load_dual() {
    const station = normalize_station(document.getElementById('drcStation').value)
        || (window.vortexData && window.vortexData.currentStation);
    if (!station) { set_status('Enter a station (e.g. KTLX).'); return; }

    const idx = Number(document.getElementById('drcProduct').value) || 0;
    const p = PRODUCTS[idx];
    const dm = dual_map();
    if (!dm) { set_status('Split screen is not active.'); return; }

    set_status(`Loading ${station}…`);
    when_style_ready(dm, () => {
        const cb = () => set_status(`${station} · ${p.label}`);
        try {
            if (p.srvel) {
                loaders_nexrad.quick_storm_relative_velocity_plot(station, p.value, cb, 'dual');
            } else {
                loaders_nexrad.quick_level_3_plot(station, p.value, cb, 'dual');
            }
        } catch (err) {
            console.error('[DualRadar] load failed:', err);
            set_status('Could not load that station/product.');
        }
    });
}

// Remove the dual pane's radar layer + range ring and stop its updater.
function teardown_dual() {
    const S = pane_state('dual');
    if (S && S.current_RadarUpdater) {
        try { S.current_RadarUpdater.disable(); } catch (e) {}
        S.current_RadarUpdater = undefined;
    }
    const dm = dual_map();
    const pane = get_pane('dual');
    if (dm) {
        try {
            if (dm.getLayer(pane.layerId)) dm.removeLayer(pane.layerId);
            if (dm.getLayer(pane.rangeLayerId)) dm.removeLayer(pane.rangeLayerId);
            if (dm.getSource(pane.rangeSourceId)) dm.removeSource(pane.rangeSourceId);
        } catch (e) { /* map may be gone */ }
    }
    set_status('');
}

function init() {
    window.addEventListener('vortexsplitchange', (e) => {
        const active = !!(e.detail && e.detail.active);
        build_panel();
        const panel = document.getElementById('dualRadarControls');
        if (active) {
            const stEl = document.getElementById('drcStation');
            if (stEl && !stEl.value && window.vortexData && window.vortexData.currentStation) {
                stEl.value = window.vortexData.currentStation;
            }
            if (panel) panel.style.display = 'block';
        } else {
            if (panel) panel.style.display = 'none';
            teardown_dual();
        }
    });
}

init();

module.exports = { load_dual };
