/*
 * menu_item.js
 * Toggle for the GOES-19 Clean LW IR (Band 13) satellite layer.
 */

const armFunctions = require('../core/menu/vortexRadarMenu');
const goes_ir = require('./goes_ir');

armFunctions.toggleswitchFunctions(
    $('#armrGoesIRBtnSwitchElem'),
    function () { goes_ir.enable(); },
    function () { goes_ir.disable(); }
);
