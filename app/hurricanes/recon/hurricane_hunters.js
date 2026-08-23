/*
 * hurricane_hunters.js
 * "Hurricane Hunters" layer — two things at once:
 *   1. Live aircraft positions of the NOAA + USAF reconnaissance planes, from
 *      the free adsb.lol ADS-B API (through the app proxy).
 *   2. The most recent recon flight track + observations, decoded from NHC's
 *      HDOB bulletins (High Density Observations, WMO header URNT15 / dir
 *      AHONT1). Each 30-second ob has a position, flight-level wind and, when
 *      the SFMR is working, a surface wind estimate.
 *
 * One menu toggle controls both. Layers live on window.vortexData.hunter_layers.
 */

const ut = require('../../core/utils');
const map = require('../../core/map/map');
const turf = require('@turf/turf');
const icons = require('../../core/map/icons/icons');

// NOAA planes are civil-registered (queried by callsign); USAF 53rd WRS fly as
// TEAL## and show up in the military feed.
const NOAA_CALLSIGNS = ['NOAA42', 'NOAA43', 'NOAA49', 'NOAA51'];
const ADSB_BASE = 'https://api.adsb.lol/v2/';
const RECON_DIR = `https://www.nhc.noaa.gov/archive/recon/${new Date().getUTCFullYear()}/AHONT1/`;
const RECON_FILES_TO_LOAD = 8; // most-recent HDOB legs to stitch into a track

const PLANE_SRC = 'hunter_planes_src', PLANE_LAYER = 'hunter_planes_layer', PLANE_LABEL = 'hunter_planes_label';
const RECON_SRC = 'hunter_recon_src', RECON_LINE = 'hunter_recon_line', RECON_PTS = 'hunter_recon_pts';

