/*
 * nhc_spaghetti.js
 * "Spaghetti models" — the individual model track guidance for each active
 * tropical cyclone, drawn as a tangle of colored lines. Data comes from NHC's
 * ATCF public aid decks (a-decks):
 *     https://ftp.nhc.noaa.gov/atcf/aid_public/a<atcfid>.dat.gz
 * Each row is one model's forecast position at a given lead time (tau). We keep
 * a curated set of the deterministic global/regional models plus the NHC
 * official track and the consensus, take each model's latest run, and plot a
 * line per model.
 *
 * Controlled by its own menu toggle (see spaghetti_menu_item.js). Layers are
 * tracked on window.atticData.spaghetti_layers.
 */

const ut = require('../../core/utils');
const map = require('../../core/map/map');
const turf = require('@turf/turf');
const pako = require('pako');

const CURRENT_STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const ADECK_BASE = 'https://ftp.nhc.noaa.gov/atcf/aid_public/';

const SRC = 'nhc_spaghetti_src';
const LINE_LAYER = 'nhc_spaghetti_lines';
const LABEL_LAYER = 'nhc_spaghetti_labels';

// Curated models: ATCF tech id -> display label, color, line width.
// (ECMWF/EMX is withheld from the public a-decks, so it isn't listed.)
const MODELS = {
    OFCL: { label: 'NHC', color: '#ffffff', width: 4 },
    TVCN: { label: 'Consensus', color: '#c9d3e6', width: 3 },
    AVNO: { label: 'GFS', color: '#38bdf8', width: 2 },
    UKX:  { label: 'UKMET', color: '#f87171', width: 2 },
    CMC:  { label: 'CMC', color: '#4ade80', width: 2 },
    NGX:  { label: 'NAVGEM', color: '#facc15', width: 2 },
    HWRF: { label: 'HWRF', color: '#fb923c', width: 2 },
    HMON: { label: 'HMON', color: '#c084fc', width: 2 },
    HFSA: { label: 'HAFS-A', color: '#2dd4bf', width: 2 },
    HFSB: { label: 'HAFS-B', color: '#f472b6', width: 2 },
};

let _state = 'empty'; // 'empty' | 'loading' | 'loaded'

// ── ATCF parsing ─────────────────────────────────────────────────────────────
// "269N" -> 26.9 ; "840W" -> -84.0
function parseDeg(raw) {
    const m = /^(\d+)([NSEW])$/.exec(raw);
    if (!m) return null;
    let v = parseInt(m[1], 10) / 10;
    if (m[2] === 'S' || m[2] === 'W') v = -v;
    return v;
}

// Build a lineString per curated model from one storm's a-deck text.
function parseADeck(text, stormName) {
    // model -> { init -> Map(tau -> [lon,lat]) }
    const byModel = {};
    const lines = text.split('\n');
    for (const line of lines) {
        if (!line) continue;
        const c = line.split(',');
        if (c.length < 8) continue;
        const tech = c[4].trim();
        if (!MODELS[tech]) continue;
        const init = c[2].trim();
        const tau = parseInt(c[5], 10);
        if (!isFinite(tau) || tau < 0 || tau > 168) continue;
        const lat = parseDeg(c[6].trim());
        const lon = parseDeg(c[7].trim());
        if (lat == null || lon == null || (lat === 0 && lon === 0)) continue;

        byModel[tech] = byModel[tech] || {};
        byModel[tech][init] = byModel[tech][init] || new Map();
        // a-deck repeats each tau for 34/50/64-kt wind radii — keep the first.
        if (!byModel[tech][init].has(tau)) byModel[tech][init].set(tau, [lon, lat]);
    }

    const features = [];
    for (const tech of Object.keys(byModel)) {
        // Use this model's most recent run.
        const inits = Object.keys(byModel[tech]).sort();
        const latest = inits[inits.length - 1];
        const taus = [...byModel[tech][latest].keys()].sort((a, b) => a - b);
        const coords = taus.map((t) => byModel[tech][latest].get(t));
        if (coords.length < 2) continue;
        const m = MODELS[tech];
        features.push(turf.lineString(coords, {
            model: tech, label: m.label, color: m.color, width: m.width, storm: stormName,
        }));
    }
    return features;
}

// ── fetch ────────────────────────────────────────────────────────────────────
function fetchJson(url) {
    return fetch(ut.phpProxy + url, { headers: { 'Cache-Control': 'no-cache' } }).then((r) => r.json());
}
function fetchADeckText(atcfId) {
    const url = `${ADECK_BASE}a${atcfId.toLowerCase()}.dat.gz`;
    return fetch(ut.phpProxy + url, { headers: { 'Cache-Control': 'no-cache' } })
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then((buf) => pako.ungzip(new Uint8Array(buf), { to: 'string' }));
}

// ── render ───────────────────────────────────────────────────────────────────
function addLayers(features) {
    window.atticData.spaghetti_layers = [SRC, LINE_LAYER, LABEL_LAYER];
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
        id: LINE_LAYER, type: 'line', source: SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.85 },
    });
    map.addLayer({
        id: LABEL_LAYER, type: 'symbol', source: SRC,
        layout: {
            'text-field': ['get', 'label'], 'text-size': 10,
            'symbol-placement': 'line-center', 'text-allow-overlap': false,
        },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#0b1220', 'text-halo-width': 1.4 },
    });
}

function setVisible(visible) {
    const v = visible ? 'visible' : 'none';
    for (const id of [LINE_LAYER, LABEL_LAYER]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
    }
}

function load() {
    _state = 'loading';
    fetchJson(CURRENT_STORMS_URL)
        .then((json) => {
            const storms = (json && json.activeStorms) || [];
            if (!storms.length) { _state = 'empty'; return; }
            return Promise.all(storms.map((s) =>
                fetchADeckText(s.id)
                    .then((text) => parseADeck(text, s.name || s.id))
                    .catch((err) => { console.warn('[spaghetti] a-deck failed for', s.id, err); return []; })
            )).then((groups) => {
                const features = [].concat(...groups);
                if (!features.length) { _state = 'empty'; return; }
                addLayers(features);
                _state = 'loaded';
            });
        })
        .catch((err) => { console.warn('[spaghetti] load failed:', err); _state = 'empty'; });
}

function enable() {
    window.atticData.spaghetti_layers = window.atticData.spaghetti_layers || [];
    if (_state === 'loaded' && map.getSource(SRC)) { setVisible(true); return; }
    if (_state !== 'loading') load();
}

function disable() {
    setVisible(false);
}

module.exports = { enable, disable };
