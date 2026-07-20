/*
 * spaghetti_menu_item.js
 * Wires the "Spaghetti Models" layer toggle to the a-deck model-guidance
 * overlay. Loads on first enable, then just shows/hides.
 */

const armFunctions = require('../../core/menu/atticRadarMenu');
const spaghetti = require('./nhc_spaghetti');

armFunctions.toggleswitchFunctions(
    $('#armrSpaghettiBtnSwitchElem'),
    function () { spaghetti.enable(); },
    function () { spaghetti.disable(); }
);
