/*
 * Vortex Radar basemap theme.
 *
 * Re-tints the Mapbox basemap to a distinct deep-navy palette (instead of the
 * default neutral-gray look) so the map has its own identity. Works by setting
 * paint properties on the existing style — it does NOT swap the whole style, so
 * all the radar / alert / marker layers stay intact.
 */

const map = require('./map');

// Distinct deep-navy / slate palette.
const VORTEX_PALETTE = {
    land:          'rgb(15, 19, 29)',   // deep navy-slate (the dominant background)
    water:         'rgb(7, 11, 20)',    // near-black blue
    national_park: 'rgb(18, 30, 28)',   // faint dark green
    landuse:       'rgb(21, 27, 39)',   // a touch lighter than land
    road:          'rgb(42, 50, 68)',   // muted slate roads (not RadarScope blue)
    boundary:      'rgb(86, 99, 124)',  // dimmer admin/county lines
};

function _set(layer, prop, value) {
    try { if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value); }
    catch (e) { /* layer/prop not present in this style */ }
}

function apply_vortex_basemap() {
    // Known base layers (the app already drives these for light/dark/satellite).
    _set('land', 'background-color', VORTEX_PALETTE.land);
    _set('national-park', 'fill-color', VORTEX_PALETTE.national_park);
    _set('landuse', 'fill-color', VORTEX_PALETTE.landuse);
    _set('water', 'fill-color', VORTEX_PALETTE.water);

    // Recolor roads + administrative boundaries by scanning the style's line
    // layers (guarded — only touches matching line layers, leaves the rest).
    try {
        const layers = (map.getStyle() && map.getStyle().layers) || [];
        for (const l of layers) {
            if (l.type !== 'line') continue;
            const id = l.id || '';
            if (/road|street|bridge|tunnel|motorway|highway|transit/i.test(id)) {
                _set(id, 'line-color', VORTEX_PALETTE.road);
            } else if (/admin|boundary|border/i.test(id)) {
                _set(id, 'line-color', VORTEX_PALETTE.boundary);
            }
        }
    } catch (e) { /* getStyle not ready */ }
}

module.exports = { apply_vortex_basemap, VORTEX_PALETTE };
