/*
 * components/mping.js
 * mPING crowd-sourced weather reports layer. Fetches the PlaceFileNation mPING
 * 15-minute placefile (through the app's server proxy, since placefilenation.com
 * is allowlisted) and renders each report as a category-colored marker with a
 * popup. Auto-refreshes; renders on the main map and the dual pane when split.
 *
 * Source: https://placefilenation.com/Placefiles/mping_15min.php
 */

const PLACEFILE = 'https://placefilenation.com/Placefiles/mping_15min.php';
const PROXY_URL = `/api/proxy?url=${PLACEFILE}`;
const REFRESH_MS = 3 * 60 * 1000; // 3 minutes

let _markers = [];
let _wrapper = null;
let _active = false;
let _timer = null;

// Report type -> { color, label } category.
function categorize(type) {
  const t = (type || '').toLowerCase();
  if (/hail/.test(t)) return { color: '#ff2020', cat: 'Hail' };
  if (/freezing/.test(t)) return { color: '#ff4db8', cat: 'Freezing' };
  if (/ice pellet|sleet|graupel/.test(t)) return { color: '#ff8c42', cat: 'Ice pellets' };
  if (/mix|rain and snow|rain\/snow/.test(t)) return { color: '#b06be0', cat: 'Mixed' };
  if (/snow/.test(t)) return { color: '#8fd3ff', cat: 'Snow' };
  if (/drizzle|rain/.test(t)) return { color: '#3bd23b', cat: 'Rain' };
  if (/none|no precip/.test(t)) return { color: '#9aa5b1', cat: 'No precip' };
  if (/tree|branch|limb|shingle|roof|structural|fence|power|flood|damage|blown/.test(t)) return { color: '#d98c3a', cat: 'Wind/Damage' };
  return { color: '#c7d0dc', cat: 'Report' };
}

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function timeAgo(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// Parse the placefile text into report objects.
function parsePlacefile(text) {
  const reports = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!/^\s*Icon:/i.test(line)) continue;
    const coord = line.match(/Icon:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),/i);
    if (!coord) continue;
    const lat = +coord[1], lon = +coord[2];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // The hover text is the quoted remainder; it may contain internal quotes
    // (e.g. `<1"`), so take from the first " to the last ".
    const q1 = line.indexOf('"');
    const q2 = line.lastIndexOf('"');
    const raw = (q1 >= 0 && q2 > q1) ? line.slice(q1 + 1, q2) : '';
    const typeM = raw.match(/Report Type:\s*(.*?)(?:\\n|$)/i);
    const timeM = raw.match(/Time of Report:\s*([0-9T:\-Z]+)/i);
    reports.push({ lat, lon, type: typeM ? typeM[1].trim() : 'Report', time: timeM ? timeM[1] : null });
  }
  return reports;
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

function render(reports) {
  clearMarkers();
  const gl = window.maplibregl || window.mapboxgl;
  if (!gl) return;
  for (const r of reports) {
    const { color, cat } = categorize(r.type);
    for (const map of targetMaps()) {
      const el = document.createElement('div');
      el.className = 'mping-marker';
      el.style.background = color;
      el.title = r.type;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        new gl.Popup({ closeButton: true, closeOnClick: true, className: 'mping-popup', maxWidth: '240px' })
          .setLngLat([r.lon, r.lat])
          .setHTML(`<div class="mping-pop"><div class="mping-pop-cat" style="color:${color}">${escapeHtml(cat)}</div>`
            + `<div class="mping-pop-type">${escapeHtml(r.type)}</div>`
            + (r.time ? `<div class="mping-pop-time">${escapeHtml(new Date(r.time).toLocaleString())} · ${timeAgo(r.time)}</div>` : '')
            + '</div>')
          .addTo(map);
      });
      const marker = new gl.Marker({ element: el, anchor: 'center' }).setLngLat([r.lon, r.lat]).addTo(map);
      _markers.push(marker);
    }
  }
}

async function load() {
  try {
    const res = await fetch(PROXY_URL, { cache: 'no-store' });
    if (!res.ok || !_active) return;
    const text = await res.text();
    if (!_active) return;
    render(parsePlacefile(text));
  } catch (err) {
    console.error('[mPING] load failed:', err);
  }
}

export function addMPING(mapWrapper) {
  _wrapper = mapWrapper || window.vortexMap;
  _active = true;
  load();
  clearInterval(_timer);
  _timer = setInterval(() => { if (_active) load(); }, REFRESH_MS);
}

export function removeMPING() {
  _active = false;
  clearInterval(_timer);
  _timer = null;
  clearMarkers();
}

// Repaint onto/off the dual pane when split screen toggles.
window.addEventListener('vortexsplitchange', () => { if (_active) load(); });
