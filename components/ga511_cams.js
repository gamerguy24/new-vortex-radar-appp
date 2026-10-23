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
 *   AR iDrive Traffic Cams ARDOT, idrivearkansas.com  — stills; live video only on their site (`w` link)
 *   TX DriveTexas Cams    TxDOT, drivetexas.org       — live HLS video, tokened URL fetched on open (`x`)
 *   …and every other state with a public feed (REGIONS below; sources in backend/ga511).
 *   A view may carry a still (`u`), a stream (`h`) or both; with both the popup
 *   opens on the still and offers the stream on its Live video button.
 *
 * All states are one layer, Traffic Cams in the menu: about 50,000 cameras,
 * drawn as a clustered GeoJSON layer on the GPU, not one DOM marker each (the
 * BuoyCAMs approach would stall the map at this count). Click a cluster to zoom
 * into it; click a camera for its live snapshot, which refreshes every minute
 * while the popup is open.
 *
 * The list comes from /api/511cams/national (backend/ga511 — the keys stay on
 * the server) and carries only each camera's region (`g`) and id (`v`). The map
 * loads it by URL, so it is downloaded and parsed on the map's worker rather
 * than freezing the page; a camera's name, snapshot and stream are fetched
 * from /api/511cams/<region>/cam/<id> when it is opened. Snapshots load
 * straight from the 511 site, which serves them publicly with CORS open and a
 * 60 s cache.
 */

