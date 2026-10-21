/*
 * menu_item.js
 * On/off for the Manual Storm Track tool. The on/off state is still the (now
 * hidden) rail icon's class, so the alert, sounding and Pro code that clicks
 * or reads it keeps working. The menu's Tools › Manual Storm Track switch
 * mirrors that class and turns it on or off; the Stop button on the tool's
 * mode bar and Escape also turn it off, since the rail has no icon for it.
 * Makes sure the drawing tool and this tool are never armed at the same time
 * (they both hijack the map gesture).
 */

const mst = require('./manual_storm_track');

const icon_elem = '#mstMenuItemIcon';
const switch_elem = '#armrMstSwitchElem';

function onKey(e) {
    if (e.key === 'Escape' && mst.isActive()) $(icon_elem).click();
}
// mst.enable() builds the mode bar; this adds the way out to it.
function addStop() {
    const bar = document.getElementById('mstModeBar');
    if (!bar || bar.querySelector('.mst-stop')) return;
    const b = document.createElement('button');
    b.className = 'mst-stop';
    b.type = 'button';
    b.title = 'Turn off Manual Storm Track (Esc)';
    b.innerHTML = '<i class="fa fa-xmark"></i> Stop';
    b.onclick = () => { if (mst.isActive()) $(icon_elem).click(); };
    bar.appendChild(b);
}

function select() {
    $(icon_elem).addClass('menu_item_selected').removeClass('menu_item_not_selected');
    $(switch_elem).prop('checked', true);
    addStop();
    document.addEventListener('keydown', onKey);
}
function deselect() {
    $(icon_elem).removeClass('menu_item_selected').addClass('menu_item_not_selected');
    $(switch_elem).prop('checked', false);
    document.removeEventListener('keydown', onKey);
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
        mst.enable();
        select();
    } else {
        deselect();
        mst.disable();
    }
});

// If the user opens the draw tool or the inspector crosshair, stand this tool
// down so gestures don't collide.
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

// Menu › Tools › Manual Storm Track. Turning it on closes the menu so you can
// drag on the map straight away; turning it off leaves the menu open. The
// whole row toggles, like the other switch rows.
function setFromMenu(on) {
    if (on !== mst.isActive()) $(icon_elem).click();
    if (on) $('#vortexRadarMenuMainScreen .armsHeaderExitBtn').click();   // the menu's own close
}
$(switch_elem).on('change', function () { setFromMenu(this.checked); });
$('#armrMstBtn').on('click', function (e) {
    if (e.target.closest('.form-check')) return;   // the switch's own change handles it
    setFromMenu(!mst.isActive());
});
