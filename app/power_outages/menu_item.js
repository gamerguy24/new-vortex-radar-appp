/*
 * menu_item.js
 * Toggle for the county Power Outages overlay (MassOutage live data).
 */

const armFunctions = require('../core/menu/vortexRadarMenu');
const power_outages = require('./power_outages');

armFunctions.toggleswitchFunctions(
    $('#armrPowerOutagesBtnSwitchElem'),
    function () { power_outages.enable(); },
    function () { power_outages.disable(); }
);
