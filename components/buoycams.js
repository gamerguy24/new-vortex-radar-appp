/*
 * components/buoycams.js
 * NDBC BuoyCAM layer — live camera snapshots from ocean buoys.
 * Fetches the NDBC BuoyCAMs KML feed (through the app's server proxy, since
 * noaa.gov is allowlisted), parses each Placemark, and renders a camera-icon
 * marker whose popup shows the latest panoramic camera image.
 *
 * Source: https://www.ndbc.noaa.gov/kml/buoycams_as_kml.php
 * ~94 stations; the KML refreshes every 30 minutes.
 */

const KML_URL = 'https://www.ndbc.noaa.gov/kml/buoycams_as_kml.php';
const PROXY_URL = `/api/proxy?url=${KML_URL}`;
const REFRESH_MS = 30 * 60 * 1000; // 30 minutes (matches the KML refreshInterval)

let _markers = [];
let _wrapper = null;
let _active = false;
let _timer = null;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Parse the KML into an array of { id, label, imgUrl, lat, lon }.
function parseKML(text) {
  const cams = [];
  // Split on <Placemark> blocks — simple but robust for this well-structured KML.
  const blocks = text.split(/<Placemark>/i).slice(1);
  for (const block of blocks) {
    const nameM = block.match(/<name>([^<]*)<\/name>/i);
    const snippetM = block.match(/<Snippet>([^<]*)<\/Snippet>/i);
    const coordM = block.match(/<coordinates>([^<]*)<\/coordinates>/i);
    const imgM = block.match(/src="(https?:\/\/[^"]+\.jpg)"/i);
    if (!coordM) continue;
    const parts = coordM[1].trim().split(',');
    const lon = +parts[0], lat = +parts[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = nameM ? nameM[1].trim() : '';
    // Snippet: "Station 41001 - EAST HATTERAS - 150 NM East of Cape Hatteras"
    // Strip the leading "Station XXXXX - " to get the human-readable label.
    let label = snippetM ? snippetM[1].trim() : id;
    label = label.replace(/^Station\s+\S+\s*-\s*/i, '');
    // Extract timestamp from description text ("picture taken at MM/DD/YYYY HHMM UTC")
    const timeM = block.match(/picture taken at\s+([^<]+?)(?:<|$)/i);
    const time = timeM ? timeM[1].trim() : '';
    cams.push({ id, label, imgUrl: imgM ? imgM[1] : null, lat, lon, time });
  }
  return cams;
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

function render(cams) {
  clearMarkers();
  const gl = window.maplibregl || window.mapboxgl;
  if (!gl) return;
  for (const cam of cams) {
    const imgTag = cam.imgUrl
      ? `<img class="bcam-pop-img" src="${escapeHtml(cam.imgUrl)}" alt="BuoyCAM ${escapeHtml(cam.id)}" loading="lazy">`
      : '<div class="bcam-pop-noimg">No image available</div>';
    const html = `<div class="bcam-pop">`
      + `<div class="bcam-pop-title">${escapeHtml(cam.id)} — ${escapeHtml(cam.label)}</div>`
      + imgTag
      + (cam.time ? `<div class="bcam-pop-time">${escapeHtml(cam.time)}</div>` : '')
      + `</div>`;
    for (const map of targetMaps()) {
      const el = document.createElement('div');
      el.className = 'bcam-marker';
      el.title = `${cam.id} — ${cam.label}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        new gl.Popup({ closeButton: true, closeOnClick: true, className: 'bcam-popup', maxWidth: '340px' })
          .setLngLat([cam.lon, cam.lat])
          .setHTML(html)
          .addTo(map);
      });
      const marker = new gl.Marker({ element: el, anchor: 'center' }).setLngLat([cam.lon, cam.lat]).addTo(map);
      _markers.push(marker);
    }
  }
}

async function load() {
  if (!_active) return;
  try {
    const res = await fetch(PROXY_URL, { cache: 'no-store' });
    if (!res.ok || !_active) return;
    const text = await res.text();
    if (!_active) return;
    // Guard against non-KML responses (transient errors served as HTML).
    if (!/<kml/i.test(text)) return;
    render(parseKML(text));
  } catch (err) {
    console.error('[BuoyCAMs] load failed:', err);
  }
}

export function addBuoyCams(mapWrapper) {
  _wrapper = mapWrapper || window.vortexMap;
  _active = true;
  load();
  clearInterval(_timer);
  _timer = setInterval(() => { if (_active) load(); }, REFRESH_MS);
}

export function removeBuoyCams() {
  _active = false;
  clearInterval(_timer);
  _timer = null;
  clearMarkers();
}

// Repaint onto/off the dual pane when split screen toggles.
window.addEventListener('vortexsplitchange', () => { if (_active) load(); });
