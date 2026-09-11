const nexrad_locations = require('../../../libnexrad/nexrad_locations').NEXRAD_LOCATIONS;
const turf = require('@turf/turf');
const ut = require('../../../../core/utils');
const setLayerOrder = require('../../../../core/map/setLayerOrder');
const icons = require('../../../../core/map/icons/icons');
const VortexPopup = require('../../../../core/popup/VortexPopup');
// Required explicitly. This file used the map through a global that happened
// to be set by another module; that worked only as long as that module loaded
// first.
const map = require('../../../../core/map/map');

/*
 * The file currently drawn. As in plot_storm_tracks, the click handler is
 * bound once and reads this, instead of a new handler being stacked on every
 * redraw with the file captured in a closure.
 */
let current = null;
let handlersBound = false;

function findTerminalCoordinates(startLat, startLng, distanceNM, bearingDEG) {
    var metersInNauticalMiles = 1852;
    var distanceMeters = distanceNM * metersInNauticalMiles;
    var bearing = bearingDEG;

    var point = turf.point([startLng, startLat]);
    var destiation = turf.destination(point, distanceMeters, bearing, {units: 'meters'});
    return destiation;
}

function cellClick(e) {
    const L3Factory = current;
    if (!L3Factory) return;
    const properties = e.features[0].properties;
    const cellID = properties.cellID;
    const cellProperties = JSON.parse(properties.cellProperties);

    var fileTime = L3Factory.get_date();
    var hourMin = ut.printHourMin(fileTime, ut.userTimeZone);

    function flip(num) {
        if (num >= 180) {
            return num - 180;
        } else if (num < 180) {
            return num + 180;
        }
    }

    var popupHTML =
`<b><u>TVS</u></b>
<div>Cell <b>${cellID}</b> at <b>${hourMin}</b></div>
<div><b>${ut.degToCompass(flip(cellProperties.az))}</b> at <b>${ut.knotsToMph(cellProperties.range, 0)}</b> mph</div>
<br>
<div>Average Delta Velocity: <b>${cellProperties.avfdv} kts</b>
<div>Low-level Delta Velocity: <b>${cellProperties.lldv} kts</b>
<div>Maximum Delta Velocity: <b>${cellProperties.mxdv} kts</b>
<div>Height of Max Delta Velocity: <b>${cellProperties.mvdvhgt} kft</b>
<div>Depth: <b>${cellProperties.depth} kft</b>
<div>Base: <b>${cellProperties.base} kft</b>
<div>Top: <b>${cellProperties.top} kft</b>
<div>Maximum Shear: <b>${cellProperties.maxshear} m/s/km</b>
<div>Height of Max Shear: <b>${cellProperties.maxshearheight} kft</b>`

    new VortexPopup(JSON.parse(properties.coords), popupHTML).add_to_map();
}

function bindHandlersOnce() {
    if (handlersBound) return;
    handlersBound = true;
    map.on('click', 'tvsInitialPoint', cellClick);
    map.on('mouseenter', 'tvsInitialPoint', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'tvsInitialPoint', () => { map.getCanvas().style.cursor = ''; });
}

function plot_tornado_vortex_signature(L3Factory) {
    current = L3Factory;
    // Safe to call every time: _add_image_to_map skips an image it already has.
    icons.add_icon_svg([
        [icons.icons.tornado_icon, 'tornado']
    ], () => {
        const all_tracks = L3Factory.formatted_tabular.tvs;
        const station_info = nexrad_locations[L3Factory.station];

        function individual_cell(id) {
            const base_point = findTerminalCoordinates(station_info.lat, station_info.lon, all_tracks[id].range, all_tracks[id].az);
            const coords = {'lng': base_point.geometry.coordinates[0], 'lat': base_point.geometry.coordinates[1]};
            base_point.properties.cellProperties = all_tracks[id];
            base_point.properties.cellID = all_tracks[id].cell_id;
            base_point.properties.coords = coords;
            return base_point;
        }

        var storm_IDs = Object.keys(all_tracks);
        var multipoint_coords = [];
        for (var i in storm_IDs) {
            var ic_result = individual_cell(storm_IDs[i]);
            multipoint_coords.push(ic_result);
        }
        var multipoint_geoJSON = turf.featureCollection(multipoint_coords);

        var tvs_layers = ['tvsInitialPoint'];
        var created = false;
        // Update in place when the layer already exists — setData, not a
        // remove and re-add, so the icons never vanish for a frame.
        var src = map.getSource('tvsInitialPoint');
        if (src && map.getLayer('tvsInitialPoint')) {
            src.setData(multipoint_geoJSON);
        } else {
            map.addLayer({
                id: 'tvsInitialPoint',
                type: 'symbol',
                source: {
                    'type': 'geojson',
                    'data': multipoint_geoJSON,
                },
                layout: {
                    // The name the icon is REGISTERED under (add_icon_svg above
                    // passes 'tornado'). This said 'tornado_icon', which nothing
                    // registers, so the markers were never drawn at all.
                    'icon-image': 'tornado',
                    'icon-size': 0.2,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                },
            });
            created = true;
        }
        window.vortexData.tvs_layers = tvs_layers;

        bindHandlersOnce();
        setLayerOrder();

        // Only a freshly created layer needs the toggle's state applied; an
        // existing one keeps whatever the toggle last set.
        var isSTVisChecked = $('#armrSTVisBtnSwitchElem').is(':checked');
        if (created && !isSTVisChecked) {
            map.setLayoutProperty('tvsInitialPoint', 'visibility', 'none');
        }
    })
}

module.exports = plot_tornado_vortex_signature;
