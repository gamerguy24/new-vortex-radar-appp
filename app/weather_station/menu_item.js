const fetchData = require('./fetch_data');
const ut = require('../core/utils');
const armFunctions = require('../core/menu/vortexRadarMenu');

$('#armrVortexStationBtn').click(function() {
    ut.loadingSpinner(true);
    fetchData();
    armFunctions.hideARMwindow();
})