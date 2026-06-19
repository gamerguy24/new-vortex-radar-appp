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

// Dark-grey (charcoal/slate) palette — not black, not light.
const VORTEX_PALETTE = {
    land:          'rgb(62, 66, 72)',     // dark grey (dominant background)
    water:         'rgb(46, 50, 56)',     // slightly darker grey
    national_park: 'rgb(58, 70, 60)',     // muted dark grey-green
    landuse:       'rgb(68, 72, 78)',     // a touch lighter than land
    road:          'rgb(120, 127, 138)',  // light-grey roads, visible on charcoal
    boundary:      'rgb(150, 157, 168)',  // light-grey admin / county lines
    label_text:    'rgb(233, 237, 243)',  // light labels (readable on dark grey)
    label_halo:    'rgb(38, 41, 46)',     // dark halo for legibility
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
