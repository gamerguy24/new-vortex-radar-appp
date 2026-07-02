/*
 * radar_panes.js
 * Pane registry for dual-radar support. Each pane owns its own map, its own
 * radar WebGL layer + range-ring layer ids, and its own slice of radar state.
 *
 * The app historically kept a single radar's state on window.atticData (cmin,
 * cmax, fb, current_RadarUpdater, current_nexrad_location, current_elevation_angle,
 * ...), read from many modules. To stay backward-compatible, the 'main' pane's
 * state IS window.atticData; the 'dual' pane gets its own namespace under
 * window.atticData.panes.dual. New code should read/write radar state via
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
// window.atticData for backward compatibility with existing readers.
function pane_state(target) {
    if (typeof window === 'undefined') return {};
    if (!window.atticData) window.atticData = {};
    if (normalize(target) === 'main') return window.atticData;
    if (!window.atticData.panes) window.atticData.panes = {};
    if (!window.atticData.panes.dual) window.atticData.panes.dual = {};
    return window.atticData.panes.dual;
}

module.exports = { get_pane, pane_state };
