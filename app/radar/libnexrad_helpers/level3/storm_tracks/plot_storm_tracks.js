// const radarStations = require('../../../../../resources/radarStations');
const nexrad_locations = require('../../../libnexrad/nexrad_locations').NEXRAD_LOCATIONS;
const turf = require('@turf/turf');
const map = require('../../../../core/map/map');
const setLayerOrder = require('../../../../core/map/setLayerOrder');
const ut = require('../../../../core/utils');
const VortexPopup = require('../../../../core/popup/VortexPopup');
const render_storm_impact = require('./render_storm_impact');
const storm_alerts = require('./storm_alerts');

const KTS_TO_MPH = 1.15078;
// STI stores movement azimuth as the direction the storm came FROM; flip 180° to
// get the heading it's moving toward (matches the popup's motion display).
function flipDeg(num) { return num >= 180 ? num - 180 : num + 180; }

/*
 * The file currently drawn. The click handler is registered ONCE and reads
 * this, rather than being registered on every draw with the file captured in
 * a closure. Mapbox keeps layer-scoped listeners even after the layer is
 * removed, so the old way stacked a new handler per redraw — and with redraws
 * happening on every radar plot, one click could open a pile of identical
 * popups, each holding on to an old file.
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

function getCoords(degNmObj, station) {
    const currentStationCoords = { 'lat': nexrad_locations[station].lat, 'lng': nexrad_locations[station].lon }

    var coords = findTerminalCoordinates(currentStationCoords.lat, currentStationCoords.lng, degNmObj.nm, degNmObj.deg);
    return turf.getCoords(coords);
}

function generatePerpendicularLine(basePoint, destPoint, cellData, forecastIndex) {
    function addToBearing(bearing, angle) { return (bearing + angle) % 360 }
    function subtractFromBearing(bearing, angle) { return (bearing - angle + 360) % 360 }

    var bearing = turf.bearing(basePoint, destPoint);

    // 15min, 30min, 45min, 1hr
    var timeIntervalLookup = [2, 4, 6, 8];
    // ((speed * time interval) * convert kts to mph) / scaling
    // const distanceForLine = (cellData.movement.kts * timeIntervalLookup[forecastIndex] * 0.868976242) / 12; // miles
    const distanceForLine = cellData.error.error * timeIntervalLookup[forecastIndex]; // miles
    // const distanceForLine = _calculate_perpendicular_line(cellData.movement.kts, timeIntervalLookup[forecastIndex]);

    var leftBearing = subtractFromBearing(bearing, 90);
    var leftPoint = turf.destination(destPoint, distanceForLine, leftBearing, {units: 'miles'});
    var rightBearing = addToBearing(bearing, 90);
    var rightPoint = turf.destination(destPoint, distanceForLine, rightBearing, {units: 'miles'});

    return turf.lineString([turf.getCoords(leftPoint), turf.getCoords(rightPoint)]);
}

// Build a cell's projected-path + motion for the impact/alert calculators:
// current position + each non-null forecast position (→ lng/lat), with the
// minute offset of each, plus the storm's speed and a display motion string.
function buildCellTrack(factory, id, curCell) {
    const path = [getCoords(curCell.current, factory.station)];
    const times = [0];
    const fc = curCell.forecast || [];
    for (var i = 0; i < fc.length; i++) {
        const f = fc[i];
        if (f && f !== 'new' && f.nm != null) { path.push(getCoords(f, factory.station)); times.push((i + 1) * 15); }
    }
    let speedMph = 0, motionText = '';
    if (curCell.movement && curCell.movement !== 'new') {
        speedMph = curCell.movement.kts * KTS_TO_MPH;
        motionText = `${ut.degToCompass(flipDeg(curCell.movement.deg))} at ${ut.knotsToMph(curCell.movement.kts, 0)} mph`;
    }
    return { id, path, times, speedMph, motionText, cell: curCell };
}

function cellClick(e) {
    const L3Factory = current;
    if (!L3Factory) return;
    const renderedFeatures = map.queryRenderedFeatures(e.point);
    if (renderedFeatures[0] && renderedFeatures[0].layer.id == 'stationSymbolLayer') return;

    const properties = e.features[0].properties;
    const cellID = properties.cellID;
    const cellProperties = JSON.parse(properties.cellProperties);

    var fileTime = L3Factory.get_date();
    var hourMin = ut.printHourMin(fileTime, ut.userTimeZone);

    var popupHTML =
`<b><u>Storm Track</u></b>
<div>Cell <b>${cellID}</b> at <b>${hourMin}</b></div>`

    function flip(num) {
        if (num >= 180) {
            return num - 180;
        } else if (num < 180) {
            return num + 180;
        }
    }

    if (cellProperties.movement != 'new') {
        popupHTML += `<div><b>${ut.degToCompass(flip(cellProperties.movement.deg))}</b> at <b>${ut.knotsToMph(cellProperties.movement.kts, 0)}</b> mph</div>`
    }

    if (cellProperties.graph_data != undefined) {
        popupHTML +=
`<br>
<div>Max Reflectivity: <b>${cellProperties?.graph_data?.dbzm} dBZ</b>
<div>Height of Max Refl: <b>${cellProperties?.graph_data?.hgt} kft</b>`
    }

    // Placeholder the "My Location Impact" section fills in async.
    popupHTML += `<div id="stormImpactSection"></div>`;

    const popup = new VortexPopup(JSON.parse(properties.coords), popupHTML);
    popup.add_to_map();
    try {
        const track = buildCellTrack(L3Factory, cellID, cellProperties);
        render_storm_impact('stormImpactSection', track, () => { try { popup.update_popup_pos(); } catch (e) {} });
    } catch (e) {}
}

function bindHandlersOnce() {
    if (handlersBound) return;
    handlersBound = true;
    map.on('click', 'stormTrackInitialPoint', cellClick);
    map.on('mouseenter', 'stormTrackInitialPoint', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'stormTrackInitialPoint', () => { map.getCanvas().style.cursor = ''; });
}

/*
 * Update a layer's data in place, or create it if it does not exist yet.
 * Returns true only when it created the layer. setData keeps the layer drawn
 * with the old geometry until the new geometry is ready, so there is never a
 * frame with nothing on the map — which is exactly what removeLayer+addLayer
 * produced.
 */
