/*
 * app/radar/station_markers/dual_station_markers.js
 * Radar station markers on the split-screen RIGHT pane.
 *
 * The markers only ever existed on the left map. Once the panes became
 * independent that left the right pane with no way to choose a site at all —
 * you could give it its own radar in principle and had no control to do it
 * with. Now both maps carry markers, and clicking one loads the site into the
 * map you clicked (see select_station in station_markers.js).
 *
 * The layer is COPIED from the left map's own layer spec rather than written
 * out again here: two hand-maintained copies of the same styling drift, and
 * the one on the right would slowly stop looking like the one on the left.
 */

const icons = require('../../core/map/icons/icons');
const stations = require('./station_markers');
const { set_active_pane } = require('../../core/map/radar_panes');

const SRC = 'stationSymbolLayer';   // ids belong to a map, so the same id on
const LYR = 'stationSymbolLayer';   // the second map is not a collision

function main_map() { return require('../../core/map/map'); }
function dual_map() {
    return (typeof window !== 'undefined' && window.vortexMap && window.vortexMap.dualMap) || null;
}

let bound = false;

function highlight(dm, station) {
    const src = dm.getSource(SRC);
    if (!src || !src._data) return;
    const geojson = src._data;
    for (const f of geojson.features || []) {
        f.properties.clicked = f.properties.station_id === station ? 'yes' : 'no';
    }
    src.setData(geojson);
}

function add_layer(dm) {
    if (dm.getLayer(LYR)) return true;

    const main = main_map();
    let spec = null;
    try {
        spec = (main.getStyle().layers || []).find((l) => l.id === LYR) || null;
    } catch (e) { /* main style not ready */ }
    if (!spec) return false;                      // try again on the next tick

    // Prefer the data the left map is already showing: it carries the live
    // up/down status, which a freshly generated set would not.
    let data = null;
    try { data = main.getSource(SRC)._data; } catch (e) { /* fall through */ }
    if (!data) { try { data = stations.stations_geojson(window.vortexData && window.vortexData.radar_station_status); } catch (e) { return false; } }

    dm.addSource(SRC, { type: 'geojson', generateId: true, data: JSON.parse(JSON.stringify(data)) });
    dm.addLayer({ id: LYR, type: 'symbol', source: SRC, layout: spec.layout, paint: spec.paint });

    dm.on('mouseover', LYR, () => { dm.getCanvas().style.cursor = 'pointer'; });
    dm.on('mouseout', LYR, () => { dm.getCanvas().style.cursor = ''; });
    dm.on('click', LYR, (e) => {
        const props = e.features[0].properties;
        // Clicking the right map's marker drives the RIGHT pane, and moves the
        // controls there so the product menu acts where you are looking.
        set_active_pane('dual');
        highlight(dm, props.station_id);
        stations.select_station(props.station_id, props.type, 'dual');
    });
    return true;
}

/**
 * Put the markers on the right pane. Safe to call on every split-screen open:
 * it does nothing once the layer is there.
 */
function show_dual(attempt = 0) {
    const dm = dual_map();
    if (!dm) return;
    let ready = false;
    try { ready = !!(dm.style && dm.style._loaded) || (dm.isStyleLoaded && dm.isStyleLoaded()); } catch (e) { ready = false; }

    if (ready && dm.getLayer(LYR)) return;        // already there
    if (ready) {
        // The icons are images, and an image belongs to one map — the right
        // pane needs its own copies before the layer can draw anything.
        icons.add_icon_svg([
            [icons.icons.grey_station_marker, 'grey_station'],
            [icons.icons.blue_station_marker, 'blue_station'],
            [icons.icons.red_station_marker, 'red_station'],
            [icons.icons.orange_station_marker, 'orange_station'],
        ], () => {
            if (!add_layer(dm) && attempt < 40) setTimeout(() => show_dual(attempt + 1), 250);
        }, 0, dm);
        return;
    }
    if (attempt < 40) setTimeout(() => show_dual(attempt + 1), 250);
}

module.exports = { show_dual };
