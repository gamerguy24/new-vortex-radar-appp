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
 * In split screen the product menu, the station markers and the elevation
 * picker all have to act on ONE pane, and the operator says which by clicking
 * it — the same way RadarOmega works. Without this every control drove the left
 * pane and the right one could only ever be set from a separate little panel of
 * its own, which is the arrangement this replaces.
 *
 * Always 'main' when split screen is off, so nothing can strand a control on a
 * pane that is not on screen.
 */
function active_pane() {
    if (typeof window === 'undefined') return 'main';
    const split = document.body && document.body.classList.contains('vortex-split');
    if (!split) return 'main';
    return normalize(window.vortexData && window.vortexData.activePane);
}

function set_active_pane(target) {
    if (typeof window === 'undefined') return 'main';
    if (!window.vortexData) window.vortexData = {};
    const t = normalize(target);
    window.vortexData.activePane = t;

    // Mark the panes so CSS can show which one the controls are pointed at. A
    // mode you cannot see is a mode you will forget you are in.
    const main = document.getElementById('map');
    const dual = document.getElementById('mapDual');
    if (main) main.classList.toggle('vortex-pane-active', t === 'main');
    if (dual) dual.classList.toggle('vortex-pane-active', t === 'dual');

    window.dispatchEvent(new CustomEvent('vortexpanechange', { detail: { pane: t } }));
    return t;
}

module.exports = { get_pane, pane_state, active_pane, set_active_pane };
