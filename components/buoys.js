/*
 * components/buoys.js
 * NDBC buoy observations layer. Fetches the PlaceFileNation buoys placefile
 * (through the app's server proxy, since placefilenation.com is allowlisted) and
 * renders each buoy as a marker with a popup of its latest observation.
 *
 * The placefile is the saratoga-weather.org "buoys.php" generator, which only
 * emits data when the GR-style `version`, `lat` and `lon` query params are
 * present and returns buoys within ~250 mi of that lat/lon. We therefore pass
 * the current map center and re-fetch when the view pans a long way.
 *
 * Source: https://placefilenation.com/Placefiles/buoys.php?version=1.5&lat=..&lon=..
 */

const BASE = 'https://placefilenation.com/Placefiles/buoys.php';
const REFRESH_MS = 10 * 60 * 1000; // 10 minutes (obs update hourly)
const REFETCH_DEG = 1.5;           // re-fetch after the center pans this far

let _markers = [];
let _wrapper = null;
let _active = false;
let _timer = null;
let _lastCenter = null;   // { lat, lon } of the last fetch
let _moveHandler = null;
let _moveMap = null;
let _moveDebounce = null;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Parse the placefile text into buoy objects: { lat, lon, title, lines[] }.
// Each buoy is an `Object: lat,lon` block whose descriptive Icon line carries a
// quoted, \n-delimited observation string.
function parsePlacefile(text) {
  const buoys = [];
  const lines = text.split(/\r?\n/);
  let cur = null;
  for (const line of lines) {
    const obj = line.match(/^\s*Object:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (obj) {
      cur = { lat: +obj[1], lon: +obj[2], raw: null };
      continue;
    }
    if (!cur) continue;
    if (/^\s*End:/i.test(line)) {
      if (cur.raw != null) buoys.push(cur);
      cur = null;
      continue;
    }
    // The Icon line with a quoted string holds the hover/observation text.
    if (cur.raw == null && /^\s*Icon:/i.test(line)) {
      const q1 = line.indexOf('"');
      const q2 = line.lastIndexOf('"');
      if (q1 >= 0 && q2 > q1) cur.raw = line.slice(q1 + 1, q2);
    }
  }
  // Split each raw obs string into a title + detail lines for the popup.
  return buoys
    .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lon))
    .map((b) => {
      const parts = b.raw.split('\\n').map((s) => s.trim());
      const title = (parts[0] || 'Buoy').replace(/^BUOY\s+/i, '');
      const detail = parts.slice(1).filter((s) => s && !/^-+$/.test(s));
      return { lat: b.lat, lon: b.lon, title, detail };
    });
}

function targetMaps() {
  const w = _wrapper || window.vortexMap || {};
  const out = [];
  if (w.map) out.push(w.map);
  const split = typeof w.isSplit === 'function' ? w.isSplit() : false;
  if (split && w.dualMap) out.push(w.dualMap);
  return out;
}

function clearMarkers() { _markers.forEach((m) => { try { m.remove(); } catch (e) {} }); _markers = []; }

function render(buoys) {
  clearMarkers();
  const gl = window.maplibregl || window.mapboxgl;
  if (!gl) return;
  for (const b of buoys) {
    const detailHtml = b.detail.map((d) => `<div class="buoy-pop-line">${escapeHtml(d)}</div>`).join('');
    for (const map of targetMaps()) {
      const el = document.createElement('div');
      el.className = 'buoy-marker';
      el.title = b.title;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        new gl.Popup({ closeButton: true, closeOnClick: true, className: 'buoy-popup', maxWidth: '280px' })
          .setLngLat([b.lon, b.lat])
          .setHTML(`<div class="buoy-pop"><div class="buoy-pop-title">${escapeHtml(b.title)}</div>${detailHtml}</div>`)
          .addTo(map);
      });
      const marker = new gl.Marker({ element: el, anchor: 'center' }).setLngLat([b.lon, b.lat]).addTo(map);
      _markers.push(marker);
    }
  }
}

function currentCenter() {
  const map = (_wrapper || window.vortexMap || {}).map;
  if (map && typeof map.getCenter === 'function') {
    const c = map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }
  return { lat: 30, lon: -90 }; // Gulf of Mexico fallback
}

async function load() {
  if (!_active) return;
  const c = currentCenter();
  _lastCenter = c;
  const url = `${BASE}?version=1.5&lat=${c.lat.toFixed(3)}&lon=${c.lon.toFixed(3)}`;
  try {
    const res = await fetch(`/api/proxy?url=${url}`, { cache: 'no-store' });
    // 402 = the server's Tier One gate (see PROXY_TIER_RULES in server.js).
    if (res.status === 402 && window.vortexProGate) {
      window.vortexProGate.denied('Buoys', 1, 'armrBuoysSwitchElem');
      removeBuoys();
      return;
    }
    if (!res.ok || !_active) return;
    const text = await res.text();
    if (!_active) return;
    // placefilenation occasionally returns an HTML 404 page with a 200 status;
    // ignore it so a transient hiccup doesn't clear the existing buoys.
    if (/^\s*</.test(text)) return;
    render(parsePlacefile(text));
  } catch (err) {
    console.error('[Buoys] load failed:', err);
  }
}

// Re-fetch when the map pans well outside the previously fetched area (the
// placefile only covers ~250 mi around the requested center).
function onMove() {
  clearTimeout(_moveDebounce);
  _moveDebounce = setTimeout(() => {
    if (!_active || !_lastCenter) return;
    const c = currentCenter();
    if (Math.abs(c.lat - _lastCenter.lat) > REFETCH_DEG || Math.abs(c.lon - _lastCenter.lon) > REFETCH_DEG) {
      load();
    }
  }, 800);
}

export function addBuoys(mapWrapper) {
  _wrapper = mapWrapper || window.vortexMap;
  _active = true;
  load();
  clearInterval(_timer);
  _timer = setInterval(() => { if (_active) load(); }, REFRESH_MS);

  _moveMap = (_wrapper || {}).map || null;
  if (_moveMap && !_moveHandler) {
    _moveHandler = onMove;
    _moveMap.on('moveend', _moveHandler);
  }
}

export function removeBuoys() {
  _active = false;
  clearInterval(_timer);
  _timer = null;
  clearTimeout(_moveDebounce);
  if (_moveMap && _moveHandler) { try { _moveMap.off('moveend', _moveHandler); } catch (e) {} }
  _moveHandler = null;
  _moveMap = null;
  clearMarkers();
}

// Repaint onto/off the dual pane when split screen toggles.
window.addEventListener('vortexsplitchange', () => { if (_active) load(); });
