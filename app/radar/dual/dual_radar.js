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
const { pane_state, get_pane, set_active_pane } = require('../../core/map/radar_panes');

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

/*
 * THEMING AND PANE FOCUS LIVE HERE, NOT IN components/split_screen.js.
 *
 * Only index.css and bundle.js are cache-busted (index.html rewrites their URLs
 * from tools/size.txt). The ES-module components are plain <script> tags, so a
 * browser will happily serve a months-old split_screen.js next to a fresh
 * bundle — which is exactly what happened: the right pane kept the stock Mapbox
 * dark style and clicking it did not aim the product menu, because the code for
 * both was sitting in a cached copy of that file. Anything that has to be right
 * after a deploy belongs in the bundle.
 */

/*
 * Paint the RIGHT pane with the Vortex basemap.
 *
 * apply_vortex_basemap() defers via once('style.load') when the style is not
 * readable yet — but split_screen called it FROM a style.load handler, where
 * isStyleLoaded() is still false and that event will never fire again. So it
 * deferred forever and the pane stayed dark. Polling until the style is
 * genuinely readable side-steps that entirely.
 *
 * dual_map() is passed explicitly, so this can only ever repaint the right
 * pane; a retry loop that could reach the main map once blanked the whole app.
 */
function theme_dual(attempt = 0) {
    const dm = dual_map();
    if (!dm) return;
    try {
        if (dm.isStyleLoaded && dm.isStyleLoaded()) {
            // Required here, not at module scope: vortex_basemap pulls in map.js,
            // which builds the Mapbox instance on require. Load order is not
            // something a right-pane feature should be moving around.
            require('../../core/map/vortex_basemap').apply_vortex_basemap(dm);
            return;
        }
    } catch (e) { /* fall through to the retry */ }

    // ~10s: the pane's map is built on first open, so this waits out a cold
    // style download on a slow connection rather than giving up at 2s.
    if (attempt >= 100) {
        console.warn('[DualRadar] right pane style never became readable; leaving the default theme.');
        return;
    }
    setTimeout(() => theme_dual(attempt + 1), 100);
}

/*
 * Click a pane to aim the product menu at it.
 *
 * Capture phase, so the pane registers before Mapbox's own handlers run, and
 * every call is guarded: this is a convenience, and a failure here must never
 * interfere with using the map. Only marked bound once BOTH panes are wired,
 * so an early call cannot leave one of them dead.
 */
let pane_focus_bound = false;
function install_pane_focus() {
    if (pane_focus_bound) return;
    const bind = (id, target) => {
        const el = document.getElementById(id);
        if (!el) return false;
        el.addEventListener('pointerdown', () => {
            if (!document.body.classList.contains('vortex-split')) return;
            try { set_active_pane(target); } catch (e) { /* cosmetic */ }
        }, true);
        return true;
    };
    const main_ok = bind('map', 'main');
    const dual_ok = bind('mapDual', 'dual');
    pane_focus_bound = main_ok && dual_ok;
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
            theme_dual();
            install_pane_focus();
            // Start on the left pane, so the first product choice after opening
            // split screen lands where the operator is already looking.
            set_active_pane('main');
            // Give the right pane something to show. Mapbox needs a frame to
            // size the new canvas before a layer added to it will draw.
            setTimeout(() => seed_dual(), 0);
        } else {
            // Hand the controls back to the only pane left on screen, or the
            // next product choice would vanish into a hidden map.
            set_active_pane('main');
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

// Published for the console and for any ES-module component that needs to know
// or set which pane the controls are driving (it cannot require() into here).
if (typeof window !== 'undefined') {
    const panes = require('../../core/map/radar_panes');
    window.vortexPanes = { setActive: panes.set_active_pane, active: panes.active_pane };
}

module.exports = { seed_dual, teardown_dual, theme_dual };
