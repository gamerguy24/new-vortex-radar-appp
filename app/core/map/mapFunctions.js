var map = require('./map');

function removeMapLayer(layername, targetMap = map) {
    if (!targetMap) return;
    if (targetMap.getLayer(layername)) {
        targetMap.removeLayer(layername);
    }
    if (targetMap.getSource(layername)) {
        targetMap.removeSource(layername);
    }
}
function setGeojsonLayer(gj, gjType, identity) {
    var styling;
    var type;
    if (gjType == 'circle') {
        type = gjType;
        styling = {
            'circle-radius': 4,
            'circle-stroke-width': 2,
            'circle-color': 'red',
            'circle-stroke-color': 'white',
        }
    } else if (gjType == 'lineCircle') {
        type = 'circle';
        styling = {
            'circle-radius': 4,
            'circle-stroke-width': 2,
            'circle-color': 'blue',
            'circle-stroke-color': 'white',
        }
    } else if (gjType == 'greenCircle') {
        type = 'circle';
        styling = {
            'circle-radius': 4,
            'circle-stroke-width': 2,
            'circle-color': 'green',
            'circle-stroke-color': 'white',
        }
    } else if (gjType == 'yellowCircle') {
        type = 'circle';
        styling = {
            'circle-radius': 4,
            'circle-stroke-width': 2,
            'circle-color': 'yellow',
            'circle-stroke-color': 'white',
        }
    } else if (gjType == 'lineCircleEdge') {
        type = 'circle';
        styling = {
            'circle-radius': 4,
            'circle-color': '#ffffff',
        }
    } else if (gjType == 'line') {
        type = gjType;
        styling = {
            'line-color': '#ffffff',
            'line-width': 1.5,
        }
    }
    map.addLayer({
        'id': identity,
        'type': type,
        'source': {
            'type': 'geojson',
            'data': gj,
        },
        'paint': styling,
    })
}
function moveMapLayer(lay) {
    if (map.getLayer(lay)) {
        map.moveLayer(lay)
    }
}

/*
 * The layer new map layers are inserted BELOW, for one pane.
 *
 * Each pane carries its own basemap now, so this reads that pane's style rather
 * than one global. An unset pane (the right one before anything is chosen) is
 * dark, which is the style its map is created with — returning undefined here
 * put the radar on TOP of the labels instead of beneath them.
 */
function get_base_layer(target) {
    const panes = require('./radar_panes');
    const current_style_name = panes.pane_state(target === 'dual' ? 'dual' : 'main').map_type;

    if (current_style_name == 'satellite') {
        return 'tunnel-path-trail';
    }
    return 'land-structure-line';
}

module.exports = {
    removeMapLayer,
    setGeojsonLayer,
    moveMapLayer,
    get_base_layer
}