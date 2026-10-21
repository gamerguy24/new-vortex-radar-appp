const draw_functions = require('./draw_functions');

const div_elem = '#drawMenuItemDiv';
const icon_elem = '#drawMenuItemIcon';

/*
 * The pen's on/off state is still the (now hidden) rail icon's class, so the
 * storm-track, sounding and Pro code that clicks or reads it keeps working.
 * Starting it is the menu's Tools › Draw on Map row; stopping it is the
 * floating Stop drawing button or Escape, since the rail has no pencil.
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
    } else if ($(icon_elem).hasClass('menu_item_selected')) {
        $(icon_elem).removeClass('menu_item_selected');
        $(icon_elem).addClass('menu_item_not_selected');

        draw_functions.disable_drawing();
        hideStop();
    }
})

function _disable() {
    $(icon_elem).removeClass('menu_item_selected');
    $(icon_elem).addClass('menu_item_not_selected');
    draw_functions.disable_drawing();
    hideStop();
}
$('#colorPickerItemDiv').on('click', function () {
    if ($(this).find('span').hasClass('menu_item_selected')) {
        _disable();
    }
})
$('#settingsItemDiv').on('click', function () {
    _disable();
})

// Menu › Tools › Draw on Map: close the menu and start the pen. (Opening the
// menu already stopped any drawing, so this only ever turns it on.)
$('#armrDrawBtn').on('click', function () {
    $('#vortexRadarMenuMainScreen .armsHeaderExitBtn').click();   // the menu's own close
    if (!$(icon_elem).hasClass('menu_item_selected')) $(icon_elem).click();
})
