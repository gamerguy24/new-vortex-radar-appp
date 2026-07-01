/*
 * components/gate_filter.js
 * Reflectivity Gate Filter: hides reflectivity returns below a chosen dBZ
 * threshold (clears out weak returns / ground clutter). The threshold is read
 * by the radar WebGL shader (window.vortexGateFilter); changes re-render live.
 *
 * State lives on window.vortexGateFilter (NOT window.atticData, which the app
 * resets on load) and is cached in localStorage so it persists.
 */

import Dialog from "../js/ui/dialog.js";

const CACHE_KEY = 'vortexGateFilter';

function state() {
    if (!window.vortexGateFilter) window.vortexGateFilter = { enabled: false, value: 5 };
    return window.vortexGateFilter;
}

function repaint() {
    const w = window.vortexMap;
    if (w && w.map) { try { w.map.triggerRepaint(); } catch (e) {} }
}

function persist() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state())); } catch (e) {}
}

function openGateFilter() {
    const s = state();
    const content = `
        <div class="vr-gate">
            <p class="vr-gate-intro">Hide reflectivity returns weaker than the threshold below — useful for clearing out ground clutter and light noise. Only affects reflectivity products.</p>

            <label class="vr-gate-toggle">
                <input type="checkbox" id="vr-gate-enabled" ${s.enabled ? 'checked' : ''} />
                <span>Enable gate filter</span>
            </label>

            <div class="vr-gate-row">
                <span class="vr-gate-label">Minimum reflectivity</span>
                <span class="vr-gate-value" id="vr-gate-value">${s.value} dBZ</span>
            </div>
            <input type="range" id="vr-gate-slider" min="-10" max="50" step="1" value="${s.value}" />
        </div>`;

    new Dialog('Reflectivity Gate Filter', 'filter', content, {}, true);

    const enabledEl = document.getElementById('vr-gate-enabled');
    const sliderEl = document.getElementById('vr-gate-slider');
    const valueEl = document.getElementById('vr-gate-value');

    function sync() {
        s.enabled = enabledEl.checked;
        s.value = parseInt(sliderEl.value, 10);
        valueEl.textContent = s.value + ' dBZ';
        sliderEl.disabled = !s.enabled;
        persist();
        repaint();
    }

    enabledEl.addEventListener('change', sync);
    sliderEl.addEventListener('input', sync);
    sliderEl.disabled = !s.enabled;
}

function init() {
    // restore saved setting (kept off window.atticData so the app's reset won't wipe it)
    try {
        const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (saved && typeof saved.value === 'number') window.vortexGateFilter = { enabled: !!saved.enabled, value: saved.value };
    } catch (e) {}
    state(); // ensure it exists

    const btn = document.getElementById('armrGateFilterBtn');
    if (btn) btn.addEventListener('click', () => {
        const m = document.getElementById('atticRadarMenu');
        if (m) m.style.display = 'none';
        openGateFilter();
    });

    // if a radar is already up, apply immediately
    repaint();
    window.addEventListener('vortexmapready', repaint, { once: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
