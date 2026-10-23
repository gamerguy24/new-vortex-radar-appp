/*
 * embed/embed_app.js — the public, embeddable Echo Radar map.
 *
 * THE SAME RADAR AS THE APP. Zoomed in, it shows one WSR-88D's super-res
 * Level 2 — the data the app's radar page plots — decoded in the visitor's
 * browser by the app's own decoder (embed/radar_worker.js). It picks the radar
 * nearest the middle of the map and follows as you pan, or stays on the one in
 * `site=`. Zoomed out to the whole country, one radar is a dot, so it shows the
 * NOAA MRMS national mosaic built from all of them.
 *
 * Everything is public data the browser fetches itself:
 *   Level 2   unidata-nexrad-level2 on AWS (lists + downloads with CORS open)
 *   mosaic    noaa-mrms-pds on AWS, via the app's MRMS layer (components/mrms.js)
 *   warnings  api.weather.gov, polygons only
 * The Echo Radar server hands out static files and nothing else. The base map
 * is Mapbox (the app's token, which counts map loads to that account), painted
 * with the app's own palette (components/basemap_palette.json) so it looks like
 * the radar page. The radar site pills are the app's too (broadcast/site_markers.js):
 * tap one to show that radar. TDWR pills are left off: they publish Level 3
 * only, which this decoder does not read.
 *
 * URL settings (all optional), e.g. /embed?lat=33.75&lon=-84.39&zoom=7
 *   lat, lon     map centre                          (default: the lower 48)
 *   zoom         0-12                                (default 3.6)
 *   site         a radar id, e.g. KFFC: always show this radar
 *   product      reflectivity | velocity             (default reflectivity)
 *   style        dark | light | satellite            (default dark)
 *   warnings     1 | 0   NWS warning polygons        (default 1)
 *   legend       1 | 0   colour scale, radar + time  (default 1)
 *   controls     1 | 0   zoom buttons                (default 1)
 *   interactive  1 | 0   pan / zoom allowed          (default 1)
 */
import { addMRMS, removeMRMS, getMRMSFrameTime, paintMRMSView, getMRMSBaseDegPerPx } from '/components/mrms.js?v=embed3';
import Palettes from '/components/palettes.js';
import { addSiteMarkers, fetchSiteStatus, setSiteMarkerStatus, keepSiteMarkersOnTop, siteMarkersLayerId } from '/broadcast/site_markers.js?v=embed1';

const MAPBOX_TOKEN = 'pk.eyJ1IjoiZGF2aWR3YWxsaXMwMCIsImEiOiJjbHlpNHJvZ2QwYzduMmpvZmdjejlkYjAxIn0.JNNcliJC4EFmok7iT5I6MQ';
const STYLES = {
    dark: 'mapbox://styles/mapbox/dark-v11',
    light: 'mapbox://styles/mapbox/light-v11',
    satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
};
const ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert,update';
const ALERTS_EVERY_MS = 60 * 1000;
// Below this zoom a single radar covers too little of the view to be the
// picture: show the national mosaic. At or above it, the nearest radar.
const SITE_ZOOM = 5.5;
const SCAN_CHECK_MS = 60 * 1000;     // look for a newer volume (radars scan every 2-6 min)
const SITE_RANGE_KM = 230;           // beyond this from the centre, the nearest site takes over
// Two pictures of the same data, so no view ever shows the edge of a patch
// and none is blurry:
//   cover   everything: the radar's whole range (or the whole national
//           mosaic), drawn once per scan; it sits under every pan and zoom-out
//   detail  just the view (plus a margin) at the screen's own pixel density,
//           drawn after the map stops whenever the screen is finer than the
//           cover; shown only while it covers the whole screen
// Only one is visible at a time: stacked, their opacities would add up.
const COVER_PX = 2400;               // single-radar cover width
const DETAIL_PAD = 0.15;             // margin around the view, as a fraction of it
const DETAIL_MAX_PX = 4096;          // longest side of a sharp picture
const SHARPER = 1.15;                // draw one once the screen is this much finer than the cover
const MRMS_IDLE_MS = 3 * 60 * 1000;  // drop the hidden mosaic after this long zoomed in
const MIN_DBZ = 10;                   // below this is clear-air haze around the radar

// Standard NWS warning colours (data colour, not themed).
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
const PRIORITY = ['Flood Warning', 'Flash Flood Warning', 'Severe Thunderstorm Warning', 'Tornado Warning'];

