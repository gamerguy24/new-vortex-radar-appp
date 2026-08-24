const luxon = require('luxon');

function get_individual_data(station_id, alt_name, ref_date, callback) {
    // "yLLdd" = YYYYMMDD = 20230621
    const start_day_formatted = luxon.DateTime.fromJSDate(ref_date).minus({ days: 1 }).toFormat('yLLdd');
    const end_day_formatted = luxon.DateTime.fromJSDate(ref_date).plus({ days: 1 }).toFormat('yLLdd');

    // Goes through the app's own endpoint (not NOAA directly) so the server can
    // enforce the Tier One gate — see /api/tides/predictions in server.js.
    const tide_data_url = `/api/tides/predictions?station=${encodeURIComponent(station_id)}`
        + `&begin=${start_day_formatted}&end=${end_day_formatted}`;
    fetch(tide_data_url, { credentials: 'same-origin' })
    .then(response => {
        if (response.status == 402) {
            if (window.vortexProGate) window.vortexProGate.denied('Tide Stations', 1, 'armrTideStationsBtnSwitchElem');
            return null;
        }
        return response.json();
    })
    .then(tide_data => {
        if (tide_data == null || !tide_data.predictions) return;
        const tide_height_array = [];
        for (var i = 0; i < tide_data.predictions.length; i++) {
            const value = parseFloat(tide_data.predictions[i].v);
            const type = tide_data.predictions[i].type;
            // we need to replace the space in the middle with a T and append a Z, because safari won't parse the string otherwise
            const time = new Date(tide_data.predictions[i].t.replace(' ', 'T'));

            tide_height_array.push([time.getTime(), value, type]);
        }

        callback(tide_height_array, alt_name);
    })
}

module.exports = get_individual_data;