/*
 * nhc_active_overlay.js
 * Loads the NHC aggregate feed — https://www.nhc.noaa.gov/gis/kml/nhc.kmz —
 * which unzips to nhc_active.kml: a NetworkLink index of every active tropical
 * cyclone. For each storm it links to Past Track, Cone, Track Forecast and
 * Initial Wind Field KMZs and carries a block of live stats (name, max wind,
 * pressure, movement, headline).
 *
 * The existing pipeline (nhc_process_data / nhc_process_outlooks) already draws
 * the cone, the forecast track and the tropical-weather outlook areas. This
 * module adds the parts of the NHC feed that weren't on the map yet:
 *   - Past Track (the observed track line + prior fix points)
 *   - Initial Wind Field (34 / 50 / 64-kt wind extent polygons)
 *   - a labeled storm-center marker with the full advisory stats in a popup
 *
 * Everything is registered in window.vortexData.hurricane_layers so the existing
 * Hurricanes toggle shows/hides it with the rest.
 */

const ut = require('../../core/utils');
const map = require('../../core/map/map');
const turf = require('@turf/turf');
const kmz_to_geojson = require('../kmz_to_geojson');
const icons = require('../../core/map/icons/icons');

const NHC_KMZ_URL = 'https://www.nhc.noaa.gov/gis/kml/nhc.kmz';

// Saffir-Simpson-ish category icon for the current-position marker, from the
// advisory's max sustained wind (mph).
const HURRICANE_ICONS = [
    [icons.icons.hurricane_TD, 'hurricane_TD'], [icons.icons.hurricane_TS, 'hurricane_TS'],
    [icons.icons.hurricane_C1, 'hurricane_C1'], [icons.icons.hurricane_C2, 'hurricane_C2'],
    [icons.icons.hurricane_C3, 'hurricane_C3'], [icons.icons.hurricane_C4, 'hurricane_C4'],
    [icons.icons.hurricane_C5, 'hurricane_C5'], [icons.icons.hurricane_OTHER, 'hurricane_OTHER'],
];
function iconForMph(mph) {
    if (!isFinite(mph)) return 'hurricane_OTHER';
    if (mph < 39) return 'hurricane_TD';
    if (mph < 74) return 'hurricane_TS';
    if (mph < 96) return 'hurricane_C1';
    if (mph < 111) return 'hurricane_C2';
    if (mph < 130) return 'hurricane_C3';
    if (mph < 157) return 'hurricane_C4';
    return 'hurricane_C5';
}

// ── proxy fetch helpers ──────────────────────────────────────────────────────
function fetchBlob(url) {
    return fetch(ut.phpProxy + url, { headers: { 'Cache-Control': 'no-cache' } })
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url); return r.blob(); });
}
function blobToDom(blob) {
    return new Promise((resolve) => { blob.name = 'doc.kmz'; kmz_to_geojson(blob, (dom) => resolve(dom), true); });
}
function kmzUrlToGeojson(url) {
    return fetchBlob(url).then((blob) => new Promise((resolve) => {
        blob.name = url; kmz_to_geojson(blob, (gj) => resolve(gj));
    }));
}

// ── nhc_active.kml parsing ───────────────────────────────────────────────────
function _text(parent, tag) {
    const el = parent.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
}

// Read the <ExtendedData><Data name=".."><value>..</value> block into an object.
function readMeta(folder) {
    const meta = {};
    const datas = folder.getElementsByTagName('Data');
    for (let i = 0; i < datas.length; i++) {
        const name = datas[i].getAttribute('name');
        const val = datas[i].getElementsByTagName('value')[0];
        if (name && val) meta[name] = val.textContent.trim();
    }
    return meta;
}

// Map each child <NetworkLink id="..">'s href by id.
function readLinks(folder) {
    const links = {};
    const nls = folder.getElementsByTagName('NetworkLink');
    for (let i = 0; i < nls.length; i++) {
        const id = nls[i].getAttribute('id');
        const href = _text(nls[i], 'href');
        if (id && href) links[id] = href;
    }
    return links;
}