const REGIONS = {
  ga: { credit: 'Georgia 511 · GDOT', host: 'https://511ga.org' },
  nc: { credit: 'DriveNC · NCDOT', host: 'https://www.drivenc.gov' },
  tn: { credit: 'SmartWay · TDOT', host: null },
  al: { credit: 'ALGO Traffic · ALDOT', host: null },
  sc: { credit: '511SC · SCDOT', host: null },
  ok: { credit: 'OKTraffic · ODOT', host: null },
  ky: { credit: 'KYTC', host: null },
  // MDOT's stills are live Wowza thumbnails; its own site refreshes them every 5 s.
  ms: { credit: 'MDOTtraffic · MDOT', host: null, imgRefreshMs: 15000 },
  la: { credit: '511LA · LADOTD', host: 'https://www.511la.org' },
  ar: { credit: 'iDriveArkansas · ARDOT', host: null },
  tx: { credit: 'DriveTexas · TxDOT', host: null },
  // Every other state with a public DOT camera feed (backend/ga511 says where each comes from).
  ak: { credit: 'Alaska 511 · DOT&PF', host: null },
  az: { credit: 'AZ511 · ADOT', host: null },
  ca: { credit: 'Caltrans', host: null },
  co: { credit: 'COtrip · CDOT', host: null },
  ct: { credit: 'CTroads · CTDOT', host: null },
  de: { credit: 'DelDOT', host: null },
  fl: { credit: 'FL511 · FDOT', host: null },
  ia: { credit: '511IA · Iowa DOT', host: null },
  id: { credit: 'Idaho 511 · ITD', host: null },
  il: { credit: 'Getting Around Illinois · IDOT', host: null },
  in: { credit: '511IN · INDOT', host: null },
  ks: { credit: 'KanDrive · KDOT', host: null },
  ma: { credit: 'Mass511 · MassDOT', host: null },
  md: { credit: 'CHART · MDOT SHA', host: null },
  me: { credit: 'New England 511 · MaineDOT', host: null },
  mi: { credit: 'MiDrive · MDOT', host: null },
  mn: { credit: '511MN · MnDOT', host: null },
  mo: { credit: 'MoDOT Traveler', host: null },
  mt: { credit: '511MT · MDT', host: null },
  nd: { credit: 'NDDOT', host: null },
  ne: { credit: 'Nebraska 511 · NDOT', host: null },
  nh: { credit: 'New England 511 · NHDOT', host: null },
  nv: { credit: 'NVroads · NDOT', host: null },
  ny: { credit: '511NY · NYSDOT', host: null },
  oh: { credit: 'OHGO · ODOT', host: null },
  or: { credit: 'TripCheck · ODOT', host: null },
  pa: { credit: '511PA · PennDOT', host: null },
  sd: { credit: 'SD511 · SDDOT', host: null },
  ut: { credit: 'UDOT Traffic', host: null },
  va: { credit: '511 Virginia · VDOT', host: null },
  vt: { credit: 'New England 511 · VTrans', host: null },
  wa: { credit: 'WSDOT', host: null },
  wi: { credit: '511WI · WisDOT', host: null },
  wv: { credit: 'WV511 · WVDOH', host: null },
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
.ga511-pop-live { font: inherit; font-size: 1em; padding: 2px 8px; border-radius: var(--vx-r-2); cursor: pointer;
  background: transparent; color: var(--vx-accent); border: 1px solid var(--vx-accent); }
.ga511-pop-live[hidden] { display: none; }
.ga511-pop-link { font-size: 0.8em; color: var(--vx-accent); text-decoration: none; }
.ga511-pop-link:hover { text-decoration: underline; }
.ga511-pop-views button { font: inherit; font-size: 0.8em; min-width: 32px; padding: 3px 8px; border-radius: var(--vx-r-2); cursor: pointer;
  background: transparent; color: var(--vx-text); border: 1px solid var(--vx-border, rgba(255,255,255,0.18)); }
.ga511-pop-views button[aria-pressed="true"] { border-color: var(--vx-accent); color: var(--vx-accent); }
.ga511-pop-foot { display: flex; justify-content: space-between; align-items: center; font-size: 0.75em; color: var(--vx-text-2); font-variant-numeric: tabular-nums; }`;
  document.head.appendChild(s);
}

const SRC = 'vx-511-src', CLUSTER = 'vx-511-cluster', COUNT = 'vx-511-count', CAM = 'vx-511-cam';
const LIST_URL = '/api/511cams/national';
export const SWITCH_ID = 'armrTrafficCamsSwitchElem';
// The map whose layer is on, its refresh timer, and whether the list has
// loaded once (a failed first load turns the switch back off).
const layer = { map: null, listTimer: null, loaded: false };

function onSourceData(e) {
  if (e.sourceId === SRC && e.isSourceLoaded) layer.loaded = true;
}
function onSourceError(e) {
  if (e.sourceId !== SRC) return;
  const msg = (e.error && e.error.message) || 'could not load the camera list';
  console.warn('[511] traffic cameras unavailable:', msg);
  // A failed periodic refresh keeps the cameras already on the map.
  if (layer.loaded) return;
  toast(`Traffic Cams unavailable: ${msg}`);
  const sw = document.getElementById(SWITCH_ID);
  if (sw) sw.checked = false;
  removeTrafficCams();
}

export function addTrafficCams(w) {
  const map = w.map;
  if (map.getSource(SRC)) return;
  injectStyles();
  layer.map = map;
  layer.loaded = false;

  // A URL, not fetched data: the map's worker downloads, parses and clusters it.
  const url = new URL(LIST_URL, location.href).href;
  map.addSource(SRC, {
    type: 'geojson',
    data: url,
    cluster: true,
    clusterRadius: 42,
    clusterMaxZoom: 11,
  });
  map.addLayer({
    id: CLUSTER, type: 'circle', source: SRC, filter: ['has', 'point_count'],
    paint: {
      'circle-color': CAM_COLOR,
      'circle-opacity': 0.85,
      'circle-radius': ['step', ['get', 'point_count'], 12, 25, 16, 100, 21, 400, 26],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': 'rgba(255,255,255,0.9)',
    },
  });
  map.addLayer({
    id: COUNT, type: 'symbol', source: SRC, filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: CAM, type: 'circle', source: SRC, filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': CAM_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.5, 12, 6.5],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
    },
  });

  map.on('sourcedata', onSourceData);
  map.on('error', onSourceError);
  map.on('click', CLUSTER, clusterClick);
  map.on('click', CAM, camClick);
  for (const id of [CLUSTER, CAM]) {
    map.on('mouseenter', id, onEnter);
    map.on('mouseleave', id, onLeave);
  }

  clearInterval(layer.listTimer);
  layer.listTimer = setInterval(() => {
    const src = layer.map && layer.map.getSource(SRC);
    if (src) src.setData(url);
  }, LIST_REFRESH_MS);
}

export function removeTrafficCams(w) {
  const map = (w && w.map) || layer.map;
  clearInterval(layer.listTimer);
  layer.listTimer = null;
  closePopup();
  if (!map) return;
  map.off('sourcedata', onSourceData);
  map.off('error', onSourceError);
  map.off('click', CLUSTER, clusterClick);
  map.off('click', CAM, camClick);
  for (const id of [CLUSTER, CAM]) { map.off('mouseenter', id, onEnter); map.off('mouseleave', id, onLeave); }
  for (const id of [COUNT, CLUSTER, CAM]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SRC)) map.removeSource(SRC);
  map.getCanvas().style.cursor = '';
  layer.map = null;
  layer.loaded = false;
}

function onEnter(e) { e.target.getCanvas().style.cursor = 'pointer'; }
function onLeave(e) { e.target.getCanvas().style.cursor = ''; }

function clusterClick(e) {
  const map = e.target;
  const f = e.features && e.features[0];
  if (!f) return;
  const src = map.getSource(SRC);
  const centre = f.geometry.coordinates;
  const go = (zoom) => map.easeTo({ center: centre, zoom: Math.min(zoom, 16) });
  // MapLibre ≥3 returns a promise; Mapbox GL and older MapLibre use a callback.
  const p = src.getClusterExpansionZoom(f.properties.cluster_id, (err, zoom) => { if (!err) go(zoom); });
  if (p && typeof p.then === 'function') p.then(go).catch(() => {});
}

// The map only carries each camera's region and id: open the popup straight
// away, then fill it in from /api/511cams/<region>/cam/<id>.
function camClick(e) {
  const f = e.features && e.features[0];
  if (!f) return;
  const cfg = REGIONS[f.properties.g];
  if (!cfg) return;
  const L = { region: f.properties.g, cfg };
  const gl = window.maplibregl || window.mapboxgl;
  closePopup();
  const [lon, lat] = f.geometry.coordinates;
  popupState.popup = new gl.Popup({ closeButton: true, closeOnClick: true, className: 'ga511-popup', maxWidth: '500px', offset: 10 })
    .setLngLat(f.geometry.coordinates)
    .setHTML('<div class="ga511-pop"><div class="ga511-pop-title">Traffic camera</div><div id="ga511-media"><div class="ga511-pop-msg">Loading camera…</div></div></div>')
    .addTo(e.target);
  popupState.popup.on('close', stopMedia);
  const token = ++popupState.token;
  fetch(`/api/511cams/${encodeURIComponent(L.region)}/cam/${encodeURIComponent(f.properties.v)}?ll=${lon},${lat}`)
    .then((r) => r.json().then((j) => { if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j.properties; }))
    .then((p) => { if (token === popupState.token) showCamera(L, p, token); })
    .catch((err) => { if (token === popupState.token) showMessage(`Camera unavailable: ${err.message}`); });
}

function showCamera(L, p, token) {
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
      <div class="ga511-pop-foot"><span id="ga511-time"></span><button type="button" class="ga511-pop-live" id="ga511-live" hidden></button><span>${esc(L.cfg.credit)}</span></div>
      ${String(p.w || '').startsWith('https://') ?`<a class="ga511-pop-link" href="${esc(p.w)}" target="_blank" rel="noopener">Watch live video on ${esc(L.cfg.credit.split(' · ')[0])} ↗</a>` : ''}
    </div>`;
  popupState.popup.setHTML(html);

  // Views: OKTraffic sends several per pole (`vs`), MDOT's are fetched per
  // site (`x`), the rest have one.
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
    views = [{ ...(p.u || !p.h ? { u: p.u || `${L.cfg.host}/map/Cctv/${encodeURIComponent(p.v)}` } : {}), ...(p.h ? { h: p.h } : {}) }];
  }
  showViews(L, title, views);
}

