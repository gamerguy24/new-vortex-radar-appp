/*
 * app/radar/dual/dual_radar.js
 * Right-pane (dual) radar controller for split screen. Lives inside the bundle
 * so it can use loaders_nexrad; the split-screen toggle itself is the ES-module
 * component components/split_screen.js, which fires a 'vortexsplitchange' event.
 *
 * When split screen turns on we seed the right pane with a radar and let the
 * app's own product menu drive it (click a pane to aim the menu). The dual pane
 * keeps its own updater and its own slice of state — see
 * app/core/map/radar_panes.js. When split turns off we tear the dual radar down.
 */

const loaders_nexrad = require('../libnexrad/loaders_nexrad');
const { pane_state, get_pane } = require('../../core/map/radar_panes');

function dual_map() {
    return (window.vortexMap && window.vortexMap.dualMap) || null;
}

/*
 * There is no right-pane control panel.
 *
 * There used to be a station + product box floating over the right pane, which
 * meant two panes driven by two different controls — and the app's own product
 * menu always changed the LEFT one, so choosing a product while looking at the
 * right pane changed the wrong map.
 *
 * Now: click a pane to select it, then use the app's normal product menu. The
 * right pane gets its first radar from seed_dual() when split opens, and
 * follows the left pane's station after that.
 */

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

/**
 * Put a radar in the right pane.
 *
 * Defaults to whatever the LEFT pane is showing, so the compare view opens as a
 * comparison rather than a live map beside an empty one. After that the
 * operator clicks the right pane and changes its product from the app's normal
 * menu, and the station follows the left pane.
 *
 * @param {string} [station]  ICAO; defaults to the left pane's site
 * @param {string} [product]  Level 3 code (e.g. N0B); defaults to the right
 *                            pane's current product, else the left pane's
 */
function seed_dual(station, product) {
    const dm = dual_map();
    if (!dm) return;

    const main = window.vortexData || {};
    const S = pane_state('dual');

    const site = station || S.currentStation || main.currentStation;
    const code = product || S.current_loop_product || main.current_loop_product || 'N0B';
    if (!site) return;

    S.currentStation = site;
    S.current_loop_product = code;
    S.from_file_upload = false;

    when_style_ready(dm, () => {
        try {
            loaders_nexrad.quick_level_3_plot(site, code, () => {}, 'dual');
        } catch (err) {
            console.error('[DualRadar] could not load the right pane:', err);
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

function init() {
    window.addEventListener('vortexsplitchange', (e) => {
        const active = !!(e.detail && e.detail.active);
        if (active) {
            // Give the right pane something to show. Mapbox needs a frame to
            // size the new canvas before a layer added to it will draw.
            setTimeout(() => seed_dual(), 0);
        } else {
            teardown_dual();
        }
    });

    /*
     * One station, two products.
     *
     * Station markers only exist on the left map, so picking a site there is
     * the only way to change sites at all — the right pane follows it and keeps
     * whatever product it was showing. That is the RadarOmega behaviour the
     * removed control box was getting in the way of.
     */
    window.addEventListener('vortexstationchange', (e) => {
        if (!document.body.classList.contains('vortex-split')) return;
        const station = e.detail && e.detail.station;
        if (station) seed_dual(station);
    });
}

init();

// Reached from components/split_screen.js, which is an ES module outside this
// bundle and so cannot require() into it.
if (typeof window !== 'undefined') {
    const panes = require('../../core/map/radar_panes');
    window.vortexPanes = { setActive: panes.set_active_pane, active: panes.active_pane };
}

module.exports = { seed_dual, teardown_dual };