// A storm folder is one that links to a cone / past track / forecast track.
function parseStorms(dom) {
    const storms = [];
    const folders = dom.getElementsByTagName('Folder');
    for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        const links = readLinks(folder);
        if (!(links.cone || links.pasttrack || links.track)) continue; // skip e.g. the wind-probability folder
        const meta = readMeta(folder);
        storms.push({
            name: meta.tcName || meta.tcType || 'Storm',
            centerLat: parseFloat(meta.centerLat),
            centerLon: parseFloat(meta.centerLon),
            meta, links,
        });
    }
    return storms;
}

function tagFeatures(gj, product, storm) {
    if (!gj || !Array.isArray(gj.features)) return [];
    for (const f of gj.features) {
        f.properties = f.properties || {};
        f.properties._product = product;
        f.properties._storm = storm;
    }
    return gj.features;
}

// ── map rendering ────────────────────────────────────────────────────────────
const IDS = {
    windSrc: 'nhc_active_windfield_src', windFill: 'nhc_active_windfield_fill', windLine: 'nhc_active_windfield_outline',
    pastSrc: 'nhc_active_pasttrack_src', pastLine: 'nhc_active_pasttrack_line', pastPts: 'nhc_active_pasttrack_pts',
    ctrSrc: 'nhc_active_center_src', ctrDot: 'nhc_active_center_dot', ctrLabel: 'nhc_active_center_label',
};

function fc(features) { return { type: 'FeatureCollection', features: features || [] }; }

function registerLayer(id) {
    if (!window.vortexData.hurricane_layers.includes(id)) window.vortexData.hurricane_layers.push(id);
}

function addOrSet(srcId, features) {
    const existing = map.getSource(srcId);
    if (existing) { existing.setData(fc(features)); return false; }
    map.addSource(srcId, { type: 'geojson', data: fc(features) });
    registerLayer(srcId);
    return true;
}

function render(pastFeatures, windFeatures, centerFeatures) {
    // Initial wind field (draw first so it sits under the tracks).
    if (windFeatures.length) {
        if (addOrSet(IDS.windSrc, windFeatures)) {
            map.addLayer({
                id: IDS.windFill, type: 'fill', source: IDS.windSrc,
                paint: {
                    'fill-color': ['coalesce', ['get', 'fill'], '#39c37a'],
                    'fill-opacity': ['coalesce', ['get', 'fill-opacity'], 0.25],
                },
            });
            map.addLayer({
                id: IDS.windLine, type: 'line', source: IDS.windSrc,
                paint: { 'line-color': ['coalesce', ['get', 'stroke'], '#0a3d1f'], 'line-width': 1, 'line-opacity': 0.6 },
            });
            registerLayer(IDS.windFill); registerLayer(IDS.windLine);
        }
    }

    // Past track — line + prior fix points.
    if (pastFeatures.length) {
        if (addOrSet(IDS.pastSrc, pastFeatures)) {
            map.addLayer({
                id: IDS.pastLine, type: 'line', source: IDS.pastSrc,
                filter: ['==', ['geometry-type'], 'LineString'],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': ['coalesce', ['get', 'stroke'], '#9aa4b2'], 'line-width': 2, 'line-dasharray': [2, 1.4] },
            });
            map.addLayer({
                id: IDS.pastPts, type: 'circle', source: IDS.pastSrc,
                filter: ['==', ['geometry-type'], 'Point'],
                paint: { 'circle-radius': 3.2, 'circle-color': '#c9d3e4', 'circle-stroke-color': '#25324a', 'circle-stroke-width': 1 },
            });
            registerLayer(IDS.pastLine); registerLayer(IDS.pastPts);
        }
    }

    // Storm-center marker — the "actual storm": a Saffir-Simpson category icon at
    // the official NHC center, with the storm's name labeled beneath it.
    if (centerFeatures.length) {
        if (addOrSet(IDS.ctrSrc, centerFeatures)) {
            icons.add_icon_svg(HURRICANE_ICONS, () => {
                if (!map.getSource(IDS.ctrSrc)) return; // toggled off before icons finished loading
                if (!map.getLayer(IDS.ctrDot)) {
                    map.addLayer({
                        id: IDS.ctrDot, type: 'symbol', source: IDS.ctrSrc,
                        layout: {
                            'icon-image': ['coalesce', ['get', 'icon_abbv'], 'hurricane_OTHER'],
                            'icon-size': 0.18, 'icon-allow-overlap': true,
                        },
                    });
                }
                if (!map.getLayer(IDS.ctrLabel)) {
                    map.addLayer({
                        id: IDS.ctrLabel, type: 'symbol', source: IDS.ctrSrc,
                        layout: {
                            'text-field': ['upcase', ['coalesce', ['get', 'tcName'], ['get', 'name']]],
                            'text-size': 13, 'text-offset': [0, 1.7], 'text-anchor': 'top',
                            'text-allow-overlap': true,
                        },
                        paint: { 'text-color': '#ffffff', 'text-halo-color': '#0b1220', 'text-halo-width': 1.8 },
                    });
                }
                registerLayer(IDS.ctrDot); registerLayer(IDS.ctrLabel);
                bindCenterPopup();
            });
        }
    }
}

