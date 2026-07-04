/*
 * components/custom_locations.js
 * User-saved custom locations on the radar map. Add a place (by clicking the
 * map or entering lat/lon, or searching a name via Mapbox geocoding), and it
 * persists (localStorage) as a labelled marker you can toggle, jump to, or
 * delete. Markers render on the main map and the dual pane when split is on.
 */

const STORE_KEY = 'vortexCustomLocations';
const SHOW_KEY = 'vortexCustomLocationsShown';

let panel = null;
let markers = [];            // { id, marker } across all maps
let addMode = false;         // waiting for a map click to place a new location
let pendingName = '';

function mapWrap() { return window.vortexMap || null; }
function mainMap() { const w = mapWrap(); return w && w.map; }
function GL() { return window.mapboxgl || window.maplibregl; }

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}
function save(list) { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) {} }
function isShown() { return localStorage.getItem(SHOW_KEY) !== 'false'; }
function setShown(on) { localStorage.setItem(SHOW_KEY, on ? 'true' : 'false'); }

function targetMaps() {
  const w = mapWrap();
  const out = [];
  if (w && w.map) out.push(w.map);
  const split = typeof w?.isSplit === 'function' ? w.isSplit() : false;
  if (split && w.dualMap) out.push(w.dualMap);
  return out;
}

