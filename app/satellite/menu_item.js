/*
 * menu_item.js
 * Toggle for the GOES satellite layer, and the menu's pick of which picture
 * it shows: GeoColor, enhanced Band 13, or any of infrared bands 7–16.
 */

const armFunctions = require('../core/menu/vortexRadarMenu');
const goes_ir = require('./goes_ir');

const $switch = $('#armrGoesIRBtnSwitchElem');

armFunctions.toggleswitchFunctions(
    $switch,
    function () { goes_ir.enable(); },
    function () { goes_ir.disable(); }
);

/*
 * Picking a view is asking to see it, so a pick made with the layer off
 * turns it on — through the switch, so the switch and the layer agree.
 */
const sel = document.getElementById('armrSatProduct');
if (sel) {
    sel.innerHTML = goes_ir.productOptions();
    sel.addEventListener('change', () => {
        goes_ir.setProduct(sel.value);
        if ($switch.length && !$switch[0].checked) $switch[0].click();
    });
}