function upsert(id, data, spec) {
    const src = map.getSource(id);
    if (src && map.getLayer(id)) {
        src.setData(data);
        return false;
    }
    map.addLayer(Object.assign({ id: id, source: { type: 'geojson', data: data } }, spec));
    return true;
}

function plot_storm_tracks(L3Factory) {
    current = L3Factory;
    const allTracks = L3Factory.formatted_tabular.storms;

    function individualCell(id) {
        var points = [];
        var perpendicularLines = [];
        var coords;
        var initialPoint;
        var curCell = allTracks[id];

        coords = getCoords(curCell.current, L3Factory.station);
        points.push(coords);
        const originalInitialPoint = turf.point(coords, {cellID: id, coords: coords, cellProperties: curCell});
        initialPoint = turf.point(coords, {cellID: id, coords: coords, cellProperties: curCell});
        for (var i in curCell.forecast) {
            var curPoint = curCell.forecast[i];
            if (curPoint != null) {
                coords = getCoords(curPoint, L3Factory.station);
                perpendicularLines.push(generatePerpendicularLine(initialPoint, coords, curCell, i));
                points.push(coords);
                initialPoint = turf.point(coords, {cellID: id, coords: coords, cellProperties: curCell});
            }
        }

        return [points, originalInitialPoint, perpendicularLines];
    }

    var stormIDs = Object.keys(allTracks);
    var multiLineStringCoords = [];
    var multiPointCoords = [];
    var featureCollectionObjects = [];
    for (var i in stormIDs) {
        var icResult = individualCell(stormIDs[i]); // L5
        multiLineStringCoords.push(icResult[0]);
        multiPointCoords.push(icResult[1]);
        featureCollectionObjects.push(icResult[2]);
    }
    var multiLineGeoJSON = turf.multiLineString(multiLineStringCoords);
    var multiPointGeoJSON = turf.featureCollection(multiPointCoords);
    var featureCollectionGeoJSON = turf.featureCollection(featureCollectionObjects.flat());

    // Same layers, same ids, same stacking order as before — black casing
    // (i = 0) under white line (i = 1) — so the visibility toggle in settings,
    // which walks storm_track_layers, keeps working unchanged.
    var storm_track_layers = [];
    var created = [];
    for (var i = 0; i <= 1; i++) {
        var paint = {
            'line-color': i == 1 ? 'white' : 'black',
            'line-width': i == 1 ? 2 : 4,
        };
        storm_track_layers.push('stormTrackPerpendicularLines' + i);
        if (upsert('stormTrackPerpendicularLines' + i, featureCollectionGeoJSON,
            { type: 'line', layout: { 'line-cap': 'square' }, paint: paint })) {
            created.push('stormTrackPerpendicularLines' + i);
        }
        storm_track_layers.push('stormTrackLines' + i);
        if (upsert('stormTrackLines' + i, multiLineGeoJSON,
            { type: 'line', layout: { 'line-cap': 'square' }, paint: paint })) {
            created.push('stormTrackLines' + i);
        }
    }
    storm_track_layers.push('stormTrackInitialPoint');
    if (upsert('stormTrackInitialPoint', multiPointGeoJSON, {
        type: 'circle',
        paint: {
            'circle-radius': 3,
            'circle-stroke-width': 1,
            'circle-color': 'white',
            'circle-stroke-color': 'black',
        }
    })) {
        created.push('stormTrackInitialPoint');
    }
    window.vortexData.storm_track_layers = storm_track_layers;

    bindHandlersOnce();
    setLayerOrder();

    // Re-evaluate every tracked cell against the user's location and fire any
    // impact alerts (only does anything if a GPS fix is already known). This
    // now runs once per new file, not once per radar plot.
    try {
        storm_alerts.evaluate(stormIDs.map((sid) => buildCellTrack(L3Factory, sid, allTracks[sid])));
    } catch (e) {}

    // A layer that already existed keeps whatever the toggle last set on it —
    // setData does not touch visibility. Only a freshly created layer needs
    // the toggle's current state applied.
    var isSTVisChecked = $('#armrSTVisBtnSwitchElem').is(':checked');
    if (!isSTVisChecked) {
        for (var j = 0; j < created.length; j++) {
            map.setLayoutProperty(created[j], 'visibility', 'none');
        }
    }
}

module.exports = plot_storm_tracks;
