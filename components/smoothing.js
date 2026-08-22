/*
 * components/smoothing.js
 * Radar smoothing toggle. When on (the default), the colortable is rendered as a
 * continuous gradient with linear texture sampling, so reflectivity looks smooth
 * like a modern weather app instead of grainy stepped bands. When off, the crisp
 * stepped colortable is shown exactly as authored.
 *
 * State lives on window.vortexSmoothing (a boolean), read by create_WebGL_texture
 * + plot_to_map, and cached in localStorage so each viewer's choice persists.
 * Changing it rebuilds the colortable texture, so we re-plot the current radar.
 */

const CACHE_KEY = 'vortexSmoothing';

function isOn() { return window.vortexSmoothing !== false; }

// Rebuild + redraw the current radar with the new smoothing setting.
function rePlot() {
    const a = window.atticData;
    if (a && a.nexrad_factory) {
        try {
            if (a.nexrad_factory.nexrad_level == 3) a.nexrad_factory.plot();
            else a.nexrad_factory.plot(a.nexrad_factory_moment, a.nexrad_factory_elevation_number);
        } catch (e) {}
    }
    const w = window.vortexMap;
    if (w && w.map) { try { w.map.triggerRepaint(); } catch (e) {} }
}

function setSmoothing(on) {
    window.vortexSmoothing = !!on;
    try { localStorage.setItem(CACHE_KEY, on ? 'true' : 'false'); } catch (e) {}
    rePlot();
}

function init() {
    // Restore saved setting (default ON). Kept off window.atticData, which the
    // app resets on load.
    let saved = null;
    try { saved = localStorage.getItem(CACHE_KEY); } catch (e) {}
    window.vortexSmoothing = (saved === null) ? true : (saved === 'true');

    const sw = document.getElementById('armrSmoothingSwitchElem');
    if (sw) {
        sw.checked = isOn();
        sw.addEventListener('change', () => setSmoothing(sw.checked));
    }
    // The whole row toggles the switch too (matches the other menu rows).
    const row = document.getElementById('armrSmoothingBtn');
    if (row && sw) {
        row.addEventListener('click', (e) => {
            if (e.target === sw || (e.target.closest && e.target.closest('.form-check'))) return;
            sw.checked = !sw.checked;
            setSmoothing(sw.checked);
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
