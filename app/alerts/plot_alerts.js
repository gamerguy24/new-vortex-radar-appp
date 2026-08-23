const get_polygon_colors = require('./colors/polygon_colors');
const set_layer_order = require('../core/map/setLayerOrder');
const click_listener = require('./click_listener');
const filter_alerts = require('./filter_alerts');
const combine_dictionary_data = require('./combine_dictionary_data');
const map = require('../core/map/map');
const AlertUpdater = require('./updater/AlertUpdater');

function _add_alert_layers(geojson) {
    if (map.getSource('alertsSource')) {
        map.getSource('alertsSource').setData(geojson);
    } else {
        map.addSource(`alertsSource`, {
            type: 'geojson',
            data: geojson,
        })
        map.addLayer({
            'id': `alertsLayer`,
            'type': 'line',
            'source': `alertsSource`,
            'paint': {
                'line-color': [
                    'case',
                    ['==', ['get', 'type'], 'outline'],
                    ['get', 'color'],
                    ['==', ['get', 'type'], 'border'],
                    'black',
                    'rgba(0, 0, 0, 0)'
                ],
                'line-width': [
                    'case',
                    ['==', ['get', 'type'], 'outline'],
                    2,
                    ['==', ['get', 'type'], 'border'],
                    5,
                    0
                ]
            }
        });
        map.addLayer({
            'id': `alertsLayerFill`,
            'type': 'fill',
            'source': `alertsSource`,
            paint: {
                //#0080ff blue
                //#ff7d7d red
                'fill-color': ['get', 'color'],
                // Watches render as a translucent SHADED AREA (county lines show
                // through); warnings stay outline-only. Only the 'outline' copy of
                // each feature is filled so the duplicated features don't stack.
                'fill-opacity': [
                    'case',
                    ['all', ['==', ['get', 'type'], 'outline'], ['==', ['get', 'is_watch'], true]],
                    0.28,
                    0
                ]
            }
        });

        map.on('mouseover', `alertsLayerFill`, function(e) {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseout', `alertsLayerFill`, function(e) {
            map.getCanvas().style.cursor = '';
        });

        map.on('click', `alertsLayerFill`, click_listener);
    }
}

function _sort_by_priority(data) {
    data.features = data.features.sort((a, b) => b.properties.priority - a.properties.priority);
    return data;
}

function plot_alerts(alerts_data) {
    // const already_data = map.getSource('alertsSource')?._data;
    // if (already_data != undefined) {
    //     alerts_data = already_data;
    // }

    for (var item in alerts_data.features) {
        var feat = alerts_data.features[item];
        var event = feat.properties.event;
        var gpc = get_polygon_colors(event); // gpc = get polygon colors
        feat.properties.color = gpc.color;
        feat.properties.priority = parseInt(gpc.priority);
        // Watches get a translucent fill (shaded counties); warnings stay outline-only.
        feat.properties.is_watch = /\bwatch\b/i.test(String(event));
        // For watches, shade the individual counties they cover: drop any inline
        // (SPC box) geometry when we have the affected counties, so the county
        // path in combine_dictionary_data draws the actual county shapes instead.
        if (feat.properties.is_watch && feat.geometry &&
            Array.isArray(feat.properties.affectedZones) && feat.properties.affectedZones.length) {
            feat.geometry = null;
        }
    }
    alerts_data = _sort_by_priority(alerts_data);
    alerts_data = filter_alerts(alerts_data);

    var duplicate_features = alerts_data.features.flatMap((element) => [element, element]);
    duplicate_features = JSON.parse(JSON.stringify(duplicate_features));
    for (var i = 0; i < duplicate_features.length; i++) {
        if (i % 2 === 0) {
            duplicate_features[i].properties.type = 'border';
        } else {
            duplicate_features[i].properties.type = 'outline';
        }
    }
    alerts_data.features = duplicate_features;

    // Attach the county/zone geometry now if the zone dictionaries are loaded, so
    // zone-based alerts (watches) render as their actual shaded counties — this
    // path also runs on the 15s refresh. On the very first load the dictionaries
    // aren't ready yet, so we plot the raw data and _fetch_data attaches geometry
    // once they finish loading.
    var to_plot = alerts_data;
    try {
        if (window.loaded_zones && typeof county_zones !== 'undefined') {
            to_plot = combine_dictionary_data(alerts_data);
        }
    } catch (e) { to_plot = alerts_data; }

    _add_alert_layers(to_plot);

    set_layer_order();

    // if (window?.vortexData?.current_RadarUpdater != undefined) {
    //     window.vortexData.current_RadarUpdater.disable();
    // }
    // if (!isInFileUploadMode) {
    //     const current_RadarUpdater = new RadarUpdater(nexrad_factory);
    //     window.vortexData.current_RadarUpdater = current_RadarUpdater;
    //     current_RadarUpdater.enable();
    // }
    if (!window.location.hash.includes('dev')) {
        if (window.vortexData.current_AlertUpdater == undefined) {
            const current_AlertUpdater = new AlertUpdater();
            current_AlertUpdater.enable();
            window.vortexData.current_AlertUpdater = current_AlertUpdater;
        }
    }
}

module.exports = plot_alerts;