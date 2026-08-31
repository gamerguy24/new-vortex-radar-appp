/*
 * Vortex Radar basemap theme.
 *
 * Re-tints the Mapbox basemap to Vortex Radar's own palette: a medium-light
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

const VORTEX_PALETTE = {
    // ---- surfaces
    land:          'rgb(156, 160, 165)',  // medium-light cool grey (dominant)
    landuse:       'rgb(147, 151, 157)',  // urban/landuse, a step darker so cities read
    national_park: 'rgb(144, 156, 142)',  // muted sage, not a saturated green
    building:      'rgb(137, 141, 147)',
    water:         'rgb(51, 92, 133)',    // marine blue — the ocean, clearly blue
    waterway:      'rgb(68, 110, 150)',   // rivers/streams, a touch lighter than open water

    // ---- lines
    road:          'rgb(231, 234, 238)',  // near-white roads read cleanly on grey
    road_major:    'rgb(245, 247, 249)',  // motorways slightly brighter
    road_casing:   'rgb(118, 124, 132)',  // thin dark casing gives roads definition
    boundary:      'rgb(82, 88, 97)',     // state / county lines, dark on light grey

    // ---- type: dark text on a light halo (inverted from the old dark theme)
    label_text:    'rgb(28, 32, 37)',
    label_halo:    'rgba(255, 255, 255, 0.88)',
};

const BASE_SOURCE = 'composite'; // Mapbox vector basemap source

function _set(m, layer, prop, value) {
    try { if (m.getLayer(layer)) m.setPaintProperty(layer, prop, value); }
    catch (e) { /* layer or property not present in this style — fine */ }
}

// Roads come as paired fill/casing layers; casing ids end in "-case".
function _isCasing(id) { return /(^|[-_])case($|[-_])|casing/i.test(id); }
function _isMajorRoad(id) { return /motorway|trunk|highway/i.test(id); }

/*
 * Retry bookkeeping, per map.
 *
 * The retry MUST be bounded and MUST NOT stack. 'idle' fires after every
 * render, and painting the basemap calls setPaintProperty on hundreds of
 * layers — which itself causes a render. So a retry that re-registers itself
 * unconditionally is a loop that feeds on its own output, and a fresh listener
 * leaks on every pass. One pending retry per map, with a hard cap: if the style
 * has not become readable after a handful of attempts it never will, and the
 * map is better left as Mapbox drew it than pinned in a render loop.
 */
const _pending = new WeakMap();
const MAX_RETRIES = 5;

function _scheduleRetry(m) {
    const tries = _pending.get(m) || 0;
    if (tries >= MAX_RETRIES) {
        console.warn('[VortexBasemap] style never became readable; leaving the default theme.');
        return;
    }
    _pending.set(m, tries + 1);

    let ran = false;
    const rerun = () => {
        if (ran) return;          // whichever event wins, only one re-run
        ran = true;
        apply_vortex_basemap(m);
    };
    m.once('style.load', rerun);
    // 'idle' is the reliable second chance: isStyleLoaded() is commonly still
    // false inside a style.load handler, and style.load never fires twice.
    m.once('idle', rerun);
}

function apply_vortex_basemap(targetMap) {
    const m = targetMap || map;
    if (!m || typeof m.getStyle !== 'function') return;

    /*
     * Called before the style finished loading (boot order, or a style swap)?
     * There is nothing to paint yet — wait and re-run.
     *
     * WAIT ON 'idle', NOT ONLY ON 'style.load'. isStyleLoaded() commonly still
     * returns false *inside* a style.load handler, so a caller doing the
     * obvious thing —
     *
     *     map.on('style.load', () => vortexBasemap.apply(map))
     *
     * — landed here, queued another once('style.load') for an event that had
     * already fired and would never fire again, and returned. The re-run never
     * happened and the map stayed stock Mapbox dark. That is exactly what left
     * the split-screen right pane dark beside Vortex's grey/blue left pane.
     *
     * 'idle' always follows, so it is the reliable second chance. Both are
     * registered because a style swap fires style.load again later, and the
     * paint operations are idempotent so running twice costs nothing.
     */
    try {
        if (typeof m.isStyleLoaded === 'function' && !m.isStyleLoaded()) {
            _scheduleRetry(m);
            return;
        }
    } catch (e) { /* older gl-js without isStyleLoaded — just carry on */ }

    // Made it: this map is painted, so any pending retry bookkeeping is done.
    _pending.delete(m);

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
