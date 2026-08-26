/*
 * progress_bar.js
 * DOM-optional: the Level 2 parser calls these while decoding, and that parser
 * is also bundled standalone for pages that have no progress bar (the Graphics
 * Studio). Every lookup is therefore guarded — a missing element is a no-op,
 * not a TypeError that aborts the decode.
 */
function set_progress_bar_width(width_percent) {
    if (width_percent >= 100) { width_percent = 100 }
    const elem = document.getElementById('mainProgressBarInner');
    if (!elem) return;
    elem.style.right = '4px';
    const width = elem.offsetWidth;
    elem.style.right = `${width - ((width * (width_percent / 100)) - 4)}px`;
}

function set_progress_bar_text(text) {
    const elem = document.getElementById('mainProgressBarText');
    if (!elem) return;
    elem.innerHTML = text;
}

function show_progress_bar() {
    if (typeof $ === 'undefined') return;
    $('#progress_bar_screen_background').show();
}

function hide_progress_bar() {
    if (typeof $ === 'undefined') return;
    $('#progress_bar_screen_background').hide();
}

module.exports = {
    set_progress_bar_width,
    set_progress_bar_text,
    show_progress_bar,
    hide_progress_bar
}