// ── popups ───────────────────────────────────────────────────────────────────
let _popupBound = false;
function bindCenterPopup() {
    if (_popupBound) return;
    _popupBound = true;

    const row = (label, val) => (val ? `<div style="display:flex;justify-content:space-between;gap:14px;font-size:13px;line-height:1.6"><span style="opacity:.75">${label}</span><b>${esc(val)}</b></div>` : '');

    map.on('click', IDS.ctrDot, (e) => {
        const p = e.features[0].properties || {};
        const html =
            `<div style="min-width:200px;font-family:'Onest',system-ui,sans-serif">
                <div style="font-weight:800;font-size:15px;margin-bottom:4px">${esc(p.tcType ? p.tcType + ' · ' : '')}${esc(p.tcName || 'Tropical Cyclone')}</div>
                ${p.dateTime ? `<div style="font-size:11.5px;opacity:.7;margin-bottom:6px">${esc(p.dateTime)}</div>` : ''}
                ${row('Max sustained wind', p.maxSustainedWind)}
                ${row('Min pressure', p.minimumPressure)}
                ${row('Movement', p.movement)}
                ${row('ATCF ID', p.atcfID)}
                ${p.headline ? `<div style="margin-top:8px;font-size:12.5px;font-style:italic;opacity:.9">${esc(p.headline)}</div>` : ''}
            </div>`;
        new mapboxgl.Popup({ className: 'alertPopup', maxWidth: '300px' })
            .setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on('mouseenter', IDS.ctrDot, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', IDS.ctrDot, () => { map.getCanvas().style.cursor = ''; });
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── entry ────────────────────────────────────────────────────────────────────
function nhc_active_overlay() {
    window.vortexData.hurricane_layers = window.vortexData.hurricane_layers || [];

    fetchBlob(NHC_KMZ_URL)
        .then(blobToDom)
        .then((dom) => {
            const storms = parseStorms(dom);
            if (!storms.length) return;

            const past = [], wind = [], centers = [];
            for (const s of storms) {
                if (isFinite(s.centerLat) && isFinite(s.centerLon)) {
                    const mph = parseInt(s.meta.maxSustainedWind, 10);
                    const props = Object.assign({ _kind: 'center', name: s.name, icon_abbv: iconForMph(mph) }, s.meta);
                    centers.push(turf.point([s.centerLon, s.centerLat], props));
                }
            }

            const jobs = [];
            for (const s of storms) {
                if (s.links.pasttrack) {
                    jobs.push(kmzUrlToGeojson(s.links.pasttrack)
                        .then((gj) => { past.push(...tagFeatures(gj, 'pasttrack', s.name)); })
                        .catch((err) => console.warn('[NHC] past track failed for', s.name, err)));
                }
                if (s.links.initialwindfield) {
                    jobs.push(kmzUrlToGeojson(s.links.initialwindfield)
                        .then((gj) => { wind.push(...tagFeatures(gj, 'windfield', s.name)); })
                        .catch((err) => console.warn('[NHC] wind field failed for', s.name, err)));
                }
            }

            Promise.all(jobs).then(() => render(past, wind, centers));
        })
        .catch((err) => console.warn('[NHC] active overlay failed:', err));
}

module.exports = nhc_active_overlay;
