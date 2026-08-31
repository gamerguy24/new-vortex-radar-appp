/*
 * app/draw/draw_functions.js
 * Free-hand annotation layer — a full-window Fabric canvas floated over the
 * app, not a map layer. It draws in screen space, so it does not pan or zoom
 * with the radar; it is meant for marking up what is on screen right now.
 *
 * SPLIT SCREEN: the two panes are view-synced and each occupies exactly half
 * the window, so the same ground position appears in the right pane exactly
 * window.innerWidth/2 to the right of where it appears in the left one. That
 * makes mirroring an annotation a pure horizontal translation by half the
 * window — no projection maths, and it stays correct for any center or zoom
 * because both panes always share them.
 *
 * Mirrors are copies, flagged and non-interactive. Originals stay the only
 * thing the user edits; the mirrors are rebuilt whenever anything that would
 * invalidate them changes (split toggled, window resized).
 */

// Marks a clone so it is never itself mirrored, and can be cleanly swept up.
const MIRROR_FLAG = 'vortex_pane_mirror';

let split_handler = null;
let resize_handler = null;

function split_active() {
    try {
        return !!(document.body && document.body.classList.contains('vortex-split'));
    } catch (e) {
        return false;
    }
}

// Half the window: the exact screen distance between a point in the left pane
// and the same ground position in the right one.
function pane_offset() {
    return window.innerWidth / 2;
}

/**
 * Draw the same mark in the other pane.
 *
 * Which way to shift is decided by which half the mark's centre falls in, so a
 * stroke drawn on either pane copies to the other. A stroke drawn straight
 * across the divider is copied by its centre, which is the best a single
 * translation can do for it.
 */
function add_mirror(canvas, obj) {
    if (!canvas || !obj || obj[MIRROR_FLAG]) return;
    const half = pane_offset();

    let center_x;
    try { center_x = obj.getCenterPoint().x; } catch (e) { return; }
    const dx = center_x < half ? half : -half;

    // Fabric 5 clone() is callback-style. Cloning rather than re-drawing keeps
    // the brush width, colour and every path point identical.
    try {
        obj.clone((copy) => {
            if (!copy) return;
            copy.set({
                left: obj.left + dx,   // clone keeps originX, so this is a pure translation
                top: obj.top,
                selectable: false,
                evented: false,        // clicks fall through to the original layer
            });
            copy[MIRROR_FLAG] = true;
            canvas.add(copy);
            canvas.requestRenderAll();
        });
    } catch (e) {
        console.warn('[Draw] could not mirror an annotation to the other pane:', e);
    }
}

function clear_mirrors(canvas) {
    if (!canvas) return;
    canvas.getObjects()
        .filter((o) => o && o[MIRROR_FLAG])
        .forEach((o) => canvas.remove(o));
}

/*
 * Throw the mirrors away and make them again from the originals.
 *
 * Cheaper to reason about than patching them in place, and it is the correct
 * response to every case that invalidates them: split turning off (mirrors
 * must go, or a duplicate is left sitting over unrelated ground on the
 * full-width map), split turning on, and a resize changing the half-width the
 * offset is built from.
 */
function rebuild_mirrors(canvas) {
    if (!canvas) return;
    clear_mirrors(canvas);
    if (split_active()) {
        // Snapshot first: add_mirror appends to the same list.
        canvas.getObjects().slice().forEach((o) => add_mirror(canvas, o));
    }
    canvas.requestRenderAll();
}

function enable_drawing() {
    var canvas = new fabric.Canvas('draw_canvas');
    canvas.setWidth(window.innerWidth);
    canvas.setHeight(window.innerHeight);
    canvas.setBackgroundColor('transparent');
    $('body').append(canvas.wrapperEl);

    // Set up drawing properties
    canvas.isDrawingMode = true;
    canvas.freeDrawingBrush.width = 7;
    canvas.freeDrawingBrush.color = 'rgb(92, 157, 255)';

    // Copy each finished stroke into the other pane as it is drawn.
    canvas.on('path:created', (e) => {
        if (split_active() && e && e.path) add_mirror(canvas, e.path);
    });

    // Split screen opening or closing changes whether mirrors should exist at
    // all; a resize changes where they belong.
    split_handler = () => rebuild_mirrors(canvas);
    window.addEventListener('vortexsplitchange', split_handler);

    resize_handler = () => {
        canvas.setWidth(window.innerWidth);
        canvas.setHeight(window.innerHeight);
        rebuild_mirrors(canvas);
    };
    window.addEventListener('resize', resize_handler);

    window.vortexData.fabricjs_canvas = canvas;

    // Turning the pen on while split is already open should mirror whatever is
    // already there rather than wait for the next stroke.
    rebuild_mirrors(canvas);
}

function disable_drawing() {
    // $('#draw_canvas').off().remove();
    if (split_handler) { window.removeEventListener('vortexsplitchange', split_handler); split_handler = null; }
    if (resize_handler) { window.removeEventListener('resize', resize_handler); resize_handler = null; }

    if (window.vortexData.fabricjs_canvas != undefined) {
        window.vortexData.fabricjs_canvas.dispose();
    }
    // https://stackoverflow.com/a/10463219/18758797
    $('body > canvas').remove();
}

module.exports = {
    enable_drawing,
    disable_drawing
}