// A little top-down plane glyph (points "up"; we rotate it by heading).
const PLANE_SVG =
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">
        <path fill="#ffd23c" stroke="#1a1300" stroke-width="0.8"
          d="M12 2l1.2 6.2 7.3 4.1v2l-8.5-2.4-.8 4.9 2.6 1.7v1.6L12 19l-1.8.8v-1.6l2.6-1.7-.8-4.9L3.5 14.3v-2l7.3-4.1z"/>
    </svg>`;

let _enabled = false;
let _refreshTimer = null;
let _planeIconLoaded = false;

// ── proxy fetch ──────────────────────────────────────────────────────────────
function pget(url) { return fetch(ut.phpProxy + url, { headers: { 'Cache-Control': 'no-cache' } }); }
function getJson(url) { return pget(url).then((r) => r.json()); }
function getText(url) { return pget(url).then((r) => r.text()); }

// ── live planes (ADS-B) ──────────────────────────────────────────────────────
function planeFeatures(list) {
    const feats = [];
    const seen = new Set();
    for (const a of list) {
        if (!a || seen.has(a.hex)) continue;
        const lat = a.lat, lon = a.lon;
        if (typeof lat !== 'number' || typeof lon !== 'number') continue;
        seen.add(a.hex);
        feats.push(turf.point([lon, lat], {
            callsign: (a.flight || '').trim() || (a.r || 'RECON'),
            type: a.t || '', alt: a.alt_baro != null ? a.alt_baro : a.alt_geom,
            gs: a.gs, track: typeof a.track === 'number' ? a.track : 0,
        }));
    }
    return feats;
}

function loadPlanes() {
    const jobs = [
        getJson(`${ADSB_BASE}mil`).then((j) => (j.ac || []).filter((a) => (a.flight || '').trim().startsWith('TEAL'))).catch(() => []),
    ];
    for (const cs of NOAA_CALLSIGNS) {
        jobs.push(getJson(`${ADSB_BASE}callsign/${cs}`).then((j) => j.ac || []).catch(() => []));
    }
    Promise.all(jobs).then((groups) => {
        const feats = planeFeatures([].concat(...groups));
        const src = map.getSource(PLANE_SRC);
        if (src) src.setData(turf.featureCollection(feats));
    });
}

// ── recon HDOB decoding ──────────────────────────────────────────────────────
// "2828N" -> 28.4667 ; "08526W" -> -85.4333  (DDMM / DDDMM degrees+minutes)
function hdobLat(raw) {
    const m = /^(\d{2})(\d{2})([NS])$/.exec(raw); if (!m) return null;
    const v = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
    return m[3] === 'S' ? -v : v;
}
function hdobLon(raw) {
    const m = /^(\d{3})(\d{2})([EW])$/.exec(raw); if (!m) return null;
    const v = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
    return m[3] === 'W' ? -v : v;
}

// Parse one HDOB bulletin's observation lines into ordered obs points.
function parseHdob(text) {
    const obs = [];
    for (const line of text.split('\n')) {
        const c = line.trim().split(/\s+/);
        if (c.length < 9) continue;
        if (!/^\d{6}$/.test(c[0])) continue;          // HHMMSS time
        const lat = hdobLat(c[1]); const lon = hdobLon(c[2]);
        if (lat == null || lon == null) continue;

        const p = { time: c[0], lon, lat };
        // Flight-level wind: "ddd sss" packed as 6 digits (e.g. 319002).
        const w = /^(\d{3})(\d{3})$/.exec(c[8] || '');
        if (w) { p.flDir = parseInt(w[1], 10); p.flSpd = parseInt(w[2], 10); }
        // SFMR surface wind (kt) — field 11, "///" when unavailable.
        if (/^\d{2,3}$/.test(c[10] || '')) p.sfmr = parseInt(c[10], 10);
        // Extrapolated surface pressure (0.1 hPa) — field 4 like "0074"/"9248".
        if (/^\d{4}$/.test(c[3] || '')) p.pres = parseInt(c[3], 10) / 10;
        obs.push(p);
    }
    return obs;
}

function loadRecon() {
    getText(RECON_DIR)
        .then((html) => {
            const files = (html.match(/AHONT1-KNHC\.\d+\.txt/g) || []);
            const uniq = [...new Set(files)].sort(); // filenames embed YYYYMMDDHHMM → lexical == chronological
            const latest = uniq.slice(-RECON_FILES_TO_LOAD);
            return Promise.all(latest.map((f) => getText(RECON_DIR + f).then(parseHdob).catch(() => [])));
        })
        .then((legs) => {
            const all = [].concat(...legs).filter((o) => o && isFinite(o.lat) && isFinite(o.lon));
            if (!all.length) { setReconData([], []); return; }
            const coords = all.map((o) => [o.lon, o.lat]);
            const line = coords.length >= 2 ? [turf.lineString(coords)] : [];
            const pts = all.map((o) => turf.point([o.lon, o.lat], {
                time: o.time, flDir: o.flDir, flSpd: o.flSpd, sfmr: o.sfmr, pres: o.pres,
            }));
            setReconData(line, pts);
        })
        .catch((err) => console.warn('[hunters] recon failed:', err));
}

function setReconData(lineFeats, ptFeats) {
    const ls = map.getSource(RECON_SRC + '_line'); if (ls) ls.setData(turf.featureCollection(lineFeats));
    const ps = map.getSource(RECON_PTS + '_src'); if (ps) ps.setData(turf.featureCollection(ptFeats));
}

// ── map layers ───────────────────────────────────────────────────────────────
function ensureLayers(done) {
    window.vortexData.hunter_layers = [
        PLANE_SRC, PLANE_LAYER, PLANE_LABEL,
        RECON_SRC + '_line', RECON_LINE, RECON_PTS + '_src', RECON_PTS,
    ];
    if (!map.getSource(RECON_SRC + '_line')) {
        map.addSource(RECON_SRC + '_line', { type: 'geojson', data: turf.featureCollection([]) });
        map.addLayer({
            id: RECON_LINE, type: 'line', source: RECON_SRC + '_line',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#ff8a00', 'line-width': 2.5, 'line-opacity': 0.9 },
        });
    }
    if (!map.getSource(RECON_PTS + '_src')) {
        map.addSource(RECON_PTS + '_src', { type: 'geojson', data: turf.featureCollection([]) });
        map.addLayer({
            id: RECON_PTS, type: 'circle', source: RECON_PTS + '_src',
            paint: { 'circle-radius': 2.6, 'circle-color': '#ffd23c', 'circle-stroke-color': '#7a4a00', 'circle-stroke-width': 0.6 },
        });
        map.on('click', RECON_PTS, reconPopup);
        map.on('mouseenter', RECON_PTS, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', RECON_PTS, () => { map.getCanvas().style.cursor = ''; });
    }
    if (!map.getSource(PLANE_SRC)) {
        map.addSource(PLANE_SRC, { type: 'geojson', data: turf.featureCollection([]) });
    }
    const addPlaneLayers = () => {
        if (!map.getLayer(PLANE_LAYER)) {
            map.addLayer({
                id: PLANE_LAYER, type: 'symbol', source: PLANE_SRC,
                layout: {
                    'icon-image': 'recon_plane', 'icon-size': 0.6, 'icon-allow-overlap': true,
                    'icon-rotate': ['get', 'track'], 'icon-rotation-alignment': 'map',
                },
            });
            map.addLayer({
                id: PLANE_LABEL, type: 'symbol', source: PLANE_SRC,
                layout: {
                    'text-field': ['get', 'callsign'], 'text-size': 11, 'text-offset': [0, 1.3],
                    'text-anchor': 'top', 'text-allow-overlap': true,
                },
                paint: { 'text-color': '#ffd23c', 'text-halo-color': '#0b1220', 'text-halo-width': 1.6 },
            });
            map.on('click', PLANE_LAYER, planePopup);
            map.on('mouseenter', PLANE_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', PLANE_LAYER, () => { map.getCanvas().style.cursor = ''; });
        }
        done();
    };
    if (_planeIconLoaded) { addPlaneLayers(); }
    else { icons.add_icon_svg([[PLANE_SVG, 'recon_plane']], () => { _planeIconLoaded = true; addPlaneLayers(); }); }
}

function planePopup(e) {
    const p = e.features[0].properties || {};
    const html = `<div style="font-family:'Onest',system-ui,sans-serif;min-width:150px">
        <div style="font-weight:800;font-size:14px">✈️ ${esc(p.callsign)}</div>
        ${p.type ? `<div style="font-size:11px;opacity:.7;margin-bottom:4px">${esc(p.type)}</div>` : ''}
        ${row('Altitude', p.alt != null && p.alt !== '' ? Number(p.alt).toLocaleString() + ' ft' : null)}
        ${row('Ground speed', p.gs != null ? Math.round(p.gs) + ' kt' : null)}
        ${row('Heading', p.track != null ? Math.round(p.track) + '°' : null)}
    </div>`;
    new mapboxgl.Popup({ className: 'alertPopup', maxWidth: '260px' }).setLngLat(e.lngLat).setHTML(html).addTo(map);
}
function reconPopup(e) {
    const p = e.features[0].properties || {};
    const t = p.time ? `${p.time.slice(0, 2)}:${p.time.slice(2, 4)}:${p.time.slice(4, 6)}Z` : '';
    const html = `<div style="font-family:'Onest',system-ui,sans-serif;min-width:150px">
        <div style="font-weight:800;font-size:14px">Recon ob ${esc(t)}</div>
        ${row('Flight-level wind', p.flDir != null ? `${p.flDir}° @ ${p.flSpd} kt` : null)}
        ${row('Surface wind (SFMR)', p.sfmr != null ? p.sfmr + ' kt' : null)}
        ${row('Pressure', p.pres != null ? p.pres + ' mb' : null)}
    </div>`;
    new mapboxgl.Popup({ className: 'alertPopup', maxWidth: '260px' }).setLngLat(e.lngLat).setHTML(html).addTo(map);
}
function row(label, val) {
    return val ? `<div style="display:flex;justify-content:space-between;gap:14px;font-size:12.5px;line-height:1.6"><span style="opacity:.75">${label}</span><b>${esc(val)}</b></div>` : '';
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function setVisible(v) {
    const vis = v ? 'visible' : 'none';
    for (const id of [PLANE_LAYER, PLANE_LABEL, RECON_LINE, RECON_PTS]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    }
}

// ── lifecycle ────────────────────────────────────────────────────────────────
function loadAll() { loadPlanes(); loadRecon(); }

function enable() {
    _enabled = true;
    ensureLayers(() => { setVisible(true); loadAll(); });
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(() => { if (_enabled) loadAll(); }, 60000);
}
function disable() {
    _enabled = false;
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    setVisible(false);
}

module.exports = { enable, disable };
