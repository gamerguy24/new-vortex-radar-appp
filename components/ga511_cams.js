/*
 * components/ga511_cams.js
 * State DOT traffic camera layers from 511 sites on the shared 511 platform.
 * Free layers.
 *
 *   GA 511 Traffic Cams   Georgia DOT, 511ga.org      (~4,300 cameras)
 *   NC 511 Traffic Cams   NCDOT, drivenc.gov          (~1,000 cameras)
 *
 * Thousands of cameras, so each is drawn as a clustered GeoJSON layer on the
 * GPU, not one DOM marker each (the BuoyCAMs approach would stall the map at
 * this count). Click a cluster to zoom into it; click a camera for its live
 * snapshot, which refreshes every minute while the popup is open.
 *
 * Camera lists come from /api/511cams/<region> (backend/ga511 — the keys stay
 * on the server). Snapshots load straight from the 511 site, which serves them
 * publicly with CORS open and a 60 s cache.
 */

const REGIONS = {
  ga: { label: 'GA 511 Traffic Cams', credit: 'Georgia 511 · GDOT', host: 'https://511ga.org', switchId: 'armrGa511CamsSwitchElem' },
  nc: { label: 'NC 511 Traffic Cams', credit: 'DriveNC · NCDOT', host: 'https://www.drivenc.gov', switchId: 'armrNc511CamsSwitchElem' },
};

const LIST_REFRESH_MS = 10 * 60 * 1000;   // matches the server cache
const IMG_REFRESH_MS = 60 * 1000;         // the 511 sites refresh snapshots about this often
const CAM_COLOR = '#3d9be9';               // data colour for these layers, not interface state

// One popup across all regions — opening a camera closes any other.
const popupState = { popup: null, imgTimer: null };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function injectStyles() {
  if (document.getElementById('ga511-styles')) return;
  const s = document.createElement('style');
  s.id = 'ga511-styles';
  s.textContent = `
.ga511-popup .maplibregl-popup-content, .ga511-popup .mapboxgl-popup-content {
  background: var(--vx-surface); color: var(--vx-text); border: 1px solid var(--vx-border, rgba(255,255,255,0.12));
  border-radius: var(--vx-r-3); padding: 10px; font-family: var(--vx-font);
}
.ga511-pop { width: min(460px, 78vw); display: flex; flex-direction: column; gap: 6px; }
.ga511-pop-title { font-weight: 700; font-size: 0.95em; line-height: 1.25; padding-right: 18px; }
.ga511-pop-sub { font-size: 0.8em; color: var(--vx-text-2); }
.ga511-pop-img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #000; border-radius: var(--vx-r-2); display: block; }
.ga511-pop-foot { display: flex; justify-content: space-between; align-items: center; font-size: 0.75em; color: var(--vx-text-2); font-variant-numeric: tabular-nums; }`;
  document.head.appendChild(s);
}

// Per-region layer ids, handlers and timers.
const layers = {};
function layerFor(region) {
  if (layers[region]) return layers[region];
  const cfg = REGIONS[region];
  const L = {
    region, cfg,
    SRC: `vx-${region}511-src`, CLUSTER: `vx-${region}511-cluster`, COUNT: `vx-${region}511-count`, CAM: `vx-${region}511-cam`,
    map: null, listTimer: null, loaded: false,
  };
  L.ids = [L.COUNT, L.CLUSTER, L.CAM];
  L.onClusterClick = (e) => clusterClick(L, e);
  L.onCamClick = (e) => camClick(L, e);
  layers[region] = L;
  return L;
}

async function addRegion(region, w) {
  const L = layerFor(region);
  const map = w.map;
  if (map.getSource(L.SRC)) return;
  injectStyles();
  L.map = map;

  map.addSource(L.SRC, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterRadius: 42,
    clusterMaxZoom: 11,
  });
  map.addLayer({
    id: L.CLUSTER, type: 'circle', source: L.SRC, filter: ['has', 'point_count'],
    paint: {
      'circle-color': CAM_COLOR,
      'circle-opacity': 0.85,
      'circle-radius': ['step', ['get', 'point_count'], 12, 25, 16, 100, 21, 400, 26],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': 'rgba(255,255,255,0.9)',
    },
  });
  map.addLayer({
    id: L.COUNT, type: 'symbol', source: L.SRC, filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: L.CAM, type: 'circle', source: L.SRC, filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': CAM_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.5, 12, 6.5],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
    },
  });

  map.on('click', L.CLUSTER, L.onClusterClick);
  map.on('click', L.CAM, L.onCamClick);
  for (const id of [L.CLUSTER, L.CAM]) {
    map.on('mouseenter', id, onEnter);
    map.on('mouseleave', id, onLeave);
  }

  await refresh(L);
  clearInterval(L.listTimer);
  L.listTimer = setInterval(() => refresh(L), LIST_REFRESH_MS);
}