// ── settings from the URL ──
const q = new URLSearchParams(location.search);
const num = (k, d, lo, hi) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const flag = (k, d) => (q.has(k) ? !/^(0|false|no|off)$/i.test(q.get(k)) : d);
const pinnedSite = /^[A-Za-z]{4}$/.test(q.get('site') || '') ? q.get('site').toUpperCase() : null;
const opts = {
    lat: num('lat', 38.5, -85, 85),
    lon: num('lon', -96.5, -180, 180),
    zoom: num('zoom', pinnedSite ? 7 : 3.6, 0, 12),
    style: STYLES[String(q.get('style') || '').toLowerCase()] ? String(q.get('style')).toLowerCase() : 'dark',
    product: /^vel/i.test(q.get('product') || '') ? 'velocity' : 'reflectivity',
    warnings: flag('warnings', true),
    legend: flag('legend', true),
    controls: flag('controls', true),
    interactive: flag('interactive', true),
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function showMsg(text) { const m = $('erx-msg'); m.textContent = text || ''; m.hidden = !text; }
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

// ── map ──
// No mapboxgl.supported() gate: it is stricter than the map itself and says
// "no" on phones that draw the map fine (the app has no such check). Just try
// to make the map; Mapbox throws if WebGL really is unavailable.
const NO_MAP_MSG = 'This browser cannot show the radar map (WebGL is off or unsupported).';
if (!window.mapboxgl) {
    showMsg('The radar map could not load. Check your connection and reload.');
    throw new Error('mapbox-gl did not load');
}
mapboxgl.accessToken = MAPBOX_TOKEN;
let map;
try {
    map = new mapboxgl.Map({
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
} catch (e) {
    showMsg(NO_MAP_MSG);
    throw e;
}
map.touchZoomRotate && map.touchZoomRotate.disableRotation();
map.addControl(new mapboxgl.AttributionControl({ compact: true, customAttribution: 'Radar: NOAA NEXRAD / MRMS · Warnings: NWS' }), 'bottom-right');
if (opts.controls && opts.interactive) map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
map.on('error', (e) => { if (e && e.error && /401|403|token/i.test(String(e.error.message || e.error.status || ''))) showMsg('The base map could not load.'); });

// Layer order, bottom to top: radar images, then warnings, then site markers.
// MRMS slots itself in below a layer called 'radar-webgl'; this empty one
// sits under the warnings so the mosaic lands there too.
function addRadarSlot() {
    if (map.getLayer('radar-webgl')) return;
    map.addSource('erx-empty', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'radar-webgl', type: 'line', source: 'erx-empty' });
}

// ── legend ──
let mode = null;    // 'site' | 'national'
function legendFor(nowMode) {
    if (!opts.legend) return;
    const vel = nowMode === 'site' && opts.product === 'velocity';
    let stops;
    if (vel) {
        // The worker sends the rasteriser's own velocity colours with each scan.
        const ps = site.meta && site.meta.legend;
        stops = ps ? ps.stops.map((p, i) => `${p.css} ${((i / (ps.stops.length - 1)) * 100).toFixed(1)}%`) : ['#444 0%', '#444 100%'];
        $('erx-ticks').innerHTML = '<span>Toward</span><span>0</span><span>Away</span><span>m/s</span>';
    } else {
        const ref = new Palettes().getPalette('REF');
        const lo = ref[0], hi = ref[ref.length - 2];
        stops = [];
        for (let i = 0; i < ref.length; i += 2) stops.push(`${ref[i + 1]} ${(((ref[i] - lo) / (hi - lo)) * 100).toFixed(1)}%`);
        $('erx-ticks').innerHTML = '<span>5</span><span>20</span><span>35</span><span>50</span><span>65</span><span>dBZ</span>';
    }
    $('erx-ramp').style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    $('erx-legend').hidden = false;
}
function setLegendText(title, time) {
    if (!opts.legend) return;
    $('erx-title').textContent = title;
    $('erx-time').textContent = time || '';
}

// ── national mosaic (zoomed out) ──
// The whole mosaic is painted once per frame (wholeGrid), not per view, so
// zooming out never shows a screen-sized patch. Zooming in only HIDES it, so
// coming back out is instant; it is dropped after a few minutes zoomed in.
const MRMS_LAYER = 'mrms-img-layer';   // components/mrms.js
const NDETAIL = { src: 'erx-mrms-sharp', layer: 'erx-mrms-sharp-layer', opacity: 0.7 };   // mrms.js's opacity
let mrmsOn = false, mrmsIdle = null;
let nationalShown = false;
let ndetail = null;      // { west, north, east, south } of the sharp mosaic picture
let nDrawing = 0;
function setVisible(layer, on) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
}
function syncNationalLayers() {
    const useDetail = nationalShown && coversView(ndetail);
    setVisible(NDETAIL.layer, useDetail);
    setVisible(MRMS_LAYER, nationalShown && !useDetail);
}
async function showNational() {
    clearTimeout(mrmsIdle); mrmsIdle = null;
    nationalShown = true;
    syncNationalLayers();
    if (!mrmsOn) {
        mrmsOn = true;
        try { await addMRMS({ map, wholeGrid: true }); }   // paints, then refreshes itself every 2 minutes
        catch (e) { console.warn('[embed] mosaic unavailable:', e); }
        if (mode !== 'national' && cover) { hideNational(); return; }   // zoomed in while it loaded
        syncNationalLayers();
    }
    if (mode !== 'national') return;
    const iso = getMRMSFrameTime();
    setLegendText('National radar', iso ? fmtTime(Date.parse(iso)) : 'Loading…');
}
function hideNational() {
    if (!mrmsOn) return;
    nationalShown = false;
    syncNationalLayers();
    clearTimeout(mrmsIdle);
    mrmsIdle = setTimeout(() => {
        if (mode !== 'national' && mrmsOn) { mrmsOn = false; removeMRMS(); dropImages(NDETAIL); ndetail = null; }
    }, MRMS_IDLE_MS);
}
// The whole mosaic is drawn coarser than the screen once zoomed in a little:
// lay a picture of just the view over it, at the screen's density.
async function drawNationalDetail() {
    if (mode !== 'national' || !mrmsOn) return;
    const token = ++nDrawing;
    const base = getMRMSBaseDegPerPx();
    const v = base && screenDegPerPx() * SHARPER < base ? sharpView({ west: -180, east: 180, north: 85, south: -85 }) : null;
    const r = v && paintMRMSView(v, v.width);
    if (!r) { ndetail = null; syncNationalLayers(); return; }
    const blob = await new Promise((res) => r.canvas.toBlob(res, 'image/png'));
    if (token !== nDrawing || mode !== 'national' || !blob) return;
    setImage(NDETAIL, blob, r);
    ndetail = r;
    syncNationalLayers();
}

// ── single-site Level 2 (zoomed in) ──
let sites = [];              // [{ id, name, lat, lon }]
let site = { id: null, meta: null };
let worker = null, nextId = 1;
const pending = new Map();

function getWorker() {
    if (worker) return worker;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
    worker = new Worker('/embed/radar_worker.js?v=embed4', { type: 'module' });
    worker.onmessage = (e) => { const { id, result } = e.data || {}; const r = pending.get(id); if (r) { pending.delete(id); r(result); } };
    worker.onerror = () => { for (const r of pending.values()) r({ ok: false, reason: 'radar worker stopped' }); pending.clear(); worker = null; };
    return worker;
}
function ask(type, payload) {
    const w = getWorker();
    if (!w) return Promise.resolve({ ok: false, reason: 'this browser cannot decode radar in the background' });
    return new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); w.postMessage({ id, type, payload }); });
}

