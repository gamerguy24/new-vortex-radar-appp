/*
 * Echo Radar basemap theme.
 *
 * Re-tints the Mapbox basemap to Echo Radar's own palette: a medium-light
 * neutral grey landmass with a true blue ocean, dark boundaries, and dark
 * labels on a light halo. This is what stops the map reading as the stock
 * Mapbox dark style that every other radar app (this one's ancestor included)
 * ships with.
 *
 * It works by setting paint properties on the style that is already loaded — it
 * never swaps the style — so every radar / alert / marker layer the app has
 * added stays exactly where it is. Only the basemap's own vector layers are
 * touched (source 'composite', plus the sourceless background layer).
 *
 * Land is deliberately lighter than the radar palette's low-reflectivity greens
 * and blues so returns stay legible, and the ocean blue is desaturated well
 * below anything in the reflectivity ramp so coastline never reads as echo.
 *
 * apply_vortex_basemap(targetMap) takes an optional map so the split-screen
 * second map (components/split_screen.js) gets the identical treatment.
 */

const map = require('./map');

/*
 * The colours live in components/basemap_palette.json, not here.
 *
 * The 24/7 broadcast page (broadcast/index.html) has to paint the same map and
 * cannot require() this file — it is standalone and this is CommonJS inside the
 * bundle. With the palette written out in both places the YouTube feed drifted
 * to a different-looking map than the app. One file, fetched there, required
 * here.
 *
 * Surfaces, lines, then type: land deliberately lighter than the radar
 * palette's low greens and blues so returns stay legible, and the ocean
 * desaturated below anything in the reflectivity ramp so coastline never reads
 * as echo.
 */
const PALETTE_JSON = require('../../../components/basemap_palette.json');
const VORTEX_PALETTE = Object.freeze({ ...PALETTE_JSON });

const BASE_SOURCE = 'composite'; // Mapbox vector basemap source

function _set(m, layer, prop, value) {
    try { if (m.getLayer(layer)) m.setPaintProperty(layer, prop, value); }
    catch (e) { /* layer or property not present in this style — fine */ }
}

// Roads come as paired fill/casing layers; casing ids end in "-case".
function _isCasing(id) { return /(^|[-_])case($|[-_])|casing/i.test(id); }
function _isMajorRoad(id) { return /motorway|trunk|highway/i.test(id); }

function apply_vortex_basemap(targetMap) {
    const m = targetMap || map;
    if (!m || typeof m.getStyle !== 'function') return;

    // Called before the style finished loading (boot order, or a style swap)?
    // There is nothing to paint yet — wait for the style and re-run once.
    try {
        if (typeof m.isStyleLoaded === 'function' && !m.isStyleLoaded()) {
            m.once('style.load', () => apply_vortex_basemap(m));
            return;
        }
    } catch (e) { /* older gl-js without isStyleLoaded — just carry on */ }

    // The named base layers in the Mapbox standard styles. Set explicitly first
    // so the map is right even if the layer walk below finds nothing.
    _set(m, 'land', 'background-color', VORTEX_PALETTE.land);
    _set(m, 'background', 'background-color', VORTEX_PALETTE.land);
    _set(m, 'national-park', 'fill-color', VORTEX_PALETTE.national_park);
    _set(m, 'landuse', 'fill-color', VORTEX_PALETTE.landuse);
    _set(m, 'water', 'fill-color', VORTEX_PALETTE.water);

    let layers = [];
    try { layers = (m.getStyle() && m.getStyle().layers) || []; } catch (e) { return; }

    for (const l of layers) {
        const id = l.id || '';
        // Background layers carry no source, so they must be allowed through
        // before the source check below.
        if (l.type === 'background') {
            _set(m, id, 'background-color', VORTEX_PALETTE.land);
            continue;
        }
        // Never touch layers the app added (radar, alerts, markers, tracks).
        if (l.source !== BASE_SOURCE) continue;
        // Our own layers on the basemap source (road_shields.js) carry their own
        // colours: white on an interstate's blue, dark on a white state circle.
        if (id.startsWith('vx-')) continue;

        if (l.type === 'fill') {
            if (/water|ocean|sea|bathymetry/i.test(id)) _set(m, id, 'fill-color', VORTEX_PALETTE.water);
            else if (/park|grass|wood|forest|green|pitch|cemetery/i.test(id)) _set(m, id, 'fill-color', VORTEX_PALETTE.national_park);
            else if (/building/i.test(id)) _set(m, id, 'fill-color', VORTEX_PALETTE.building);
            else if (/land|aeroway|sand|snow/i.test(id)) _set(m, id, 'fill-color', VORTEX_PALETTE.landuse);
        } else if (l.type === 'fill-extrusion') {
            _set(m, id, 'fill-extrusion-color', VORTEX_PALETTE.building);
        } else if (l.type === 'line') {
            if (/admin|boundary|border/i.test(id)) _set(m, id, 'line-color', VORTEX_PALETTE.boundary);
            else if (/water|river|stream|canal/i.test(id)) _set(m, id, 'line-color', VORTEX_PALETTE.waterway);
            else if (/road|street|bridge|tunnel|motorway|highway|transit|rail|path/i.test(id)) {
                _set(m, id, 'line-color', _isCasing(id) ? VORTEX_PALETTE.road_casing
                    : _isMajorRoad(id) ? VORTEX_PALETTE.road_major
                    : VORTEX_PALETTE.road);
            }
        } else if (l.type === 'symbol') {
            _set(m, id, 'text-color', VORTEX_PALETTE.label_text);
            _set(m, id, 'text-halo-color', VORTEX_PALETTE.label_halo);
            _set(m, id, 'text-halo-width', 1.3);
        }
    }
}

// Exposed globally as well, because the split-screen second map lives in an ES
// module (components/split_screen.js) that can't require() into this bundle.
if (typeof window !== 'undefined') {
    window.vortexBasemap = { apply: apply_vortex_basemap, palette: VORTEX_PALETTE };
}

module.exports = { apply_vortex_basemap, VORTEX_PALETTE };
