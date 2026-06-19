/*
 * Vortex Radar basemap theme.
 *
 * Re-tints the Mapbox basemap to a clean LIGHT-GREY palette (instead of the
 * default dark / RadarScope-like look) so the map has its own identity. Works by
 * setting paint properties on the existing style — it does NOT swap the whole
 * style, so all the radar / alert / marker layers stay intact.
 *
 * Only the basemap's own vector layers (source === 'composite') are retinted,
 * so app-added layers (station pills, alerts, reports, etc.) are untouched.
 */

const map = require('./map');

// Light-grey daytime palette.
const VORTEX_PALETTE = {
    land:          'rgb(224, 227, 231)',  // light grey (dominant background)
    water:         'rgb(193, 205, 219)',  // soft blue-grey
    national_park: 'rgb(206, 222, 204)',  // pale green
    landuse:       'rgb(216, 220, 225)',  // slightly distinct light grey
    road:          'rgb(255, 255, 255)',  // white roads pop on grey
    boundary:      'rgb(150, 158, 171)',  // mid-grey admin / county lines
    label_text:    'rgb(45, 52, 66)',     // dark slate (readable on grey)
    label_halo:    'rgb(245, 247, 250)',  // near-white halo for legibility
};

const BASE_SOURCE = 'composite'; // Mapbox vector basemap source

function _set(layer, prop, value) {
    try { if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value); }
    catch (e) { /* layer/prop not present in this style */ }
}

function apply_vortex_basemap() {
    // Known base fills/background (these drive the overall color).
    _set('land', 'background-color', VORTEX_PALETTE.land);
    _set('national-park', 'fill-color', VORTEX_PALETTE.national_park);
    _set('landuse', 'fill-color', VORTEX_PALETTE.landuse);
    _set('water', 'fill-color', VORTEX_PALETTE.water);

    let layers = [];
    try { layers = (map.getStyle() && map.getStyle().layers) || []; } catch (e) { return; }

    for (const l of layers) {
        // Only touch the basemap's own vector layers — never app layers.
        if (l.source !== BASE_SOURCE) continue;
        const id = l.id || '';

        if (l.type === 'background') {
            _set(id, 'background-color', VORTEX_PALETTE.land);
        } else if (l.type === 'fill') {
            if (/water/i.test(id)) _set(id, 'fill-color', VORTEX_PALETTE.water);
            else if (/park|grass|wood|forest|green/i.test(id)) _set(id, 'fill-color', VORTEX_PALETTE.national_park);
            else if (/land|building/i.test(id)) _set(id, 'fill-color', VORTEX_PALETTE.landuse);
        } else if (l.type === 'line') {
            if (/admin|boundary|border/i.test(id)) _set(id, 'line-color', VORTEX_PALETTE.boundary);
            else if (/water/i.test(id)) _set(id, 'line-color', VORTEX_PALETTE.water);
            else if (/road|street|bridge|tunnel|motorway|highway|transit/i.test(id)) _set(id, 'line-color', VORTEX_PALETTE.road);
        } else if (l.type === 'symbol') {
            // Darken place / road labels so they read on the light grey map.
            _set(id, 'text-color', VORTEX_PALETTE.label_text);
            _set(id, 'text-halo-color', VORTEX_PALETTE.label_halo);
            _set(id, 'text-halo-width', 1.2);
        }
    }
}

module.exports = { apply_vortex_basemap, VORTEX_PALETTE };