function removeRegion(region, w) {
  const L = layerFor(region);
  const map = (w && w.map) || L.map;
  clearInterval(L.listTimer);
  L.listTimer = null;
  if (popupState.popup && popupState.region === region) closePopup();
  if (!map) return;
  map.off('click', L.CLUSTER, L.onClusterClick);
  map.off('click', L.CAM, L.onCamClick);
  for (const id of [L.CLUSTER, L.CAM]) { map.off('mouseenter', id, onEnter); map.off('mouseleave', id, onLeave); }
  for (const id of L.ids) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(L.SRC)) map.removeSource(L.SRC);
  map.getCanvas().style.cursor = '';
  L.map = null;
  L.loaded = false;
}

export const addGa511Cams = (w) => addRegion('ga', w);
export const removeGa511Cams = (w) => removeRegion('ga', w);
export const addNc511Cams = (w) => addRegion('nc', w);
export const removeNc511Cams = (w) => removeRegion('nc', w);

async function refresh(L) {
  try {
    const r = await fetch(`/api/511cams/${L.region}`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const src = L.map && L.map.getSource(L.SRC);
    if (src) { src.setData(j); L.loaded = true; }
  } catch (e) {
    console.warn(`[511] ${L.region} cameras unavailable:`, e.message);
    // A failed periodic refresh keeps the cameras already on the map; a
    // failed first load turns the switch back off so it does not lie.
    if (L.loaded) return;
    toast(`${L.cfg.label} unavailable: ${e.message}`);
    const sw = document.getElementById(L.cfg.switchId);
    if (sw) sw.checked = false;
    removeRegion(L.region);
  }
}

function onEnter(e) { e.target.getCanvas().style.cursor = 'pointer'; }
function onLeave(e) { e.target.getCanvas().style.cursor = ''; }

function clusterClick(L, e) {
  const map = e.target;
  const f = e.features && e.features[0];
  if (!f) return;
  const src = map.getSource(L.SRC);
  const centre = f.geometry.coordinates;
  const go = (zoom) => map.easeTo({ center: centre, zoom: Math.min(zoom, 16) });
  // MapLibre ≥3 returns a promise; Mapbox GL and older MapLibre use a callback.
  const p = src.getClusterExpansionZoom(f.properties.cluster_id, (err, zoom) => { if (!err) go(zoom); });
  if (p && typeof p.then === 'function') p.then(go).catch(() => {});
}

function camClick(L, e) {
  const f = e.features && e.features[0];
  if (!f) return;
  const p = f.properties;
  const gl = window.maplibregl || window.mapboxgl;
  closePopup();
  // NCDOT names cameras with internal codes ("CCTV10-I485-30.1O_I85"); lead
  // with the road and direction there and keep the code as the small print.
  const coded = p.n && !/\s/.test(p.n);
  const roadDir = [p.r, p.d].filter(Boolean).join(' ');
  const title = coded && roadDir ? roadDir : (p.n || roadDir || 'Traffic camera');
  const sub = [coded ? null : roadDir, p.c ? `${p.c} County` : null, coded ? p.n : null].filter(Boolean).join(' · ');
  const snap = () => `${L.cfg.host}/map/Cctv/${encodeURIComponent(p.v)}?t=${Date.now()}`;
  const now = () => 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const html = `<div class="ga511-pop">
      <div class="ga511-pop-title">${esc(title)}</div>
      ${sub ? `<div class="ga511-pop-sub">${esc(sub)}</div>` : ''}
      <img class="ga511-pop-img" id="ga511-img" src="${snap()}" alt="Traffic camera: ${esc(title)}">
      <div class="ga511-pop-foot"><span id="ga511-time">${now()}</span><span>${esc(L.cfg.credit)}</span></div>
    </div>`;
  popupState.region = L.region;
  popupState.popup = new gl.Popup({ closeButton: true, closeOnClick: true, className: 'ga511-popup', maxWidth: '500px', offset: 10 })
    .setLngLat(f.geometry.coordinates)
    .setHTML(html)
    .addTo(e.target);
  popupState.popup.on('close', stopImgRefresh);
  // Keep the snapshot live while it is open.
  popupState.imgTimer = setInterval(() => {
    const img = document.getElementById('ga511-img');
    if (!img) { stopImgRefresh(); return; }
    img.src = snap();
    const t = document.getElementById('ga511-time');
    if (t) t.textContent = now();
  }, IMG_REFRESH_MS);
}

function stopImgRefresh() { clearInterval(popupState.imgTimer); popupState.imgTimer = null; }
function closePopup() {
  stopImgRefresh();
  if (popupState.popup) { try { popupState.popup.remove(); } catch (e) {} popupState.popup = null; }
}

function toast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed; bottom:78px; left:50%; transform:translateX(-50%); background:var(--vx-surface);'
    + ' color:var(--vx-text); border:1px solid var(--vx-border, rgba(255,255,255,0.15)); padding:10px 16px;'
    + ' border-radius:var(--vx-r-3); font-family:var(--vx-font); font-size:13px; z-index:100060;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
