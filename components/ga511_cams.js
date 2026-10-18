/*
 * components/ga511_cams.js
 * State DOT traffic camera layers from 511 sites on the shared 511 platform.
 * Free layers.
 *
 *   GA 511 Traffic Cams   Georgia DOT, 511ga.org      (~4,300 cameras)
 *   NC 511 Traffic Cams   NCDOT, drivenc.gov          (~1,000 cameras)
 *   TN SmartWay Cams      TDOT open data (smartway)   — snapshot URL per camera (`u`)
 *   AL ALGO Traffic Cams  ALDOT, algotraffic.com      — snapshot URL per camera (`u`)
 *   SC 511 Traffic Cams   SCDOT, 511sc.org            — snapshot URL per camera (`u`)
 *   OK Traffic Cams       ODOT, oktraffic.org         — live HLS video, several per pole (`vs`)
 *   KY Traffic Cams       KYTC (ArcGIS)               — snapshot URL per camera (`u`)
 *   MS MDOT Traffic Cams  MDOT, mdottraffic.com       — views fetched when a site is opened (`x`)
 *   LA 511 Traffic Cams   LADOTD, 511la.org           — snapshot URL per view (`u` / `vs`)
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
  tn: { label: 'TN SmartWay Traffic Cams', credit: 'SmartWay · TDOT', host: null, switchId: 'armrTn511CamsSwitchElem' },
  al: { label: 'AL ALGO Traffic Cams', credit: 'ALGO Traffic · ALDOT', host: null, switchId: 'armrAl511CamsSwitchElem' },
  sc: { label: 'SC 511 Traffic Cams', credit: '511SC · SCDOT', host: null, switchId: 'armrSc511CamsSwitchElem' },
  ok: { label: 'OK Traffic Cams', credit: 'OKTraffic · ODOT', host: null, switchId: 'armrOk511CamsSwitchElem' },
  ky: { label: 'KY Traffic Cams', credit: 'KYTC', host: null, switchId: 'armrKy511CamsSwitchElem' },
  // MDOT's stills are live Wowza thumbnails; its own site refreshes them every 5 s.
  ms: { label: 'MS MDOT Traffic Cams', credit: 'MDOTtraffic · MDOT', host: null, switchId: 'armrMs511CamsSwitchElem', imgRefreshMs: 15000 },
  la: { label: 'LA 511 Traffic Cams', credit: '511LA · LADOTD', host: 'https://www.511la.org', switchId: 'armrLa511CamsSwitchElem' },
};

const LIST_REFRESH_MS = 10 * 60 * 1000;   // matches the server cache
const IMG_REFRESH_MS = 60 * 1000;         // the 511 sites refresh snapshots about this often
const HLS_JS = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js';
const CAM_COLOR = '#3d9be9';               // data colour for these layers, not interface state

// One popup across all regions — opening a camera closes any other.
const popupState = { popup: null, imgTimer: null, hls: null, token: 0 };

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
.ga511-pop-msg { width: 100%; aspect-ratio: 16 / 9; display: flex; align-items: center; justify-content: center; text-align: center;
  background: #000; color: var(--vx-text-2); font-size: 0.85em; border-radius: var(--vx-r-2); padding: 12px; box-sizing: border-box; }
.ga511-pop-views { display: flex; flex-wrap: wrap; gap: 4px; }
.ga511-pop-views:empty { display: none; }
.ga511-pop-views button { font: inherit; font-size: 0.8em; min-width: 32px; padding: 3px 8px; border-radius: var(--vx-r-2); cursor: pointer;
  background: transparent; color: var(--vx-text); border: 1px solid var(--vx-border, rgba(255,255,255,0.18)); }
.ga511-pop-views button[aria-pressed="true"] { border-color: var(--vx-accent); color: var(--vx-accent); }
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
export const addTn511Cams = (w) => addRegion('tn', w);
export const removeTn511Cams = (w) => removeRegion('tn', w);
export const addAl511Cams = (w) => addRegion('al', w);
export const removeAl511Cams = (w) => removeRegion('al', w);
export const addSc511Cams = (w) => addRegion('sc', w);
export const removeSc511Cams = (w) => removeRegion('sc', w);
export const addOk511Cams = (w) => addRegion('ok', w);
export const removeOk511Cams = (w) => removeRegion('ok', w);
export const addKy511Cams = (w) => addRegion('ky', w);
export const removeKy511Cams = (w) => removeRegion('ky', w);
export const addMs511Cams = (w) => addRegion('ms', w);
export const removeMs511Cams = (w) => removeRegion('ms', w);
export const addLa511Cams = (w) => addRegion('la', w);
export const removeLa511Cams = (w) => removeRegion('la', w);

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
  const sub = [coded ? null : roadDir, p.s, p.c ? `${p.c} County` : null, coded ? p.n : null].filter(Boolean).join(' · ');
  const html = `<div class="ga511-pop">
      <div class="ga511-pop-title">${esc(title)}</div>
      ${sub ? `<div class="ga511-pop-sub">${esc(sub)}</div>` : ''}
      <div class="ga511-pop-sub" id="ga511-view-title" hidden></div>
      <div id="ga511-media"><div class="ga511-pop-msg">Loading camera…</div></div>
      <div class="ga511-pop-views" id="ga511-views" role="group" aria-label="Camera views"></div>
      <div class="ga511-pop-foot"><span id="ga511-time"></span><span>${esc(L.cfg.credit)}</span></div>
    </div>`;
  popupState.region = L.region;
  popupState.popup = new gl.Popup({ closeButton: true, closeOnClick: true, className: 'ga511-popup', maxWidth: '500px', offset: 10 })
    .setLngLat(f.geometry.coordinates)
    .setHTML(html)
    .addTo(e.target);
  popupState.popup.on('close', stopMedia);
  const token = ++popupState.token;

  // Views: OKTraffic sends several per pole (`vs`; GL hands nested properties
  // back as JSON strings), MDOT's are fetched per site (`x`), the rest have one.
  if (p.x) {
    fetch(`/api/511cams/${L.region}/views/${encodeURIComponent(p.v)}`, { cache: 'no-store' })
      .then((r) => r.json().then((j) => { if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j.views || []; }))
      .then((views) => { if (token === popupState.token) showViews(L, title, views); })
      .catch((err) => { if (token === popupState.token) showMessage(`Camera unavailable: ${err.message}`); });
    return;
  }
  let views = p.vs;
  if (typeof views === 'string') { try { views = JSON.parse(views); } catch { views = null; } }
  if (!Array.isArray(views) || !views.length) {
    // Shared-platform snapshots are built from the view id; the others send a URL per camera.
    views = [{ u: p.u || `${L.cfg.host}/map/Cctv/${encodeURIComponent(p.v)}` }];
  }
  showViews(L, title, views);
}

function showMessage(msg) {
  stopMedia();
  const box = document.getElementById('ga511-media');
  if (box) box.innerHTML = `<div class="ga511-pop-msg">${esc(msg)}</div>`;
}

function showViews(L, title, views) {
  if (!views.length) { showMessage('This camera site has no cameras online right now.'); return; }
  const bar = document.getElementById('ga511-views');
  if (bar && views.length > 1) {
    bar.innerHTML = views.map((v, i) => `<button type="button" data-i="${i}" title="${esc(v.t || '')}" aria-pressed="false">${esc(v.l || i + 1)}</button>`).join('');
    bar.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-i]');
      if (b) showView(L, title, views, +b.dataset.i);
    });
  }
  showView(L, title, views, 0);
}

function showView(L, title, views, i) {
  stopMedia();
  const v = views[i];
  const box = document.getElementById('ga511-media');
  if (!box || !v) return;
  for (const b of document.querySelectorAll('#ga511-views button')) b.setAttribute('aria-pressed', String(+b.dataset.i === i));
  const vt = document.getElementById('ga511-view-title');
  if (vt) { vt.textContent = views.length > 1 ? v.t || '' : ''; vt.hidden = !vt.textContent; }
  const time = document.getElementById('ga511-time');
  const label = esc(v.t || title);
  if (v.h) {
    box.innerHTML = `<video class="ga511-pop-img" id="ga511-video" muted autoplay playsinline controls aria-label="Live traffic camera: ${label}"></video>`;
    if (time) time.textContent = 'Live video';
    playHls(document.getElementById('ga511-video'), v.h, popupState.token);
    return;
  }
  const snap = () => { const u = new URL(v.u); u.searchParams.set('t', Date.now()); return u.href; };
  const now = () => 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  box.innerHTML = `<img class="ga511-pop-img" id="ga511-img" src="${esc(snap())}" alt="Traffic camera: ${label}">`;
  if (time) time.textContent = now();
  // Keep the snapshot live while it is open.
  popupState.imgTimer = setInterval(() => {
    const img = document.getElementById('ga511-img');
    if (!img) { stopMedia(); return; }
    img.src = snap();
    const t = document.getElementById('ga511-time');
    if (t) t.textContent = now();
  }, L.cfg.imgRefreshMs || IMG_REFRESH_MS);
}

// hls.js is loaded the first time someone opens a video camera, not with the page.
let hlsLoad = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoad) {
    hlsLoad = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = HLS_JS;
      sc.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('hls.js did not load')));
      sc.onerror = () => { hlsLoad = null; reject(new Error('could not load the video player')); };
      document.head.appendChild(sc);
    });
  }
  return hlsLoad;
}

function playHls(video, src, token) {
  if (!video) return;
  // hls.js wherever Media Source Extensions exist. Native HLS only without
  // them (older iOS): recent desktop Chrome answers "maybe" to canPlayType for
  // HLS but did not play these streams.
  const native = () => { video.src = src; video.play().catch(() => {}); };
  const mse = window.MediaSource || window.ManagedMediaSource;
  if (!mse && video.canPlayType('application/vnd.apple.mpegurl')) { native(); return; }
  loadHls().then((Hls) => {
    if (token !== popupState.token || !document.body.contains(video)) return;
    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) native();
      else showMessage('This browser cannot play live camera video.');
      return;
    }
    const h = new Hls({ liveDurationInfinity: true });
    popupState.hls = h;
    h.loadSource(src);
    h.attachMedia(video);
    h.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    h.on(Hls.Events.ERROR, (_e, data) => {
      if (!data || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
      else if (token === popupState.token) showMessage('This camera’s video is not available right now.');
    });
  }).catch((err) => { if (token === popupState.token) showMessage(`Video unavailable: ${err.message}`); });
}

function stopMedia() {
  clearInterval(popupState.imgTimer);
  popupState.imgTimer = null;
  if (popupState.hls) { try { popupState.hls.destroy(); } catch (e) {} popupState.hls = null; }
}
function closePopup() {
  stopMedia();
  popupState.token++;
  if (popupState.popup) { try { popupState.popup.remove(); } catch (e) {} popupState.popup = null; }
}

// Hide the menu rows of regions this server has no key for.
async function hideUnconfigured() {
  try {
    const r = await fetch('/api/511cams', { cache: 'no-store' });
    if (!r.ok) return;
    const ready = await r.json();
    for (const [region, cfg] of Object.entries(REGIONS)) {
      if (ready[region] !== false) continue;
      const row = document.getElementById(cfg.switchId)?.closest('.vortexRadarMenuRow');
      if (row) row.style.display = 'none';
    }
  } catch { /* leave the rows visible; a toggle then explains itself */ }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hideUnconfigured);
else hideUnconfigured();

function toast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed; bottom:78px; left:50%; transform:translateX(-50%); background:var(--vx-surface);'
    + ' color:var(--vx-text); border:1px solid var(--vx-border, rgba(255,255,255,0.15)); padding:10px 16px;'
    + ' border-radius:var(--vx-r-3); font-family:var(--vx-font); font-size:13px; z-index:100060;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
