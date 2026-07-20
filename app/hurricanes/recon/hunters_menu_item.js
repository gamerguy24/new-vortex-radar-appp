/*
 * hunters_menu_item.js
 * Wires the "Hurricane Hunters" layer toggle to the live-aircraft + recon
 * overlay. Loads/refreshes on enable, hides on disable.
 */

const armFunctions = require('../../core/menu/atticRadarMenu');
const hunters = require('./hurricane_hunters');

armFunctions.toggleswitchFunctions(
    $('#armrHurricaneHuntersBtnSwitchElem'),
    function () { hunters.enable(); },
    function () { hunters.disable(); }
);
