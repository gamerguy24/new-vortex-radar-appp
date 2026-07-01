/*
 * components/vortex_layers.js
 * Wires the Vortex Radar feature layers (Live Cams, Sponsors, Report Weather,
 * Spotter Network, MRMS) to the in-app menu. Loaded as a plain ES module.
 *
 * The map is created by the bundled app and published as window.vortexMap
 * ({ map, dualMap }). We grab it lazily so this module doesn't care about load
 * order, and restore persisted layer toggles once the map signals it's ready.
 */

import openSponsors from './sponsors.js';
import openCams, { addCamMarkers, removeCamMarkers } from './cams.js';
import openWeatherReport, { addWeatherReportMarkers, removeWeatherReportMarkers } from './weather_report.js';
import { addSpotterMarkers, removeSpotterMarkers } from './spotters.js';
import { addMRMS, removeMRMS } from './mrms.js';

function wrapper() { return window.vortexMap || null; }

function onClick(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
}

function onToggle(id, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => onChange(el.checked, el));
}

function withMap(fn, label) {
    const w = wrapper();
    if (!w || !w.map) {
        console.warn(`[VortexLayers] Map not ready for ${label || 'layer'} yet.`);
        return;
    }
    fn(w);
}

function closeMenu() {
    const m = document.getElementById('atticRadarMenu');
    if (m) m.style.display = 'none';
}

function init() {
    // --- dialogs (close the menu first so they aren't hidden behind it) ---
    onClick('armrLiveCamsBtn', () => { closeMenu(); openCams(); });
    onClick('armrReportWeatherBtn', () => withMap((w) => { closeMenu(); openWeatherReport(w); }, 'Report Weather'));
    onClick('armrSponsorsBtn', () => { closeMenu(); openSponsors(); });

    // --- layer toggles ---
    onToggle('armrCamerasSwitchElem', (on) => withMap((w) => on ? addCamMarkers(w) : removeCamMarkers(), 'Cameras'));
    onToggle('armrSpottersSwitchElem', (on) => withMap((w) => on ? addSpotterMarkers(w) : removeSpotterMarkers(), 'Spotters'));
    onToggle('armrMRMSSwitchElem', (on) => withMap((w) => on ? addMRMS(w) : removeMRMS(), 'MRMS'));
    onToggle('toggle-community-reports-layer', (on) => {
        localStorage.setItem('communityReportsEnabled', on ? 'true' : 'false');
        withMap((w) => on ? addWeatherReportMarkers(w) : removeWeatherReportMarkers(), 'User Storm Reports');
    });

    // Restore the persisted "User Storm Reports" toggle once the map is ready.
    const restore = () => {
        if (localStorage.getItem('communityReportsEnabled') === 'true') {
            const cb = document.getElementById('toggle-community-reports-layer');
            if (cb) cb.checked = true;
            withMap((w) => addWeatherReportMarkers(w), 'User Storm Reports');
        }
    };
    if (wrapper()) restore();
    else window.addEventListener('vortexmapready', restore, { once: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
