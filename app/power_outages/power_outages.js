/*
 * power_outages.js
 * County power-outage overlay from the free, open-CORS MassOutage API
 * (https://massoutage.com/api-docs). /live/map returns, per county FIPS, an
 * array [customers_out, fraction_out, incidents]. We shade each US county by how
 * many customers are out, using Mapbox feature-state joined to the bundled
 * county TopoJSON (served un-gated at /geo/counties-10m.json). Refreshes every
 * few minutes; click a county for details. No API key, no proxy needed.
 */

const map = require('../core/map/map');
const topojson = require('topojson-client');

const SRC = 'power-outages-src';
const FILL = 'power-outages-fill';
const LINE = 'power-outages-line';
const GEO_URL = '/geo/counties-10m.json';
const API_URL = 'https://massoutage.com/api/v1/live/map';
const REFRESH_MS = 3 * 60 * 1000;

// Severity buckets (customers out) → color. Shared by the paint step + legend.
const BUCKETS = [
    [1, '#7dd3fc', '1–49'],
    [50, '#fde047', '50–499'],
    [500, '#fb923c', '500–2k'],
    [2000, '#ef4444', '2k–10k'],
    [10000, '#b91c1c', '10k–50k'],
    [50000, '#7f1d1d', '50k+'],
];

let _enabled = false, _timer = null, _srcReady = false;
let _data = {};           // fips -> [out, frac, incidents] (latest)
let _prevIds = new Set(); // county ids currently flagged out (to clear on recovery)
let _popup = null;
let _clickBound = false;

function _beforeId() {
    for (const id of ['radar-webgl', 'baseReflectivity']) if (map.getLayer(id)) return id;
    return undefined;
}

async function ensureSource() {
    if (_srcReady && map.getSource(SRC)) return;
    const res = await fetch(GEO_URL);
    if (!res.ok) throw new Error('counties ' + res.status);
    const topo = await res.json();
    const fc = topojson.feature(topo, topo.objects.counties);
    for (const f of fc.features) {
        const fips = String(f.id).padStart(5, '0');
        f.id = Number(fips);            // numeric id for feature-state
        f.properties.fips = fips;
    }
    map.addSource(SRC, { type: 'geojson', data: fc });

    const colorStep = ['step', ['coalesce', ['feature-state', 'out'], 0], 'rgba(0,0,0,0)'];
    for (const [min, col] of BUCKETS) { colorStep.push(min, col); }

    map.addLayer({
        id: FILL, type: 'fill', source: SRC,
        paint: {
            'fill-color': colorStep,
            'fill-opacity': ['case', ['>', ['coalesce', ['feature-state', 'out'], 0], 0], 0.62, 0],
        },
    }, _beforeId());
    map.addLayer({
        id: LINE, type: 'line', source: SRC,
        paint: {
            'line-color': 'rgba(255,255,255,0.16)',
            'line-width': ['case', ['>', ['coalesce', ['feature-state', 'out'], 0], 0], 0.6, 0],
        },
    }, _beforeId());
    _srcReady = true;
    bindClicks();
}

function applyStates() {
    if (!_srcReady) return;
    const now = new Set();
    for (const [fips, arr] of Object.entries(_data)) {
        const id = Number(fips);
        map.setFeatureState({ source: SRC, id }, { out: arr[0] || 0, frac: arr[1] || 0 });
        now.add(id);
    }
    for (const id of _prevIds) if (!now.has(id)) map.setFeatureState({ source: SRC, id }, { out: 0, frac: 0 });
    _prevIds = now;
}

async function refresh() {
    try {
        const res = await fetch(API_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error('outages ' + res.status);
        const j = await res.json();
        _data = (j.data && j.data.counties) || {};
        await ensureSource();
        applyStates();
    } catch (e) {
        console.warn('[outages] refresh failed:', e.message || e);
    }
}

function bindClicks() {
    if (_clickBound) return;
    _clickBound = true;
    map.on('click', FILL, (e) => {
        if (!_enabled || !e.features || !e.features.length) return;
        const f = e.features[0];
        const fips = f.properties.fips;
        const arr = _data[fips];
        if (!arr || !arr[0]) return;
        const name = f.properties.name || 'County';
        const out = arr[0].toLocaleString();
        const pct = arr[1] != null ? (arr[1] * 100).toFixed(arr[1] < 0.1 ? 1 : 0) + '%' : '—';
        const html = `<div style="font-family:'Onest',system-ui,sans-serif;color:#e7eef7;min-width:130px">
            <div style="font-weight:800;font-size:13px;margin-bottom:4px">${name}</div>
            <div style="font-size:12px;color:#ffb4a8"><b style="color:#fff">${out}</b> customers out</div>
            <div style="font-size:11px;color:#9fb2c9">${pct} of tracked</div></div>`;
        if (_popup) _popup.remove();
        _popup = new mapboxgl.Popup({ closeButton: true, className: 'outage-popup' })
            .setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on('mouseenter', FILL, () => { if (_enabled) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', FILL, () => { map.getCanvas().style.cursor = ''; });
}

// ── legend ────────────────────────────────────────────────────────────────────
function showLegend() {
    if (document.getElementById('outageLegend')) return;
    const el = document.createElement('div');
    el.id = 'outageLegend';
    el.style.cssText = `position:fixed;right:14px;bottom:78px;z-index:60;
        background:linear-gradient(180deg,rgba(17,25,42,.95),rgba(9,14,26,.95));
        border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:11px 13px;color:#eef4fb;
        font-family:'Onest',system-ui,sans-serif;box-shadow:0 14px 34px rgba(0,0,0,.5);
        -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);`;
    const rows = BUCKETS.map(([, col, lab]) =>
        `<div style="display:flex;align-items:center;gap:8px;font-size:11px;margin-top:4px">
            <span style="width:14px;height:10px;border-radius:3px;background:${col};box-shadow:0 0 0 1px rgba(255,255,255,.2)"></span>${lab}</div>`).join('');
    el.innerHTML = `<div style="font-size:12px;font-weight:800;margin-bottom:2px">Power Outages</div>
        <div style="font-size:10px;color:#8ea4bd;margin-bottom:4px">customers without power</div>${rows}`;
    document.body.appendChild(el);
}
function hideLegend() { const el = document.getElementById('outageLegend'); if (el) el.remove(); }

function enable() {
    _enabled = true;
    showLegend();
    refresh();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => { if (_enabled) refresh(); }, REFRESH_MS);
}

function disable() {
    _enabled = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
    hideLegend();
    if (_popup) { _popup.remove(); _popup = null; }
    if (map.getLayer(LINE)) map.removeLayer(LINE);
    if (map.getLayer(FILL)) map.removeLayer(FILL);
    if (map.getSource(SRC)) map.removeSource(SRC);
    _srcReady = false; _prevIds = new Set();
}

module.exports = { enable, disable };
