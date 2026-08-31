/*
 * app/radar/dual/dual_radar.js
 * Right-pane (dual) radar controller for split screen. Lives inside the bundle
 * so it can use loaders_nexrad; the split-screen toggle itself is the ES-module
 * component components/split_screen.js, which fires a 'vortexsplitchange' event.
 *
 * THERE IS NO SEPARATE RIGHT-PANE PANEL ANY MORE.
 *
 * This used to put a little station + product picker over the right pane, so the
 * two panes were driven by two different controls and the app's own product menu
 * always changed the LEFT one — which meant choosing a product while looking at
 * the right pane changed the wrong map.
 *
 * It now works the way RadarOmega does: click a pane to make it active, and the
 * app's normal product menu, station markers and tilt picker all act on that
 * pane until you click the other one. This file's job is reduced to
 *
 *   - remembering which pane the controls point at (radar_panes.active_pane)
 *   - putting the same radar in the right pane when split opens, so the compare
 *     view starts as a comparison rather than a live map beside a blank one
 *   - tearing the dual radar down when split closes
 */

const loaders_nexrad = require('../libnexrad/loaders_nexrad');
const { pane_state, get_pane, active_pane, set_active_pane } = require('../../core/map/radar_panes');

function dual_map() {
    return (window.vortexMap && window.vortexMap.dualMap) || null;
}

function when_style_ready(map, cb) {
    if (map && map.isStyleLoaded && map.isStyleLoaded()) return cb();
    if (!map) return;
    let done = false;
    const run = () => { if (!done) { done = true; cb(); } };
    map.once('style.load', run);
    // 'idle' is the reliable second chance: isStyleLoaded() can still be false
    // inside a style.load handler, and style.load never fires twice.
    map.once('idle', run);
}

/**
 * Put a radar in the right pane.
 *
 * Defaults to whatever the LEFT pane is showing, which is what makes the
 * compare view useful the instant it opens: the same site and product on both
 * sides, ready for the operator to click the right pane and change one of them.
 */
function seed_dual(station, product) {
    const dm = dual_map();
    if (!dm) return;

    const main = window.vortexData || {};
    const S = pane_state('dual');

    const site = station || S.currentStation || main.currentStation;
    // current_loop_product is the Level 3 code actually on screen (e.g. N0B).
    const code = product || S.current_loop_product || main.current_loop_product || 'N0B';
    if (!site) return;

    S.currentStation = site;
    S.current_loop_product = code;
    S.from_file_upload = false;

    when_style_ready(dm, () => {
        try {
            loaders_nexrad.quick_level_3_plot(site, code, () => {}, 'dual');
        } catch (err) {
            console.error('[DualRadar] could not seed the right pane:', err);
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
}

/*
 * Clicking a pane aims the controls at it.
 *
 * Bound in the CAPTURE phase on the container, so it registers the pane before
 * Mapbox's own handlers or a marker's click handler run — otherwise clicking a
 * station marker in the right pane would set the pane only after the marker had
 * already loaded into the old one.
 */
function install_pane_focus() {
    const bind = (id, target) => {
        const el = document.getElementById(id);
        if (!el || el._vxPaneBound) return;
        el._vxPaneBound = true;
        el.addEventListener('pointerdown', () => {
            if (!document.body.classList.contains('vortex-split')) return;
            if (active_pane() !== target) set_active_pane(target);
        }, true);
    };
    bind('map', 'main');
    bind('mapDual', 'dual');
}

function init() {
    install_pane_focus();

    window.addEventListener('vortexsplitchange', (e) => {
        const active = !!(e.detail && e.detail.active);
        if (active) {
            install_pane_focus();          // #mapDual may have only just appeared
            set_active_pane('main');
        } else {
            // Leaving split screen must hand the controls back to the only pane
            // left, or the next product choice would vanish into a hidden map.
            set_active_pane('main');
            teardown_dual();
        }
    });
}

init();

// Reached from components/split_screen.js, which is an ES module outside this
// bundle and so cannot require() into it.
if (typeof window !== 'undefined') {
    window.vortexDualRadar = { seed: seed_dual, teardown: teardown_dual };
    window.vortexPanes = { setActive: set_active_pane, active: active_pane };
}

module.exports = { seed_dual, teardown_dual };
