/*
 * manual_storm_track.js
 * Controller for the Manual Storm Track tool.
 *
 * Cellular vs. Linear mode (see the mode bar):
 *   Cellular (default) — best for a single isolated storm. Press, hold and drag
 *     in the direction the storm is moving, release, then type the storm's
 *     speed. We project a widening cone and list the towns it will cross.
 *   Linear — for a line of storms. Same drag gesture, but the forecast area is a
 *     wide corridor swept forward from a perpendicular leading edge.
 *
 * The gesture is captured off the Mapbox canvas (panning is disabled while the
 * tool is armed). Everything is drawn as GeoJSON layers so it stays pinned to
 * the map through pan/zoom.
 */

const map = require('../../core/map/map');
const turf = require('@turf/turf');
const ui = require('./mst_ui');
const { buildTrack, computeImpacts } = require('./mst_geometry');
const { getCities } = require('./mst_cities');

const SRC = {
    swath: 'mst-swath-src',
    line: 'mst-line-src',
    ticks: 'mst-ticks-src',
    ends: 'mst-ends-src',
};

const state = {
    active: false,
    mode: 'cellular',
    dragging: false,
    start: null,      // [lng,lat]
    current: null,    // [lng,lat]
    speed: null,      // last entered speed (mph)
    track: null,      // last built track
};

// ---- map layers --------------------------------------------------------------
function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

