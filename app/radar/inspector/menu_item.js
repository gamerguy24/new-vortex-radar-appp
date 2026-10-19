/*
 * The data inspector (crosshair button on the footer bar).
 *
 * With a mouse or trackpad it reads whatever the radar shows under the
 * pointer and shows it in a tooltip beside it: "52.5 dBZ", the colour, and
 * the beam height there. Touch screens cannot hover, so there it keeps the
 * fixed crosshair in the middle of the map and reads under that as you pan.
 *
 * The values come from plot_to_map's off-screen framebuffer, which is only
 * drawn while this tool is on (it costs a second pass), so switching on asks
 * the map for a repaint before the first read.
 */
const map = require('../../core/map/map');
const { value_at, update_crosshair } = require('./get_value');

const iconElem = '#colorPickerItemClass';
const canHover = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

let tip = null;
let lastPoint = null;      // last pointer position over the map (CSS px)

function tipElem() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'vx-inspect-tip';
    tip.setAttribute('role', 'status');
    tip.innerHTML = '<div class="vx-inspect-val"><span class="vx-inspect-sw"></span><span class="vx-inspect-num"></span></div>'
        + '<div class="vx-inspect-sub"></div>';
    document.body.appendChild(tip);
    return tip;
}

function hideTip() { if (tip) tip.style.display = 'none'; }

function showAt(point) {
    const out = value_at(point);
    if (!out || out.value == null) { hideTip(); return; }
    const t = tipElem();
    t.querySelector('.vx-inspect-num').textContent = out.value;
    const sw = t.querySelector('.vx-inspect-sw');
    sw.style.background = out.color || 'transparent';
    sw.style.display = out.color ? '' : 'none';
    t.querySelector('.vx-inspect-sub').textContent = out.beam_ft != null ? `Beam ${Math.round(out.beam_ft).toLocaleString()} ft ARL` : '';
    t.style.display = 'block';
    // Beside the pointer, flipped to the other side near the window's edges.
    const rect = map.getCanvas().getBoundingClientRect();
    const x = rect.left + point.x, y = rect.top + point.y;
    const w = t.offsetWidth, h = t.offsetHeight, gap = 16;
    t.style.left = `${x + gap + w > window.innerWidth ? x - gap - w : x + gap}px`;
    t.style.top = `${y + gap + h > window.innerHeight ? y - gap - h : y + gap}px`;
}

function onMouseMove(e) { lastPoint = e.point; showAt(e.point); }
function onMouseOut() { lastPoint = null; hideTip(); }
// The map moved under a still pointer, or a new scan was drawn: read again.
function onRefresh() { if (lastPoint) showAt(lastPoint); }

function enable() {
    if (canHover) {
        map.on('mousemove', onMouseMove);
        map.on('mouseout', onMouseOut);
        map.on('moveend', onRefresh);
        map.on('idle', onRefresh);
        map.getCanvas().style.cursor = 'crosshair';
    } else {
        $('.colorPicker').show();
        $('#colorPickerText').hide();
        $('#colorPickerBorder').css('display', 'flex');
        map.on('move', update_crosshair);
        map.on('idle', update_crosshair);
    }
    // Fill the value framebuffer now rather than on the next pan.
    map.triggerRepaint();
}

function disable() {
    map.off('mousemove', onMouseMove);
    map.off('mouseout', onMouseOut);
    map.off('moveend', onRefresh);
    map.off('idle', onRefresh);
    map.off('move', update_crosshair);
    map.off('idle', update_crosshair);
    lastPoint = null;
    hideTip();
    $('.colorPicker').hide();
    map.getCanvas().style.cursor = '';
}

$(iconElem).on('click', function () {
    if (!$(iconElem).hasClass('menu_item_selected')) {
        $(iconElem).addClass('menu_item_selected').removeClass('menu_item_not_selected');
        enable();
    } else {
        $(iconElem).removeClass('menu_item_selected').addClass('menu_item_not_selected');
        disable();
    }
});
