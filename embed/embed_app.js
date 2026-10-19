/*
 * embed/embed_app.js — the public, embeddable Echo Radar map.
 *
 * Everything here is public data fetched by the viewer's own browser:
 *   radar     NOAA MRMS national mosaic (noaa-mrms-pds on AWS), through the
 *             app's own MRMS layer (components/mrms.js) so it matches the app
 *   warnings  NWS active alerts from api.weather.gov, polygons only
 * The server only hands out these static files, so an embed on a busy site
 * costs the Echo Radar box next to nothing. The base map is Mapbox (the app's
 * token), which does count map loads against that Mapbox account.
 *
 * URL settings (all optional), e.g. /embed?lat=33.75&lon=-84.39&zoom=7
 *   lat, lon     map centre                    (default: the lower 48)
 *   zoom         0-12                          (default 3.6)
 *   style        dark | light | satellite      (default dark)
 *   warnings     1 | 0   NWS warning polygons  (default 1)
 *   legend       1 | 0   dBZ legend + time     (default 1)
 *   controls     1 | 0   zoom buttons          (default 1)
 *   interactive  1 | 0   pan / zoom allowed    (default 1)
 */
import { addMRMS, getMRMSFrameTime } from '/components/mrms.js?v=embed1';
import Palettes from '/components/palettes.js';

const MAPBOX_TOKEN = 'pk.eyJ1IjoiZGF2aWR3YWxsaXMwMCIsImEiOiJjbHlpNHJvZ2QwYzduMmpvZmdjejlkYjAxIn0.JNNcliJC4EFmok7iT5I6MQ';
const STYLES = {
    dark: 'mapbox://styles/mapbox/dark-v11',
    light: 'mapbox://styles/mapbox/light-v11',
    satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
};
const ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert,update';
const ALERTS_EVERY_MS = 60 * 1000;

// Standard NWS warning colours (data colour, not themed). Anything else that
// is a Warning gets the fallback.
const WARNING_COLORS = {
    'Tornado Warning': '#ff0000',
    'Severe Thunderstorm Warning': '#ffa500',
    'Flash Flood Warning': '#8b0000',
    'Flood Warning': '#00ff00',
    'Special Marine Warning': '#ffa500',
    'Snow Squall Warning': '#c71585',
    'Extreme Wind Warning': '#ff8c00',
    'Dust Storm Warning': '#ffe4c4',
    'Winter Storm Warning': '#ff69b4',
    'Blizzard Warning': '#ff4500',
    'Ice Storm Warning': '#8b008b',
    'Hurricane Warning': '#dc143c',
    'Tropical Storm Warning': '#b22222',
    'Storm Surge Warning': '#b524f7',
    'Coastal Flood Warning': '#228b22',
    'Fire Warning': '#a0522d',
};
const FALLBACK_COLOR = '#c0c0c0';
// Drawn last, so the most dangerous polygons sit on top.
const PRIORITY = ['Flood Warning', 'Flash Flood Warning', 'Severe Thunderstorm Warning', 'Tornado Warning'];

// ── settings from the URL ──
const q = new URLSearchParams(location.search);
const num = (k, d, lo, hi) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const flag = (k, d) => (q.has(k) ? !/^(0|false|no|off)$/i.test(q.get(k)) : d);
const opts = {
    lat: num('lat', 38.5, -85, 85),
    lon: num('lon', -96.5, -180, 180),
    zoom: num('zoom', 3.6, 0, 12),
    style: STYLES[String(q.get('style') || '').toLowerCase()] ? String(q.get('style')).toLowerCase() : 'dark',
    warnings: flag('warnings', true),
    legend: flag('legend', true),
    controls: flag('controls', true),
    interactive: flag('interactive', true),
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function showMsg(text) { const m = $('erx-msg'); m.textContent = text; m.hidden = !text; }

// ── map ──
if (!window.mapboxgl || !mapboxgl.supported || !mapboxgl.supported()) {
    showMsg('This browser cannot show the radar map (WebGL is off or unsupported).');
    throw new Error('mapbox-gl unsupported');
}
mapboxgl.accessToken = MAPBOX_TOKEN;
const map = new mapboxgl.Map({
    container: 'map',
    style: STYLES[opts.style],
    center: [opts.lon, opts.lat],
    zoom: opts.zoom,
    interactive: opts.interactive,
    attributionControl: false,
    projection: 'mercator',
    dragRotate: false,
    pitchWithRotate: false,
});
map.touchZoomRotate && map.touchZoomRotate.disableRotation();
map.addControl(new mapboxgl.AttributionControl({ compact: true, customAttribution: 'Radar: NOAA MRMS · Warnings: NWS' }), 'bottom-right');
if (opts.controls && opts.interactive) map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
map.on('error', (e) => { if (e && e.error && /401|403|token/i.test(String(e.error.message || e.error.status || ''))) showMsg('The base map could not load.'); });

// The MRMS layer slots itself in below a layer called 'radar-webgl' (the app's
// single-site radar). An empty placeholder by that name, added under the
// warnings, keeps the warnings drawn on top of the radar.
function addRadarSlot() {
    if (map.getLayer('radar-webgl')) return;
    map.addSource('erx-empty', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'radar-webgl', type: 'line', source: 'erx-empty' });
}

