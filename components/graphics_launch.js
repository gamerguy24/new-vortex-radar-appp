/*
 * components/graphics_launch.js
 * Wires the Vortex Graphics tools (Studio editor, Dashboard, Overlay) which are
 * bundled under /graphics/ and served behind the same login as the radar.
 *
 * Two entry points, both handled here:
 *   - the always-visible footer icon (#vortexGraphicsBtn) -> pops a small menu
 *   - the settings-menu row (#armrGraphicsStudioBtn) -> opens the Studio directly
 * Each tool is a standalone static page, so we just open it in a new tab.
 */

// The Studio is fully self-contained (static + local geo data) and works behind
// the radar login as-is. (The Dome "Dashboard"/"Overlay" tools are intentionally
// not bundled here — they need a separate backend and aren't part of this app.)
const TOOLS = [
    { id: 'studio', label: 'Graphics Studio', sub: 'Broadcast graphics editor', icon: 'fa-palette', url: '/graphics/studio/index.html' },
];

function open(url) {
    window.open(url, '_blank', 'noopener');
}

function closeMenu() {
    const m = document.getElementById('vortexRadarMenu');
    if (m) m.style.display = 'none';
}

let _popup = null;

function closePopup() {
    if (_popup) { _popup.remove(); _popup = null; }
    document.removeEventListener('mousedown', onDocDown, true);
}

function onDocDown(e) {
    if (_popup && !_popup.contains(e.target) &&
        !document.getElementById('vortexGraphicsBtn')?.contains(e.target)) {
        closePopup();
    }
}

function togglePopup() {
    if (_popup) { closePopup(); return; }

    const btn = document.getElementById('vortexGraphicsBtn');
    const pop = document.createElement('div');
    pop.id = 'vortexGraphicsPopup';
    pop.style.cssText = `
        position: fixed; z-index: 100060; min-width: 230px;
        background: rgba(11,18,32,0.98); border: 1px solid rgba(39,190,255,0.35);
        border-radius: 12px; padding: 6px; box-shadow: 0 14px 40px rgba(0,0,0,0.55);
        font-family: 'Onest', system-ui, sans-serif;`;

    pop.innerHTML = `<div style="padding:8px 10px 4px; color:#7f93b0; font-size:11px;
        letter-spacing:.08em; text-transform:uppercase;">Vortex Graphics</div>`;

    for (const t of TOOLS) {
        const row = document.createElement('div');
        row.style.cssText = `display:flex; align-items:center; gap:11px; padding:9px 10px;
            border-radius:9px; cursor:pointer; color:#e6edf6; font-size:14px;`;
        row.onmouseenter = () => { row.style.background = 'rgba(39,190,255,0.12)'; };
        row.onmouseleave = () => { row.style.background = 'transparent'; };
        row.innerHTML = `
            <span class="fa ${t.icon}" style="color:#27beff; width:18px; text-align:center;"></span>
            <span><div style="font-weight:600;">${t.label}</div>
            <div style="color:#7f93b0; font-size:12px;">${t.sub}</div></span>`;
        row.addEventListener('click', () => { open(t.url); closePopup(); });
        pop.appendChild(row);
    }

    document.body.appendChild(pop);

    // Anchor above the footer button, keeping it on-screen.
    const r = btn ? btn.getBoundingClientRect() : { left: 20, top: window.innerHeight - 60 };
    const pr = pop.getBoundingClientRect();
    let left = r.left + r.width / 2 - pr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(8, r.top - pr.height - 10)}px`;

    _popup = pop;
    document.addEventListener('mousedown', onDocDown, true);
}

function init() {
    const footBtn = document.getElementById('vortexGraphicsBtn');
    // One tool -> open it directly; multiple -> show the chooser popup.
    if (footBtn) footBtn.addEventListener('click',
        TOOLS.length === 1 ? () => open(TOOLS[0].url) : togglePopup);

    // Settings-menu row opens the Studio (the main editor) directly.
    const row = document.getElementById('armrGraphicsStudioBtn');
    if (row) row.addEventListener('click', () => { closeMenu(); open(TOOLS[0].url); });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
