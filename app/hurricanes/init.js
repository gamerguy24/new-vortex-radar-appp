const nhc_process_data = require('./nhc/nhc_process_data');
const nhc_process_outlooks = require('./nhc/nhc_process_outlooks');
const nhc_active_overlay = require('./nhc/nhc_active_overlay');

function init_hurricane_loading() {
    window.atticData.hurricane_layers = [];

    nhc_process_data();
    nhc_process_outlooks();
    // Adds the rest of the NHC feed (nhc.kmz): past track, initial wind field
    // and a labeled storm-center marker with the full advisory stats.
    nhc_active_overlay();
}

module.exports = init_hurricane_loading;