function markerEl(name) {
  const el = document.createElement('div');
  el.className = 'vloc-marker';
  el.innerHTML = `<div class="vloc-dot"></div><div class="vloc-label">${escapeHtml(name)}</div>`;
  return el;
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function clearMarkers() { markers.forEach((m) => { try { m.marker.remove(); } catch (e) {} }); markers = []; }

function renderMarkers() {
  clearMarkers();
  if (!isShown()) return;
  const gl = GL();
  if (!gl) return;
  const list = load();
  for (const loc of list) {
    for (const map of targetMaps()) {
      const marker = new gl.Marker({ element: markerEl(loc.name), anchor: 'left' })
        .setLngLat([loc.lon, loc.lat])
        .addTo(map);
      markers.push({ id: loc.id, marker });
    }
  }
}

function flyTo(loc) {
  const m = mainMap();
  if (m) m.flyTo({ center: [loc.lon, loc.lat], zoom: Math.max(m.getZoom(), 8), duration: 1200 });
}

function addLocation(name, lon, lat) {
  const list = load();
  list.push({ id: 'loc-' + Date.now().toString(36), name: name.trim(), lon: +lon, lat: +lat });
  save(list);
  if (!isShown()) { setShown(true); syncToggleBtn(); }
  renderMarkers();
  buildList();
}
function removeLocation(id) {
  save(load().filter((l) => l.id !== id));
  renderMarkers();
  buildList();
}

// ── Map click-to-place ───────────────────────────────────────────────────────
function beginAddByClick(name) {
  pendingName = name.trim();
  addMode = true;
  const m = mainMap();
  if (!m) return;
  m.getCanvas().style.cursor = 'crosshair';
  setStatus('Click the map to drop “' + pendingName + '”. (Esc to cancel)');
}
function onMapClick(e) {
  if (!addMode) return;
  addMode = false;
  const m = mainMap();
  if (m) m.getCanvas().style.cursor = '';
  const { lng, lat } = e.lngLat;
  addLocation(pendingName, lng, lat);
  setStatus('Added “' + pendingName + '”.');
  const nameInput = document.getElementById('vloc-name');
  if (nameInput) nameInput.value = '';
}
function cancelAdd() {
  if (!addMode) return;
  addMode = false;
  const m = mainMap();
  if (m) m.getCanvas().style.cursor = '';
  setStatus('');
}

// ── Geocoding search (Mapbox, using the app's token) ─────────────────────────
async function geocode(query) {
  const token = (GL() && GL().accessToken) || '';
  if (!token) throw new Error('Search unavailable (no map token). Use click or lat/lon.');
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
    + `?limit=1&access_token=${token}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Search failed (' + r.status + ')');
  const d = await r.json();
  if (!d.features || !d.features.length) throw new Error('No match for “' + query + '”.');
  const f = d.features[0];
  return { name: f.text || query, lon: f.center[0], lat: f.center[1], place: f.place_name };
}

// ── Panel UI ─────────────────────────────────────────────────────────────────
function setStatus(msg) { const el = document.getElementById('vloc-status'); if (el) el.textContent = msg || ''; }
function syncToggleBtn() {
  const t = document.getElementById('vloc-toggle');
  if (t) { t.textContent = isShown() ? 'Hide all' : 'Show all'; t.classList.toggle('active', isShown()); }
  const icon = document.getElementById('vortexLocationsIcon');
  if (icon) { icon.classList.toggle('menu_item_selected', isShown() && load().length > 0); icon.classList.toggle('menu_item_not_selected', !(isShown() && load().length > 0)); }
}

function buildList() {
  const wrap = document.getElementById('vloc-list');
  if (!wrap) return;
  const list = load();
  wrap.innerHTML = '';
  if (!list.length) { wrap.innerHTML = '<div class="vloc-empty">No saved locations yet. Add one below.</div>'; syncToggleBtn(); return; }
  for (const loc of list) {
    const row = document.createElement('div');
    row.className = 'vloc-row';
    row.innerHTML = `<div class="vloc-info"><div class="vloc-nm">${escapeHtml(loc.name)}</div>
      <div class="vloc-ll">${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}</div></div>
      <button class="vloc-go" title="Fly to">Go</button><button class="vloc-del" title="Delete">✕</button>`;
    row.querySelector('.vloc-go').onclick = () => flyTo(loc);
    row.querySelector('.vloc-del').onclick = () => removeLocation(loc.id);
    wrap.appendChild(row);
  }
  syncToggleBtn();
}

function open() {
  if (panel) { close(); return; }
  panel = document.createElement('div');
  panel.id = 'vlocPanel';
  panel.innerHTML = `
    <div class="vloc-head"><span>My Locations</span>
      <span class="vloc-head-actions">
        <button id="vloc-toggle" class="vloc-toggle" title="Show/hide all markers"></button>
        <button id="vloc-close" class="vloc-x" title="Close">✕</button>
      </span>
    </div>
    <div class="vloc-list" id="vloc-list"></div>
    <div class="vloc-add">
      <input id="vloc-name" class="vloc-in" placeholder="Location name (e.g. My Town)" />
      <div class="vloc-search-row">
        <input id="vloc-q" class="vloc-in" placeholder="Search a place name…" />
        <button id="vloc-search" class="vloc-btn">Search</button>
      </div>
      <div class="vloc-ll-row">
        <input id="vloc-lat" class="vloc-in vloc-sm" placeholder="lat" />
        <input id="vloc-lon" class="vloc-in vloc-sm" placeholder="lon" />
        <button id="vloc-addll" class="vloc-btn">Add</button>
      </div>
      <button id="vloc-click" class="vloc-btn vloc-primary">＋ Click map to place</button>
      <div class="vloc-status" id="vloc-status"></div>
    </div>`;
  document.body.appendChild(panel);

  document.getElementById('vloc-close').onclick = close;
  document.getElementById('vloc-toggle').onclick = () => {
    setShown(!isShown()); renderMarkers(); syncToggleBtn();
    setStatus(isShown() ? 'Showing markers.' : 'Markers hidden.');
  };
  const nameOf = () => (document.getElementById('vloc-name').value || '').trim();
  document.getElementById('vloc-click').onclick = () => {
    const n = nameOf();
    if (!n) { setStatus('Enter a name first.'); return; }
    beginAddByClick(n);
  };
  document.getElementById('vloc-addll').onclick = () => {
    const n = nameOf();
    const lat = parseFloat(document.getElementById('vloc-lat').value);
    const lon = parseFloat(document.getElementById('vloc-lon').value);
    if (!n) { setStatus('Enter a name first.'); return; }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { setStatus('Enter a valid lat and lon.'); return; }
    addLocation(n, lon, lat);
    setStatus('Added “' + n + '”.');
    document.getElementById('vloc-name').value = '';
    document.getElementById('vloc-lat').value = ''; document.getElementById('vloc-lon').value = '';
  };
  document.getElementById('vloc-search').onclick = async () => {
    const q = (document.getElementById('vloc-q').value || '').trim();
    if (!q) { setStatus('Type a place to search.'); return; }
    setStatus('Searching…');
    try {
      const hit = await geocode(q);
      const n = nameOf() || hit.name;
      addLocation(n, hit.lon, hit.lat);
      flyTo({ lon: hit.lon, lat: hit.lat });
      setStatus('Added “' + n + '” — ' + hit.place);
      document.getElementById('vloc-q').value = ''; document.getElementById('vloc-name').value = '';
    } catch (e) { setStatus(e.message); }
  };

  buildList();
  syncToggleBtn();
}
function close() { cancelAdd(); if (panel) { panel.remove(); panel = null; } }

function init() {
  const btn = document.getElementById('vortexLocationsBtn');
  if (btn) btn.addEventListener('click', open);

  const wire = () => {
    const m = mainMap();
    if (m) m.on('click', onMapClick);
    renderMarkers();
    syncToggleBtn();
  };
  if (mainMap()) wire();
  else window.addEventListener('vortexmapready', wire, { once: true });

  // Re-render onto/off the dual pane as split toggles.
  window.addEventListener('vortexsplitchange', renderMarkers);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { cancelAdd(); setStatus(''); } });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