const distKm = (a, b) => {
    const R = 6371, d2r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * d2r, dLon = (b.lon - a.lon) * d2r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};
function nearestSite(c) {
    let best = null, bestD = Infinity;
    for (const s of sites) { const d = distKm(c, s); if (d < bestD) { bestD = d; best = s; } }
    return best ? { ...best, km: bestD } : null;
}
const COVER = { src: 'erx-cover', layer: 'erx-cover-layer' };
const DETAIL = { src: 'erx-site', layer: 'erx-site-layer' };
let cover = null;    // { box } on the map: the radar's whole range
let detail = null;   // { west, north, east, south } on the map: the last sharp view
const objectUrls = {};
function setImage(which, blob, b) {
    const url = URL.createObjectURL(blob);
    const quad = [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]];
    const src = map.getSource(which.src);
    if (src) src.updateImage({ url, coordinates: quad });
    else {
        map.addSource(which.src, { type: 'image', url, coordinates: quad });
        // Cover under detail, both under the warnings.
        const before = which === COVER && map.getLayer(DETAIL.layer) ? DETAIL.layer : 'radar-webgl';
        map.addLayer({ id: which.layer, type: 'raster', source: which.src,
            paint: { 'raster-opacity': which.opacity || 0.85, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, before);
    }
    if (objectUrls[which.src]) URL.revokeObjectURL(objectUrls[which.src]);
    objectUrls[which.src] = url;
}
function dropImages(...which) {
    for (const w of which) {
        if (map.getLayer(w.layer)) map.removeLayer(w.layer);
        if (map.getSource(w.src)) map.removeSource(w.src);
        if (objectUrls[w.src]) { URL.revokeObjectURL(objectUrls[w.src]); delete objectUrls[w.src]; }
    }
}
function dropSiteImages() { dropImages(DETAIL, COVER); cover = null; detail = null; }

// Screen pixels are DEVICE pixels: a phone or a retina laptop has two or three
// per CSS pixel, and a picture drawn for CSS pixels looks soft on it.
const dpr = () => Math.min(3, window.devicePixelRatio || 1);
function screenDegPerPx() {
    const b = map.getBounds();
    return (b.getEast() - b.getWest()) / ((map.getContainer().clientWidth || 800) * dpr());
}
function coversView(b) {
    if (!b) return false;
    const v = map.getBounds();
    return v.getWest() >= b.west && v.getEast() <= b.east && v.getNorth() <= b.north && v.getSouth() >= b.south;
}
// The sharp picture while it fills the screen, the whole-range one otherwise.
function syncSiteLayers() {
    if (mode !== 'site') { setVisible(COVER.layer, false); setVisible(DETAIL.layer, false); return; }
    const useDetail = coversView(detail);
    setVisible(DETAIL.layer, useDetail);
    setVisible(COVER.layer, !useDetail);
}
// The view plus a margin, clipped to `box`, sized in device pixels; null if
// the view is off the box.
function sharpView(box) {
    const el = map.getContainer();
    const w = el.clientWidth || 800, h = el.clientHeight || 500;
    const nw = map.unproject([-w * DETAIL_PAD, -h * DETAIL_PAD]);
    const se = map.unproject([w * (1 + DETAIL_PAD), h * (1 + DETAIL_PAD)]);
    const v = { west: Math.max(nw.lng, box.west), east: Math.min(se.lng, box.east), north: Math.min(nw.lat, box.north), south: Math.max(se.lat, box.south) };
    if (!(v.east > v.west) || !(v.north > v.south)) return null;
    const a = map.project([v.west, v.north]), c = map.project([v.east, v.south]);
    let pw = (c.x - a.x) * dpr(), ph = (c.y - a.y) * dpr();
    const k = Math.min(1, DETAIL_MAX_PX / Math.max(pw, ph));
    pw = Math.max(2, Math.round(pw * k)); ph = Math.max(2, Math.round(ph * k));
    return { ...v, width: pw, height: ph };
}
function siteLegend() {
    const s = sites.find((x) => x.id === site.id);
    const label = `${site.id}${s && s.name ? ' ' + s.name : ''} · ${opts.product === 'velocity' ? 'Velocity' : 'Reflectivity'}`;
    setLegendText(label, site.meta && site.meta.scanTime ? fmtTime(site.meta.scanTime) : 'Loading…');
}

let drawing = 0;
async function drawDetail() {
    if (mode !== 'site' || !site.meta || !cover) return;
    const token = ++drawing;
    const coverDegPerPx = (cover.box.east - cover.box.west) / COVER_PX;
    const v = screenDegPerPx() * SHARPER < coverDegPerPx ? sharpView(cover.box) : null;
    if (!v) { detail = null; syncSiteLayers(); return; }
    const r = await ask('draw', { view: { ...v, quality: DETAIL_MAX_PX, minDbz: MIN_DBZ } });
    if (token !== drawing || mode !== 'site') return;
    if (r && r.ok && r.blob) { setImage(DETAIL, r.blob, v); detail = v; }
    syncSiteLayers();
}
// A new scan or a new radar: the whole range first, then the sharp view.
async function paintSite() {
    const id = site.id;
    const r = await ask('cover', { width: COVER_PX, minDbz: MIN_DBZ });
    if (site.id !== id || !r || !r.ok || !r.blob) return;
    setImage(COVER, r.blob, r.box);
    cover = { box: r.box };
    if (mode === 'site') hideNational();   // the mosaic stayed up until now, so no blank gap
    syncSiteLayers();
    await drawDetail();
}
let loading = false;
async function loadSite(id, { force = false } = {}) {
    if (loading && !force) return;
    loading = true;
    try {
        const changingSite = id !== site.id;
        site.id = id;
        if (changingSite) { site.meta = null; siteLegend(); setActiveMarker(); }
        const r = await ask('load', { site: id, product: opts.product });
        if (site.id !== id) return;          // switched again while loading
        if (!r || !r.ok) {
            console.warn('[embed] radar', id, 'unavailable:', r && r.reason);
            if (!site.meta) {
                setLegendText(`${id} · no recent scan`, '');
                // Not another radar's picture in its place: the mosaic, if loaded.
                dropSiteImages();
                if (mode === 'site' && mrmsOn) { clearTimeout(mrmsIdle); nationalShown = true; syncNationalLayers(); }
            }
            return;
        }
        site.meta = r.meta;
        if (opts.product === 'velocity') legendFor('site');
        siteLegend();
        if (r.changed || changingSite || !cover) await paintSite();
    } finally { loading = false; }
}

// The radar to show for the current view: the pinned one, or the nearest.
function wantedSite() {
    if (userSite) return userSite;
    if (pinnedSite) return pinnedSite;
    const c = map.getCenter();
    const n = nearestSite({ lat: c.lat, lon: c.lng });
    if (!n) return null;
    // Keep the current radar while the centre is still well inside its range.
    if (site.id && site.id !== n.id) {
        const cur = sites.find((s) => s.id === site.id);
        if (cur && distKm({ lat: c.lat, lon: c.lng }, cur) < Math.min(SITE_RANGE_KM, n.km + 60)) return site.id;
    }
    return n.id;
}

async function update() {
    const zoomedIn = pinnedSite || map.getZoom() >= SITE_ZOOM;
    if (zoomedIn) {
        // The mosaic stays up until this radar has a picture (paintSite).
        if (mode !== 'site') { mode = 'site'; legendFor('site'); if (site.id) siteLegend(); }
        const want = wantedSite();
        if (!want) return;
        if (want !== site.id || !site.meta) await loadSite(want);
        else { if (cover) hideNational(); syncSiteLayers(); await drawDetail(); }
    } else {
        // The radar picture stays up until the mosaic has painted.
        if (mode !== 'national') { mode = 'national'; legendFor('national'); }
        await showNational();
        if (mode === 'national') { syncSiteLayers(); await drawNationalDetail(); }
    }
}

// ── radar site pills (the app's): tap one to show that radar ──
let siteTable = {};   // id -> { lat, lon, name, type } for the pills
async function addPills() {
    await addSiteMarkers(map, siteTable, {});
    const layer = siteMarkersLayerId();
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    map.on('click', layer, (e) => {
        const f = e.features && e.features[0];
        const id = f && f.properties && f.properties.station_id;
        if (!id || !siteTable[id]) return;
        userSite = id;
        if (map.getZoom() < SITE_ZOOM) map.easeTo({ center: [siteTable[id].lon, siteTable[id].lat], zoom: 7 });
        else if (mode !== 'site') update();
        else loadSite(id, { force: true });
    });
    // Down radars turn red, as on the radar page.
    const recolour = async () => setSiteMarkerStatus(map, siteTable, await fetchSiteStatus());
    recolour();
    setInterval(recolour, 5 * 60 * 1000);
}
function setActiveMarker() { keepSiteMarkersOnTop(map); }
let userSite = null;   // a site the viewer tapped: kept until they pan away from it

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
        if (map.getLayer(siteMarkersLayerId()) && map.queryRenderedFeatures(e.point, { layers: [siteMarkersLayerId()] }).length) return;
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

// ── the app's basemap colours ──
// Same palette file and the same rules as app/core/map/vortex_basemap.js (via
// the broadcast's copy of them), so the embed looks like the radar page.
async function paintBasemap() {
    let P;
    try { P = await (await fetch('/components/basemap_palette.json')).json(); } catch (e) { return; }
    const set = (id, prop, val) => { try { if (val != null && map.getLayer(id)) map.setPaintProperty(id, prop, val); } catch (e) {} };
    const isCasing = (id) => /(^|[-_])case($|[-_])|casing/i.test(id);
    const isMajorRoad = (id) => /motorway|trunk|highway/i.test(id);
    let layers = [];
    try { layers = (map.getStyle() && map.getStyle().layers) || []; } catch (e) { return; }
    for (const l of layers) {
        const id = l.id || '';
        if (l.type === 'background') { set(id, 'background-color', P.land); continue; }
        if (l.source !== 'composite') continue;    // only the basemap's own layers
        if (l.type === 'fill') {
            if (/water|ocean|sea|bathymetry/i.test(id)) set(id, 'fill-color', P.water);
            else if (/park|grass|wood|forest|green|pitch|cemetery/i.test(id)) set(id, 'fill-color', P.national_park);
            else if (/building/i.test(id)) set(id, 'fill-color', P.building);
            else if (/land|aeroway|sand|snow/i.test(id)) set(id, 'fill-color', P.landuse);
        } else if (l.type === 'fill-extrusion') set(id, 'fill-extrusion-color', P.building);
        else if (l.type === 'line') {
            if (/admin|boundary|border/i.test(id)) set(id, 'line-color', P.boundary);
            else if (/water|river|stream|canal/i.test(id)) set(id, 'line-color', P.waterway);
            else if (/road|street|bridge|tunnel|motorway|highway|transit|rail|path/i.test(id)) set(id, 'line-color', isCasing(id) ? P.road_casing : isMajorRoad(id) ? P.road_major : P.road);
        } else if (l.type === 'symbol') {
            set(id, 'text-color', P.label_text);
            set(id, 'text-halo-color', P.label_halo);
            set(id, 'text-halo-width', 1.3);
        }
    }
}

// ── start ──
map.on('load', async () => {
    // The app's look is the default ('dark' = the app's map); light and
    // satellite stay Mapbox's own.
    if (opts.style === 'dark') await paintBasemap();
    addRadarSlot();
    if (opts.warnings) { addWarningLayers(); loadWarnings(); setInterval(loadWarnings, ALERTS_EVERY_MS); }
    try {
        const r = await fetch('/embed/radar-sites.json');
        const table = await r.json();
        sites = Object.entries(table)
            .filter(([id, s]) => /^[A-Z]{4}$/.test(id) && s && s.type === 'WSR-88D' && Number.isFinite(+s.lat) && Number.isFinite(+s.lon))
            .map(([id, s]) => ({ id, name: s.name || '', lat: +s.lat, lon: +s.lon }));
        for (const x of sites) siteTable[x.id] = { lat: x.lat, lon: x.lon, name: x.name, type: 'WSR-88D' };
    } catch (e) { console.warn('[embed] radar site list unavailable:', e.message); }
    if (sites.length) await addPills();
    // site= without lat/lon: open on that radar rather than the middle of the country.
    if (pinnedSite && siteTable[pinnedSite] && !(q.has('lat') && q.has('lon'))) {
        map.jumpTo({ center: [siteTable[pinnedSite].lon, siteTable[pinnedSite].lat] });
    }

    await update();
    // A tapped site wins until the view leaves its range; then back to nearest.
    let moveTimer = null;
    map.on('moveend', () => {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => {
            if (userSite) {
                const s = sites.find((x) => x.id === userSite);
                const c = map.getCenter();
                if (!s || distKm({ lat: c.lat, lon: c.lng }, s) > SITE_RANGE_KM) userSite = null;
            }
            if (userSite && mode === 'site' && map.getZoom() >= SITE_ZOOM) drawDetail();
            else update();
        }, 250);
    });
    // Mid-gesture: drop to the whole-range picture the moment the sharp one
    // stops covering the screen.
    map.on('move', () => { syncSiteLayers(); syncNationalLayers(); });
    // Newer scans: the worker only re-downloads when the listing has moved on.
    setInterval(() => { if (mode === 'site' && site.id) loadSite(site.id); else if (mode === 'national') showNational(); }, SCAN_CHECK_MS);
    // Keep the mosaic's time current between refreshes.
    // A new mosaic frame also redraws the sharp picture of the view.
    let lastFrame = null;
    setInterval(() => {
        if (mode !== 'national') return;
        const iso = getMRMSFrameTime();
        if (iso) setLegendText('National radar', fmtTime(Date.parse(iso)));
        if (iso && iso !== lastFrame) { lastFrame = iso; drawNationalDetail(); }
    }, 20 * 1000);
});
