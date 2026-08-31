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
import { addEarthquakes, removeEarthquakes } from './earthquakes.js';
import { addMPING, removeMPING } from './mping.js';
import { addBuoys, removeBuoys } from './buoys.js';
import { addHurricaneTracks, removeHurricaneTracks } from './hurricane_tracks.js';
import { addBuoyCams, removeBuoyCams } from './buoycams.js';
import { addFireDanger, removeFireDanger, addDay1FireWx, removeDay1FireWx, addDay2FireWx, removeDay2FireWx, addWildfires, removeWildfires } from './fire_weather.js';
import { addFirePerimeters, removeFirePerimeters, addActiveFires, removeActiveFires } from './fire_perimeters.js';

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
    const m = document.getElementById('vortexRadarMenu');
    if (m) m.style.display = 'none';
}

/*
 * Fold the map footer away.
 *
 * The choice is remembered, because someone who folded the bar to see the map
 * wants it folded next time too -- re-expanding on every load would make the
 * control feel like it had not worked.
 */
function initFooterCollapse() {
    const bar = document.getElementById('mapFooter');
    const btn = document.getElementById('mapFooterCollapse');
    if (!bar || !btn) return;

    const apply = (collapsed) => {
        bar.classList.toggle('vxFooterCollapsed', collapsed);
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        btn.title = collapsed ? 'Show the bar' : 'Hide the bar';
        const icon = btn.querySelector('i');
        if (icon) icon.className = collapsed ? 'fa fa-chevron-up' : 'fa fa-chevron-down';
    };

    let collapsed = false;
    try { collapsed = localStorage.getItem('vortexFooterCollapsed') === '1'; } catch (e) {}
    apply(collapsed);

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        collapsed = !collapsed;
        apply(collapsed);
        try { localStorage.setItem('vortexFooterCollapsed', collapsed ? '1' : '0'); } catch (e) {}
    });
}

function init() {
    initFooterCollapse();

    // --- dialogs (close the menu first so they aren't hidden behind it) ---
    onClick('armrLiveCamsBtn', () => { closeMenu(); openCams(); });
    onClick('armrReportWeatherBtn', () => withMap((w) => { closeMenu(); openWeatherReport(w); }, 'Report Weather'));
    onClick('armrSponsorsBtn', () => { closeMenu(); openSponsors(); });

    // --- layer toggles ---
    onToggle('armrCamerasSwitchElem', (on) => withMap((w) => on ? addCamMarkers(w) : removeCamMarkers(), 'Cameras'));
    onToggle('armrSpottersSwitchElem', (on) => withMap((w) => on ? addSpotterMarkers(w) : removeSpotterMarkers(), 'Spotters'));
    onToggle('armrMRMSSwitchElem', (on) => withMap((w) => on ? addMRMS(w) : removeMRMS(), 'MRMS'));
    onToggle('armrEarthquakesSwitchElem', (on) => withMap((w) => on ? addEarthquakes(w) : removeEarthquakes(), 'Earthquakes'));
    onToggle('armrMPINGSwitchElem', (on) => withMap((w) => on ? addMPING(w) : removeMPING(), 'mPING'));
    onToggle('armrBuoysSwitchElem', (on) => withMap((w) => on ? addBuoys(w) : removeBuoys(), 'Buoys'));
    onToggle('armrTracksAtlSwitchElem', (on) => withMap((w) => on ? addHurricaneTracks('atlantic', w) : removeHurricaneTracks('atlantic'), 'Atlantic Tracks'));
    onToggle('armrTracksEpacSwitchElem', (on) => withMap((w) => on ? addHurricaneTracks('epac', w) : removeHurricaneTracks('epac'), 'E Pacific Tracks'));
    onToggle('armrBuoyCamsSwitchElem', (on) => withMap((w) => on ? addBuoyCams(w) : removeBuoyCams(), 'BuoyCAMs'));
    onToggle('armrFireDangerSwitchElem', (on) => withMap((w) => on ? addFireDanger(w) : removeFireDanger(), 'Fire Danger'));
    onToggle('armrDay1FireWxSwitchElem', (on) => withMap((w) => on ? addDay1FireWx(w) : removeDay1FireWx(), 'Day 1 Fire Wx'));
    onToggle('armrDay2FireWxSwitchElem', (on) => withMap((w) => on ? addDay2FireWx(w) : removeDay2FireWx(), 'Day 2 Fire Wx'));
    onToggle('armrWildfiresSwitchElem', (on) => withMap((w) => on ? addWildfires(w) : removeWildfires(), 'Wildfires'));
    // NIFC footprint layers -- the burned area, which the placefile layers above
    // do not carry. See components/fire_perimeters.js.
    onToggle('armrFirePerimetersSwitchElem', (on) => withMap((w) => on ? addFirePerimeters(w) : removeFirePerimeters(w), 'Fire Perimeters'));
    onToggle('armrActiveFiresSwitchElem', (on) => withMap((w) => on ? addActiveFires(w) : removeActiveFires(w), 'Active Fires'));
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
