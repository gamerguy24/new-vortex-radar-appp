/*
 * radar_panes.js
 * Pane registry for dual-radar support. Each pane owns its own map, its own
 * radar WebGL layer + range-ring layer ids, and its own slice of radar state.
 *
 * The app historically kept a single radar's state on window.vortexData (cmin,
 * cmax, fb, current_RadarUpdater, current_nexrad_location, current_elevation_angle,
 * ...), read from many modules. To stay backward-compatible, the 'main' pane's
 * state IS window.vortexData; the 'dual' pane gets its own namespace under
 * window.vortexData.panes.dual. New code should read/write radar state via
 * pane_state(target) so both panes stay independent.
 *
 * The dual map is created lazily by components/split_screen.js and published as
 * window.vortexMap.dualMap, so we look it up on demand rather than at require
 * time (load order / it may not exist yet).
 */

// Lazily resolve the main map so requiring this module doesn't force map.js to
// execute (and build the Mapbox instance) earlier in the require chain.
function main_map() {
    return require('./map');
}

function dual_map() {
    return (typeof window !== 'undefined' && window.vortexMap && window.vortexMap.dualMap) || null;
}

const PANES = {
    main: {
        id: 'main',
        layerId: 'baseReflectivity',
        rangeSourceId: 'station_range_source',
        rangeLayerId: 'station_range_layer',
        getMap: () => main_map(),
    },
    dual: {
        id: 'dual',
        layerId: 'baseReflectivity-dual',
        rangeSourceId: 'station_range_source-dual',
        rangeLayerId: 'station_range_layer-dual',
        getMap: () => dual_map(),
    },
};

function normalize(target) {
    return target === 'dual' ? 'dual' : 'main';
}

// Return the pane descriptor for a target ('main' | 'dual').
function get_pane(target) {
    return PANES[normalize(target)];
}

// Return the mutable radar-state object for a pane. 'main' aliases
// window.vortexData for backward compatibility with existing readers.
function pane_state(target) {
    if (typeof window === 'undefined') return {};
    if (!window.vortexData) window.vortexData = {};
    if (normalize(target) === 'main') return window.vortexData;
    if (!window.vortexData.panes) window.vortexData.panes = {};
    if (!window.vortexData.panes.dual) window.vortexData.panes.dual = {};
    return window.vortexData.panes.dual;
}

/*
 * WHICH PANE DO THE CONTROLS DRIVE?
 *
 * In split screen the product menu has to act on ONE pane, and the operator
 * says which by clicking it — the way RadarOmega works. Purely additive: no
 * existing function's behaviour changes, and active_pane() returns 'main'
 * whenever split screen is off, so single-pane use cannot be affected.
 */
function active_pane() {
    try {
        if (typeof document === 'undefined' || !document.body) return 'main';
        if (!document.body.classList.contains('vortex-split')) return 'main';
        return normalize(window.vortexData && window.vortexData.activePane);
    } catch (e) {
        return 'main';   // any doubt at all, drive the pane that is always there
    }
}

function set_active_pane(target) {
    const t = normalize(target);
    try {
        if (!window.vortexData) window.vortexData = {};
        window.vortexData.activePane = t;
        // Mark the panes so CSS can show which one is being driven. A mode you
        // cannot see is a mode you forget you are in, and forgetting here means
        // changing the wrong map during severe weather.
        const main = document.getElementById('map');
        const dual = document.getElementById('mapDual');
        if (main) main.classList.toggle('vortex-pane-active', t === 'main');
        if (dual) dual.classList.toggle('vortex-pane-active', t === 'dual');
    } catch (e) { /* cosmetic; never worth throwing over */ }
    return t;
}

module.exports = { get_pane, pane_state, active_pane, set_active_pane };
