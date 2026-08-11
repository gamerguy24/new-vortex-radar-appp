/*
 * shortcuts.js
 * Global keyboard shortcuts for laptop/desktop (mouse + keyboard) use:
 *   Space        play / pause the radar loop
 *   ← / →        step one frame back / forward
 *   Esc          close the open menu / dialog
 *   ?            toggle the shortcuts help overlay
 * Shortcuts are ignored while typing in a field, and never hijack browser
 * modifier combos (Ctrl/Cmd/Alt).
 */

const loop = require('../../radar/animation/radar_loop');

function isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const t = (el.tagName || '').toUpperCase();
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
}

// Close the topmost piece of open UI. Returns true if it closed something.
function closeTopUI() {
    if (helpEl) { toggleHelp(); return true; }
    const menu = document.getElementById('atticRadarMenu');
    if (menu && menu.style.display !== 'none') { menu.style.display = 'none'; return true; }
    const modelsClose = document.getElementById('vmpClose');
    if (modelsClose && document.getElementById('vortexModelsPanel')) { modelsClose.click(); return true; }
    return false;
}

// ── help overlay ────────────────────────────────────────────────────────────────
let helpEl = null;
const ROWS = [
    ['Space', 'Play / pause radar loop'],
    ['← / →', 'Step frames back / forward'],
    ['Esc', 'Close menu or dialog'],
    ['Scroll', 'Zoom the map'],
    ['?', 'Toggle this help'],
];
function toggleHelp() {
    if (helpEl) { helpEl.remove(); helpEl = null; return; }
    helpEl = document.createElement('div');
    helpEl.id = 'vortexShortcutHelp';
    helpEl.style.cssText = `position:fixed;right:16px;bottom:80px;z-index:100080;
        background:linear-gradient(180deg,rgba(17,25,42,.97),rgba(9,14,26,.97));
        border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 16px;color:#eef4fb;
        font-family:'Onest',system-ui,sans-serif;box-shadow:0 18px 44px rgba(0,0,0,.55);min-width:230px;
        -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);`;
    const rows = ROWS.map(([k, d]) =>
        `<div style="display:flex;align-items:center;gap:12px;margin-top:7px;font-size:12.5px">
            <span style="min-width:52px;text-align:center;font-weight:800;background:rgba(255,255,255,.08);
                border:1px solid rgba(255,255,255,.14);border-radius:7px;padding:3px 6px">${k}</span>
            <span style="color:#c3cedb">${d}</span></div>`).join('');
    helpEl.innerHTML = `<div style="font-size:13px;font-weight:800;letter-spacing:.02em">Keyboard shortcuts</div>${rows}
        <div style="margin-top:10px;font-size:10.5px;color:#8ea4bd">Press ? or Esc to close</div>`;
    document.body.appendChild(helpEl);
}

document.addEventListener('keydown', (e) => {
    if (isTyping()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.code) {
        case 'Space': e.preventDefault(); loop.togglePlay(); break;
        // only hijack arrows when a loop is loaded; otherwise let Mapbox pan
        case 'ArrowLeft': if (loop.step(-1)) e.preventDefault(); break;
        case 'ArrowRight': if (loop.step(1)) e.preventDefault(); break;
        case 'Escape': closeTopUI(); break;
        default:
            if (e.key === '?') { e.preventDefault(); toggleHelp(); }
    }
});

module.exports = {};