function showMessage(msg) {
  stopMedia();
  const box = document.getElementById('ga511-media');
  if (box) box.innerHTML = `<div class="ga511-pop-msg">${esc(msg)}</div>`;
  const t = document.getElementById('ga511-time');
  if (t) t.textContent = '';
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

// mode: 'live' plays the stream; otherwise a view with a still shows the still
// first and offers its stream (if any) on the Live video button.
function showView(L, title, views, i, mode) {
  stopMedia();
  const v = views[i];
  const box = document.getElementById('ga511-media');
  if (!box || !v) return;
  const live = document.getElementById('ga511-live');
  const both = !!(v.u && v.h);
  if (live) {
    live.hidden = !both;
    live.textContent = mode === 'live' ? 'Show picture' : '▶ Live video';
    live.onclick = () => showView(L, title, views, i, mode === 'live' ? 'still' : 'live');
  }
  for (const b of document.querySelectorAll('#ga511-views button')) b.setAttribute('aria-pressed', String(+b.dataset.i === i));
  const vt = document.getElementById('ga511-view-title');
  if (vt) { vt.textContent = views.length > 1 ? v.t || '' : ''; vt.hidden = !vt.textContent; }
  const time = document.getElementById('ga511-time');
  const label = esc(v.t || title);
  if (v.h && (mode === 'live' || !v.u)) {
    box.innerHTML = `<video class="ga511-pop-img" id="ga511-video" muted autoplay playsinline controls aria-label="Live traffic camera: ${label}"></video>`;
    if (time) time.textContent = 'Connecting to live video…';
    // With a still to fall back on, a stream that will not play goes back to it.
    const fail = v.u ? (msg) => { showView(L, title, views, i, 'still'); const t = document.getElementById('ga511-time'); if (t) t.textContent = msg; } : showMessage;
    playHls(document.getElementById('ga511-video'), v.h, popupState.token, fail);
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

function playHls(video, src, token, onFail = showMessage) {
  if (!video) return;
  video.addEventListener('playing', () => {
    const t = document.getElementById('ga511-time');
    if (t && token === popupState.token) t.textContent = 'Live video';
  }, { once: true });
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
      else onFail('This browser cannot play live camera video.');
      return;
    }
    // Some DOT streams take several seconds to wake up: allow for it.
    const h = new Hls({ liveDurationInfinity: true, manifestLoadingTimeOut: 15000, manifestLoadingMaxRetry: 2 });
    popupState.hls = h;
    h.loadSource(src);
    h.attachMedia(video);
    h.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    h.on(Hls.Events.ERROR, (_e, data) => {
      if (!data || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
      else if (token === popupState.token) onFail('This camera’s video is not available right now.');
    });
  }).catch((err) => { if (token === popupState.token) onFail(`Video unavailable: ${err.message}`); });
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

function toast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed; bottom:78px; left:50%; transform:translateX(-50%); background:var(--vx-surface);'
    + ' color:var(--vx-text); border:1px solid var(--vx-border, rgba(255,255,255,0.15)); padding:10px 16px;'
    + ' border-radius:var(--vx-r-3); font-family:var(--vx-font); font-size:13px; z-index:100060;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
