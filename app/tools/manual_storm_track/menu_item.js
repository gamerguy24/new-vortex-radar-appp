/*
 * menu_item.js
 * Toolbar toggle for the Manual Storm Track tool. Mirrors the draw tool's
 * selected/not-selected icon pattern and makes sure the drawing tool and this
 * tool are never armed at the same time (they both hijack the map gesture).
 */

const mst = require('./manual_storm_track');

const icon_elem = '#mstMenuItemIcon';

function select() {
    $(icon_elem).addClass('menu_item_selected').removeClass('menu_item_not_selected');
}
function deselect() {
    $(icon_elem).removeClass('menu_item_selected').addClass('menu_item_not_selected');
}

$(icon_elem).on('click', function () {
    if (!$(icon_elem).hasClass('menu_item_selected')) {
        // Turn off the freehand draw tool if it's on (it also grabs the gesture).
        if ($('#drawMenuItemIcon').hasClass('menu_item_selected')) {
            $('#drawMenuItemIcon').click();
        }
        // Turn off the color-picker / inspector crosshair if it's on.
        if ($('#colorPickerItemClass').hasClass('menu_item_selected')) {
            $('#colorPickerItemClass').click();
        }
        select();
        mst.enable();
    } else {
        deselect();
        mst.disable();
    }
});

// If the user opens the draw tool, settings, or the inspector crosshair, stand
// this tool down so gestures don't collide.
function _disableIfActive() {
    if (mst.isActive()) {
        deselect();
        mst.disable();
    }
}
$('#drawMenuItemIcon').on('click', function () {
    if ($(this).hasClass('menu_item_selected')) { _disableIfActive(); }
});
$('#colorPickerItemDiv').on('click', _disableIfActive);
$('#settingsItemDiv').on('click', _disableIfActive);