function ensureLayers() {
    if (map.getSource(SRC.swath)) return;

    map.addSource(SRC.swath, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.line, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.ticks, { type: 'geojson', data: emptyFC() });
    map.addSource(SRC.ends, { type: 'geojson', data: emptyFC() });

    map.addLayer({
        id: 'mst-swath-fill', type: 'fill', source: SRC.swath,
        paint: { 'fill-color': '#2f6df6', 'fill-opacity': 0.22 },
    });
    map.addLayer({
        id: 'mst-swath-outline', type: 'line', source: SRC.swath,
        paint: { 'line-color': '#8fbaff', 'line-width': 1.2, 'line-opacity': 0.7 },
    });
    map.addLayer({
        id: 'mst-line', type: 'line', source: SRC.line,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ff3b30', 'line-width': 3.5 },
    });
    // Endpoint dots (origin + tip).
    map.addLayer({
        id: 'mst-ends', type: 'circle', source: SRC.ends,
        paint: {
            'circle-radius': 5,
            'circle-color': ['case', ['==', ['get', 'kind'], 'origin'], '#ff3b30', '#ffffff'],
            'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
        },
    });
    // ETA tick marks + labels.
    map.addLayer({
        id: 'mst-ticks', type: 'circle', source: SRC.ticks,
        paint: { 'circle-radius': 3.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#1f3a63', 'circle-stroke-width': 1.5 },
    });
    map.addLayer({
        id: 'mst-ticks-label', type: 'symbol', source: SRC.ticks,
        layout: {
            'text-field': ['concat', ['to-string', ['get', 'min']], ' min'],
            'text-size': 11, 'text-offset': [0, -1.1], 'text-anchor': 'bottom',
            'text-allow-overlap': true,
        },
        paint: { 'text-color': '#eaf2ff', 'text-halo-color': '#0b1220', 'text-halo-width': 1.4 },
    });
}

function setData(src, data) { const s = map.getSource(src); if (s) s.setData(data); }

function clearLayers() {
    if (!map.getSource(SRC.swath)) return;
    setData(SRC.swath, emptyFC());
    setData(SRC.line, emptyFC());
    setData(SRC.ticks, emptyFC());
    setData(SRC.ends, emptyFC());
}

// Live preview of just the motion arrow while dragging.
function renderPreview(start, current) {
    ensureLayers();
    setData(SRC.line, turf.multiLineString([[start, current]]));
    setData(SRC.ends, {
        type: 'FeatureCollection',
        features: [turf.point(start, { kind: 'origin' })],
    });
}

// Full render after a speed is entered.
function renderTrack(track) {
    ensureLayers();
    setData(SRC.swath, track.swath);
    setData(SRC.line, track.arrow);
    setData(SRC.ends, {
        type: 'FeatureCollection',
        features: [
            turf.point(track.centerline.geometry.coordinates[0], { kind: 'origin' }),
            turf.point(track.tipCoord, { kind: 'tip' }),
        ],
    });
    setData(SRC.ticks, {
        type: 'FeatureCollection',
        features: track.ticks.map((t) => turf.point(t.coord, { min: t.min })),
    });
}

// ---- motion helpers ----------------------------------------------------------
const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function compass(bearing) {
    const b = (bearing % 360 + 360) % 360;
    return DIRS[Math.round(b / 22.5) % 16];
}

// ---- gesture handling --------------------------------------------------------
function onDown(e) {
    if (!state.active) return;
    e.preventDefault();
    ui.removeSpeedPopup();
    ui.removeImpactPanel();
    clearLayers();
    state.dragging = true;
    state.start = [e.lngLat.lng, e.lngLat.lat];
    state.current = state.start;
    map.getCanvas().style.cursor = 'crosshair';
}

function onMove(e) {
    if (!state.active || !state.dragging) return;
    state.current = [e.lngLat.lng, e.lngLat.lat];
    renderPreview(state.start, state.current);
}

function onUp(e) {
    if (!state.active || !state.dragging) return;
    state.dragging = false;
    state.current = [e.lngLat.lng, e.lngLat.lat];

    const moved = turf.distance(turf.point(state.start), turf.point(state.current), { units: 'miles' });
    if (moved < 0.3) { // a tap, not a drag
        clearLayers();
        ui.showHint('Press and drag in the direction the storm is moving.');
        return;
    }
    ui.removeHint();
    const px = map.project(state.current);
    ui.showSpeedPopup(
        { x: px.x, y: px.y },
        (speed) => calculate(speed),
        () => { ui.removeSpeedPopup(); clearLayers(); if (state.active) ui.showHint(hintText()); },
    );
}

function calculate(speedMph) {
    ui.removeSpeedPopup();
    state.speed = speedMph;
    const bearing = turf.bearing(turf.point(state.start), turf.point(state.current));
    const track = buildTrack({ origin: state.start, bearing, speedMph, mode: state.mode });
    state.track = track;
    renderTrack(track);

    const motionText = `${compass(bearing)} at ${Math.round(speedMph)} mph`;
    const impacts = computeImpacts(track, getCities(), { origin: state.start, speedMph, now: Date.now() });
    ui.showImpactPanel(impacts, { motionText, mode: state.mode }, () => reset());
}

// ---- lifecycle ---------------------------------------------------------------
function hintText() {
    return state.mode === 'linear'
        ? 'Linear mode — drag across the line of storms, then enter its speed.'
        : 'Cellular mode — press, hold and drag in the direction of storm motion.';
}

function reset() {
    ui.removeSpeedPopup();
    ui.removeImpactPanel();
    clearLayers();
    state.start = state.current = state.track = state.speed = null;
    state.dragging = false;
    if (state.active) ui.showHint(hintText());
}

function bindMap() {
    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    map.on('touchstart', onDown);
    map.on('touchmove', onMove);
    map.on('touchend', onUp);
}
function unbindMap() {
    map.off('mousedown', onDown);
    map.off('mousemove', onMove);
    map.off('mouseup', onUp);
    map.off('touchstart', onDown);
    map.off('touchmove', onMove);
    map.off('touchend', onUp);
}

function enable() {
    if (state.active) return;
    state.active = true;
    ensureLayers();
    // Take over the drag so it draws instead of panning the map.
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'crosshair';
    bindMap();
    ui.showModeBar(() => state.mode, (m) => {
        state.mode = m;
        // Re-render an existing track in the new mode; otherwise just re-hint.
        if (state.start && state.current && state.speed) {
            calculate(state.speed);
        } else {
            ui.showHint(hintText());
        }
    });
    ui.showHint(hintText());
}

function disable() {
    if (!state.active) return;
    state.active = false;
    state.dragging = false;
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    unbindMap();
    clearLayers();
    ui.removeAll();
}

function toggle() { state.active ? disable() : enable(); }
function isActive() { return state.active; }

module.exports = { enable, disable, toggle, isActive };