// ── legend ──
function buildLegend() {
    if (!opts.legend) return;
    const ref = new Palettes().getPalette('REF');
    const stops = [];
    const lo = ref[0], hi = ref[ref.length - 2];
    for (let i = 0; i < ref.length; i += 2) stops.push(`${ref[i + 1]} ${(((ref[i] - lo) / (hi - lo)) * 100).toFixed(1)}%`);
    $('erx-ramp').style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    $('erx-legend').hidden = false;
}
function updateTime() {
    if (!opts.legend) return;
    const iso = getMRMSFrameTime();
    if (!iso) return;
    const t = new Date(iso);
    if (isNaN(t)) return;
    $('erx-time').textContent = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

// ── warnings ──
async function loadWarnings() {
    try {
        const r = await fetch(ALERTS_URL, { headers: { Accept: 'application/geo+json' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const features = (j.features || []).filter((f) => f.geometry && /Warning$/.test(f.properties && f.properties.event))
            .map((f) => {
                const p = f.properties;
                const rank = PRIORITY.indexOf(p.event);
                return { type: 'Feature', geometry: f.geometry, properties: {
                    event: p.event, area: p.areaDesc || '', ends: p.ends || p.expires || '',
                    color: WARNING_COLORS[p.event] || FALLBACK_COLOR, rank: rank < 0 ? -1 : rank,
                } };
            });
        const src = map.getSource('erx-warnings');
        if (src) src.setData({ type: 'FeatureCollection', features });
    } catch (e) {
        console.warn('[embed] warnings unavailable:', e.message);
    }
}

function addWarningLayers() {
    map.addSource('erx-warnings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'erx-warnings-fill', type: 'fill', source: 'erx-warnings',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 }, layout: { 'fill-sort-key': ['get', 'rank'] } });
    map.addLayer({ id: 'erx-warnings-halo', type: 'line', source: 'erx-warnings',
        paint: { 'line-color': '#000000', 'line-width': 4, 'line-opacity': 0.55 }, layout: { 'line-sort-key': ['get', 'rank'], 'line-join': 'round' } });
    map.addLayer({ id: 'erx-warnings-line', type: 'line', source: 'erx-warnings',
        paint: { 'line-color': ['get', 'color'], 'line-width': 2.2 }, layout: { 'line-sort-key': ['get', 'rank'], 'line-join': 'round' } });

    map.on('mouseenter', 'erx-warnings-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'erx-warnings-fill', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'erx-warnings-fill', (e) => {
        // Most severe first when polygons overlap.
        const f = (e.features || []).slice().sort((a, b) => (b.properties.rank || -1) - (a.properties.rank || -1))[0];
        if (!f) return;
        const p = f.properties;
        let until = '';
        if (p.ends) { const t = new Date(p.ends); if (!isNaN(t)) until = 'Until ' + t.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); }
        new mapboxgl.Popup({ className: 'erx-popup', maxWidth: '280px' })
            .setLngLat(e.lngLat)
            .setHTML(`<div class="erx-pop-ev"><span class="erx-pop-sw" style="background:${esc(p.color)}"></span>${esc(p.event)}</div>
                <div class="erx-pop-area">${esc(p.area)}</div>${until ? `<div class="erx-pop-when">${esc(until)}</div>` : ''}`)
            .addTo(map);
    });
}

map.on('load', async () => {
    addRadarSlot();
    if (opts.warnings) {
        addWarningLayers();
        loadWarnings();
        setInterval(loadWarnings, ALERTS_EVERY_MS);
    }
    buildLegend();
    try {
        await addMRMS({ map });      // paints, then refreshes itself every 2 minutes
    } catch (e) {
        console.warn('[embed] radar unavailable:', e);
        showMsg('Radar data is unavailable right now. It will try again shortly.');
    }
    updateTime();
    setInterval(updateTime, 30 * 1000);
});
