const draw_functions = require('./draw_functions');

const div_elem = '#drawMenuItemDiv';
const icon_elem = '#drawMenuItemIcon';
const switch_elem = '#armrDrawSwitchElem';

/*
 * The pen's on/off state is still the (now hidden) rail icon's class, so the
 * storm-track, sounding and Pro code that clicks or reads it keeps working.
 * The menu's Tools › Draw on Map switch mirrors that class and turns it on or
 * off; the floating Stop drawing button and Escape also turn it off.
 */
function onKey(e) {
    if (e.key === 'Escape' && $(icon_elem).hasClass('menu_item_selected')) $(icon_elem).click();
}
function showStop() {
    if (document.getElementById('vxDrawStop')) return;
    const b = document.createElement('button');
    b.id = 'vxDrawStop';
    b.type = 'button';
    b.innerHTML = '<i class="fa fa-pencil"></i> Drawing on — tap to stop';
    b.title = 'Stop drawing (Esc)';
    b.addEventListener('click', () => { if ($(icon_elem).hasClass('menu_item_selected')) $(icon_elem).click(); });
    document.body.appendChild(b);
    document.addEventListener('keydown', onKey);
}
function hideStop() {
    const b = document.getElementById('vxDrawStop');
    if (b) b.remove();
    document.removeEventListener('keydown', onKey);
}

$(icon_elem).on('click', function () {
    if (!$(icon_elem).hasClass('menu_item_selected')) {
        $(icon_elem).addClass('menu_item_selected');
        $(icon_elem).removeClass('menu_item_not_selected');

        if ($('#colorPickerItemClass').hasClass('menu_item_selected')) {
            $('#colorPickerItemClass').click();
        }

        draw_functions.enable_drawing();
        showStop();
        $(switch_elem).prop('checked', true);
    } else if ($(icon_elem).hasClass('menu_item_selected')) {
        $(icon_elem).removeClass('menu_item_selected');
        $(icon_elem).addClass('menu_item_not_selected');

        draw_functions.disable_drawing();
        hideStop();
        $(switch_elem).prop('checked', false);
    }
})

function _disable() {
    $(icon_elem).removeClass('menu_item_selected');
    $(icon_elem).addClass('menu_item_not_selected');
    draw_functions.disable_drawing();
    hideStop();
    $(switch_elem).prop('checked', false);
}
$('#colorPickerItemDiv').on('click', function () {
    if ($(this).find('span').hasClass('menu_item_selected')) {
        _disable();
    }
})

// Menu › Tools › Draw on Map. Turning it on closes the menu so you can draw
// straight away; turning it off leaves the menu open. The whole row toggles,
// like the other switch rows.
function setFromMenu(on) {
    if (on !== $(icon_elem).hasClass('menu_item_selected')) $(icon_elem).click();
    if (on) $('#vortexRadarMenuMainScreen .armsHeaderExitBtn').click();   // the menu's own close
}
$(switch_elem).on('change', function () { setFromMenu(this.checked); });
$('#armrDrawBtn').on('click', function (e) {
    if (e.target.closest('.form-check')) return;   // the switch's own change handles it
    setFromMenu(!$(icon_elem).hasClass('menu_item_selected'));
})
