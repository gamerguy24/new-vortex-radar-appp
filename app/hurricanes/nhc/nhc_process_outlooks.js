const ut = require('../../core/utils');
const kmz_to_geojson = require('../kmz_to_geojson');
const set_layer_order = require('../../core/map/setLayerOrder');
const map = require('../../core/map/map');
const VortexPopup = require('../../core/popup/VortexPopup');
const turf = require('@turf/turf');

function _click_listener(e) {
    const features = map.queryRenderedFeatures(e.point);
    if (features[0].layer.id != e.features[0].layer.id) { return; }

    const lng = e.lngLat.lng;
    const lat = e.lngLat.lat;
    const properties = e.features[0].properties;

    // Echo Radar outlook card (styles: .vx-olk in index.css). The KMZ values
    // already carry the sign ("30%"), with NHC's Low / Medium / High beside them.
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const tiles = [['2day', '48 hours'], ['7day', '7 days']].filter(([key]) => properties.hasOwnProperty(key + '_percentage')).map(([key, label]) => {
        const pct = String(properties[key + '_percentage']).replace('%', '').trim();
        const cat = String(properties[key + '_category'] || '').trim();
        return `<div class="vx-olk-tile" data-cat="${esc(cat.toLowerCase())}">
                <span class="vx-olk-when">${label}</span>
                <span class="vx-olk-pct">${esc(pct)}%</span>
                ${cat ? `<span class="vx-olk-cat">${esc(cat)}</span>` : ''}
            </div>`;
    }).join('');

    const popup_content =
        `<div class="vx-olk">
            <div class="vx-olk-head">
                <span class="vx-olk-title">Tropical outlook</span>
                ${properties.Disturbance != null ? `<span class="vx-olk-num">Area ${esc(properties.Disturbance)}</span>` : ''}
            </div>
            <div class="vx-olk-sub">Chance of tropical cyclone formation</div>
            ${tiles ? `<div class="vx-olk-tiles">${tiles}</div>` : ''}
            ${properties.Discussion ? `<div class="vx-olk-disc">${esc(properties.Discussion)}</div>` : ''}
            <div class="vx-olk-src">National Hurricane Center</div>
        </div>`;

    const popup = new VortexPopup([lng, lat], popup_content);
    popup.vortex_popup_div.css({ 'maxWidth': '290px', 'minWidth': '260px' });
    popup.add_to_map();
    // new mapboxgl.Popup({ className: 'alertPopup'})
    //     .setLngLat([lng, lat])
    //     .setHTML(popup_content)
    //     //.setHTML(e.features[0].properties.description)
    //     .addTo(map);
}

function nhc_process_outlooks() {
    const outlook_urls = [
        'https://www.nhc.noaa.gov/xgtwo/gtwo_atl.kmz',
        'https://www.nhc.noaa.gov/xgtwo/gtwo_pac.kmz',
        'https://www.nhc.noaa.gov/xgtwo/gtwo_cpac.kmz'
    ];

    function _fetch_individual_outlook(cb, index = 0) {
        const url = outlook_urls[index];
        const split_url = url.split('/');
        const id = split_url[split_url.length - 1].replace('.kmz', '');

        fetch(ut.phpProxy + url, { headers: { 'Cache-Control': 'no-cache' } })
        .then(response => response.blob())
        .then(blob => {
            blob.lastModifiedDate = new Date();
            blob.name = url;

            // nhc_storage.outlooks[id] = {};
            // nhc_storage.outlooks[id].kmz = blob;
            nhc_plot_outlook(blob, id);

            if (index < outlook_urls.length - 1) {
                _fetch_individual_outlook(cb, index + 1);
            } else {
                cb();
            }
        })
    }

    _fetch_individual_outlook(() => {
        // callback(nhc_storage);
    });
}

const coordinates_already_seen = [];

