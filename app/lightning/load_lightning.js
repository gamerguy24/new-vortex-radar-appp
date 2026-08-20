const turf = require('@turf/turf');
const map = require('../core/map/map');
const ut = require('../core/utils');
const setLayerOrder = require('../core/map/setLayerOrder');
const luxon = require('luxon');
const icons = require('../core/map/icons/icons');
const filter_lightning = require('./filter_lightning');

// https://luker.org/resources/grlevelx/placefiles/

// PlacefileNation 20-minute lightning. Every Icon in this feed uses the same
// age (no per-strike timestamp — text is always "Strike within last 20 min"),
// so all plotted strikes are treated as current (within 20 min).
const url = `${ut.phpProxy}https://placefilenation.com/Placefiles/20lightning.php`;

function load_lightning(callback) {
    fetch(url, {
        headers: {
            'User-Agent': 'GR2Analyst'
        }
    })
        .then(response => response.text())
        .then(data => {
            // console.log(data);
            console.log(`Fetched lightning data with a byte length of ${ut.formatBytes(new Blob([data]).size)}.`);
            data = data.split('\n');

            var points = [];
            for (var i in data) {
                var row = data[i];
                if (row.trim().startsWith('Icon:')) {
                    row = row.trim().replace(/^Icon:\s*/, '').split(',');

                    var lat = parseFloat(row[0]);
                    var lng = parseFloat(row[1]);
                    if (isNaN(lat) || isNaN(lng)) continue;

                    // PlacefileNation gives no per-strike timestamp — every strike
                    // is simply "within the last 20 min", so treat them all as
                    // current (diff_minutes = 0 → full opacity in the layer paint).
                    points.push(turf.point([lng, lat], { 'time': 'within 20 min', 'diff_minutes': 0 }));
                }
            }
            var collection = turf.featureCollection(points);
            window.atticData.original_lightning_points = collection;
            // collection = filter_lightning(collection);

            map.addSource('lightningSource', {
                type: 'geojson',
                data: collection
            });
            icons.add_icon_svg([
                [icons.icons.lightning_bolt_bold, 'lightning_bolt_bold']
            ], () => {
                const calculate_opacity_level = (decrease_rate) => Array.from({ length: 5 }, (_, i) => 1 - i * decrease_rate);
                const levels = calculate_opacity_level(0.125);

                map.addLayer({
                    id: 'lightningLayer',
                    type: 'symbol',
                    source: 'lightningSource',
                    layout: {
                        'icon-image': 'lightning_bolt_bold',
                        'icon-size': [
                            'interpolate',
                            ['exponential', 0.2],
                            ['zoom'],
                            7,
                            0.2,

                            10,
                            0.23
                        ],
                        // 'text-allow-overlap': true,
                        // 'text-ignore-placement': true,
                        'icon-allow-overlap': false,
                        // 'icon-ignore-placement': true,
                        'icon-padding': 0,
                        'symbol-sort-key': ['get', 'diff_minutes'],
                        'symbol-z-order': 'viewport-y'
                    },
                    paint: {
                        'icon-opacity': [
                            'case',
                            ['<=', ['get', 'diff_minutes'], 3],
                            levels[0],
                            ['<=', ['get', 'diff_minutes'], 6],
                            levels[1],
                            ['<=', ['get', 'diff_minutes'], 9],
                            levels[2],
                            ['<=', ['get', 'diff_minutes'], 12],
                            levels[3],
                            ['<=', ['get', 'diff_minutes'], 15],
                            levels[4],

                            levels[0],
                        ],
                    }
                })

                // function _show_only_visible() {
                //     const visible_lightning = turf.featureCollection(map.queryRenderedFeatures({ layers: ['lightningLayer'] }));
                //     map.getSource('lightningSource').setData(visible_lightning);
                // }

                // map.on('zoomstart', () => {
                //     if (window.atticData.station_lightning.features.length != 0) {
                //         _show_only_visible();
                //         setTimeout(() => {
                //             map.setLayoutProperty('lightningLayer', 'icon-allow-overlap', true);
                //         }, 100);
                //     }
                // })
                // map.on('zoomend', () => {
                //     if (window.atticData.station_lightning.features.length != 0) {
                //         map.setLayoutProperty('lightningLayer', 'icon-allow-overlap', false);
                //         map.getSource('lightningSource').setData(window.atticData.station_lightning);
                //     }
                // })

                setLayerOrder();
                callback();
            })
        })
        .catch(error => {
            console.error(error);
        });
}

module.exports = load_lightning;