function nhc_plot_outlook(kmz_blob, id) {
    kmz_to_geojson(kmz_blob, (geojson) => {
        geojson = _sort_order(geojson);

        // A basin with nothing to watch has no features at all.
        if (!geojson.features.length) return;
        // apparently we need to check for epac/cpac duplicate outlooks - epac gets priority
        const string_coords = JSON.stringify(geojson.features[0].geometry.coordinates);
        if (!coordinates_already_seen.includes(string_coords)) {
            coordinates_already_seen.push(string_coords);

            for (var x = 0; x < geojson.features.length; x++) {
                const cur_feature = geojson.features[x];
                const type = cur_feature.geometry.type;

                if (type == 'Polygon') {
                    const source_name = `hurricane_outlook_${x}${id}_source`;
                    const layer_name = `hurricane_outlook_${x}${id}_layer`;
                    const layer_outline_name = `hurricane_outlook_${x}${id}_outline`;

                    const fill_color = cur_feature.properties.fill;
                    const fill_opacity = cur_feature.properties['fill-opacity'];
                    const border_color = cur_feature.properties.stroke;
                    const border_width = cur_feature.properties['stroke-width'];
                    const cone_coordinates = cur_feature.geometry.coordinates[0];
                    cur_feature.geometry.coordinates[0].push(cone_coordinates[0]);

                    map.addSource(source_name, {
                        type: 'geojson',
                        data: cur_feature,
                    });
                    map.addLayer({
                        'id': layer_name,
                        'type': 'fill',
                        'source': source_name,
                        'paint': {
                            'fill-color': fill_color,
                            'fill-opacity': 0.3
                        }
                    });
                    map.addLayer({
                        'id': layer_outline_name,
                        'type': 'line',
                        'source': source_name,
                        'paint': {
                            'line-color': border_color,
                            'line-width': border_width
                        }
                    });
                    window.vortexData.hurricane_layers.push(source_name, layer_name, layer_outline_name);

                    map.on('mouseenter', layer_name, function (e) {
                        map.getCanvas().style.cursor = 'pointer';
                    })
                    map.on('mouseleave', layer_name, function (e) {
                        map.getCanvas().style.cursor = '';
                    })
                    map.on('click', layer_name, _click_listener);

                    _add_chance_label(cur_feature, `hurricane_outlook_point_label_${x}${id}`);

                } else if (type == 'Point') {
                    const source_name = `hurricane_outlook_point_${x}${id}_source`;
                    const layer_name = `hurricane_outlook_point_${x}${id}_layer`;

                    if (cur_feature.properties.name == undefined) cur_feature.properties.name = '';
                    if (!(cur_feature.properties.name.includes('Tropical cyclone formation is not expected')) && !(cur_feature.properties.name.includes('during the next'))) {
                        const black = 'rgb(0, 0, 0)';
                        const high_color = 'rgb(214, 46, 31)'; // red
                        const medium_color = 'rgb(240, 151, 55)'; // orange
                        const low_color = 'rgb(255, 255, 84)'; // yellow

                        if (cur_feature.properties.styleUrl == '#highx') {
                            cur_feature.properties.color = high_color;
                        } else if (cur_feature.properties.styleUrl == '#medx') {
                            cur_feature.properties.color = medium_color;
                        } else if (cur_feature.properties.styleUrl == '#lowx') {
                            cur_feature.properties.color = low_color;
                        } else {
                            cur_feature.properties.color = high_color;
                        }

                        map.addSource(source_name, {
                            type: 'geojson',
                            data: cur_feature
                        });
                        map.addLayer({
                            'id': layer_name,
                            'type': 'symbol',
                            'source': source_name,
                            'layout': {
                                'text-field': 'X',
                                'text-size': [ // 35
                                    'interpolate',
                                    ['exponential', 0.5],
                                    ['zoom'],
                                    2,
                                    20,

                                    5,
                                    45
                                ],
                                'text-font': ['Open Sans Bold'],

                                'text-allow-overlap': true,
                                'text-ignore-placement': true,
                                'icon-allow-overlap': true,
                                'icon-ignore-placement': true,
                            },
                            'paint': {
                                'text-color': ['get', 'color'],
                                'text-halo-color': 'black',
                                'text-halo-width': 2,
                                'text-halo-blur': 1
                            }
                        });
                        window.vortexData.hurricane_layers.push(source_name, layer_name);
                    }
                }
            }
        }
        set_layer_order();
    })
}

/*
 * The chance of development, printed on the area itself as on a TV tropics
 * graphic: "48 HRS 0%" over "7 DAYS 30%", at the area's centre. White on a
 * dark halo so it reads on any area colour; the area's own fill (NHC yellow /
 * orange / red for low / medium / high) carries the risk level.
 */

function _add_chance_label(polygon_feature, name) {
    const p = polygon_feature.properties || {};
    const pct = (key) => {
        const v = String(p[key + '_percentage'] == null ? '' : p[key + '_percentage']).replace('%', '').trim();
        return v === '' ? null : v + '%';
    };
    const p2 = pct('2day'), p7 = pct('7day');
    if (!p2 && !p7) return;

    let centre;
    try { centre = turf.centerOfMass(polygon_feature).geometry.coordinates; } catch (e) { return; }
    const source_name = `${name}_source`;
    const layer_name = `${name}_layer`;
    map.addSource(source_name, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: centre }, properties: {
            p2: p2 || '-', p7: p7 || '-',
        } },
    });
    map.addLayer({
        'id': layer_name,
        'type': 'symbol',
        'source': source_name,
        'layout': {
            'text-field': ['format',
                '48 HRS  ', { 'font-scale': 0.7 }, ['get', 'p2'], { 'font-scale': 1.2 },
                '\n7 DAYS  ', { 'font-scale': 0.7 }, ['get', 'p7'], { 'font-scale': 1.2 }],
            'text-font': ['Open Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 2, 13, 6, 20],
            'text-line-height': 1.25,
            'text-justify': 'center',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        'paint': {
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(0, 0, 0, 0.85)',
            'text-halo-width': 2.2,
            'text-halo-blur': 0.5,
        },
    });
    // The id contains "outlook_point" (see the call), so setLayerOrder lifts it above the areas with the X markers.
    window.vortexData.hurricane_layers.push(source_name, layer_name);
}

// Sort the GeoJSON object by Disturbance property
function _sort_order(geojson) {
    // Filter out features that don't have the Disturbance property
    const features_with_disturbance = geojson.features.filter(
        feature =>
            feature.properties &&
            feature.properties.Disturbance !== undefined &&
            !isNaN(parseInt(feature.properties.Disturbance))
    );

    // Sort the features by Disturbance property in descending order
    features_with_disturbance.sort((a, b) =>
        parseInt(b.properties.Disturbance) - parseInt(a.properties.Disturbance)
    );

    // Create a new GeoJSON object with the sorted features
    const sorted_geojson = {
        type: geojson.type,
        features: features_with_disturbance.concat(
            geojson.features.filter(
                feature =>
                    !feature.properties ||
                    feature.properties.Disturbance === undefined ||
                    isNaN(parseInt(feature.properties.Disturbance))
            )
        )
    };

    return sorted_geojson;
}

module.exports = nhc_process_outlooks;