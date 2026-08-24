/*
 * components/buoycams.js
 * NDBC BuoyCAM layer — live camera snapshots from ocean buoys.
 * Fetches the NDBC BuoyCAMs KML feed (through the app's server proxy, since
 * noaa.gov is allowlisted), parses each Placemark, and renders a camera-icon
 * marker whose popup shows the latest panoramic camera image and live
 * observation data (wind, waves, temperature, pressure) fetched on demand.
 *
 * Source: https://www.ndbc.noaa.gov/kml/buoycams_as_kml.php
 * ~94 stations; the KML refreshes every 30 minutes.
 */

const KML_URL = 'https://www.ndbc.noaa.gov/kml/buoycams_as_kml.php';
const PROXY_URL = `/api/proxy?url=${KML_URL}`;
const REFRESH_MS = 30 * 60 * 1000;

let _markers = [];
let _wrapper = null;
let _active = false;
let _timer = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function degToDir(deg) {
  const d = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return d[Math.round(deg / 22.5) % 16];
}
function msToKts(v) { return (v * 1.94384).toFixed(1); }
function mToFt(v) { return (v * 3.28084).toFixed(1); }
function cToF(v) { return (v * 1.8 + 32).toFixed(1); }

function parseKML(text) {
  const cams = [];
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
    const snippet = snippetM ? snippetM[1].trim() : '';
    const stripped = snippet.replace(/^Station\s+\S+\s*-\s*/i, '');
    const dashIdx = stripped.indexOf(' - ');
    const stationName = dashIdx > 0 ? stripped.slice(0, dashIdx) : stripped;
    const location = dashIdx > 0 ? stripped.slice(dashIdx + 3) : '';
    const timeM = block.match(/picture taken at\s+([^<]+?)(?:<|$)/i);
    const time = timeM ? timeM[1].trim() : '';
    cams.push({ id, stationName, location, imgUrl: imgM ? imgM[1] : null, lat, lon, time });
  }
  return cams;
}

function parseObservations(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
  if (!lines.length) return null;
  const cols = lines[0].trim().split(/\s+/);
  if (cols.length < 13) return null;
  const v = (i) => cols[i] === 'MM' ? null : +cols[i];
  return {
    wdir: v(5), wspd: v(6), gst: v(7),
    wvht: v(8), dpd: v(9), apd: v(10), mwd: v(11),
    pres: v(12), atmp: v(13), wtmp: v(14), dewp: v(15),
    vis: v(16),
  };
}

function obsWidget(label, value, sub) {
  if (value == null) return '';
  return `<div class="bcam-obs-item"><div class="bcam-obs-label">${label}</div><div class="bcam-obs-val">${value}</div>${sub ? `<div class="bcam-obs-sub">${sub}</div>` : ''}</div>`;
}

function renderObsHTML(obs) {
  const items = [];
  if (obs.wspd != null) {
    const dir = obs.wdir != null ? degToDir(obs.wdir) : '';
    const gust = obs.gst != null ? `G ${msToKts(obs.gst)} kts` : '';
    items.push(obsWidget('Wind', `${dir} ${msToKts(obs.wspd)} kts`, gust));
  }
  if (obs.wvht != null) {
    const per = obs.dpd != null ? `${obs.dpd}s period` : '';
    const wdir = obs.mwd != null ? `from ${degToDir(obs.mwd)}` : '';
    items.push(obsWidget('Waves', `${mToFt(obs.wvht)} ft`, [per, wdir].filter(Boolean).join(', ')));
  }
  if (obs.atmp != null) items.push(obsWidget('Air Temp', `${cToF(obs.atmp)}°F`, `${obs.atmp.toFixed(1)}°C`));
  if (obs.wtmp != null) items.push(obsWidget('Water Temp', `${cToF(obs.wtmp)}°F`, `${obs.wtmp.toFixed(1)}°C`));
  if (obs.pres != null) items.push(obsWidget('Pressure', `${obs.pres.toFixed(1)}`, 'hPa'));
  if (obs.dewp != null) items.push(obsWidget('Dew Point', `${cToF(obs.dewp)}°F`, `${obs.dewp.toFixed(1)}°C`));
  if (!items.length) return '<div class="bcam-obs-none">No observations available</div>';
  return `<div class="bcam-obs-grid">${items.join('')}</div>`;
}

async function fetchObs(stationId, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  try {
    const res = await fetch(`/api/proxy?url=https://www.ndbc.noaa.gov/data/realtime2/${stationId}.txt`, { cache: 'no-store' });
    if (!res.ok || !el.isConnected) { el.innerHTML = '<div class="bcam-obs-none">Observations unavailable</div>'; return; }
    const text = await res.text();
    if (!el.isConnected) return;
    if (/^\s*</.test(text)) { el.innerHTML = '<div class="bcam-obs-none">Observations unavailable</div>'; return; }
    const obs = parseObservations(text);
    el.innerHTML = obs ? renderObsHTML(obs) : '<div class="bcam-obs-none">No observations available</div>';
  } catch (e) {
    if (el.isConnected) el.innerHTML = '<div class="bcam-obs-none">Observations unavailable</div>';
  }
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
      ? `<img class="bcam-pop-img" src="${esc(cam.imgUrl)}" alt="BuoyCAM ${esc(cam.id)}">`
      : '<div class="bcam-pop-noimg">No image available</div>';
    for (const map of targetMaps()) {
      const el = document.createElement('div');
      el.className = 'bcam-marker';
      el.title = `${cam.id} — ${cam.stationName}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const obsId = `bcam-obs-${cam.id}-${Date.now()}`;
        const html = `<div class="bcam-pop">`
          + `<div class="bcam-pop-header">`
          + `<span class="bcam-pop-id">Station ${esc(cam.id)}</span>`
          + `<span class="bcam-pop-name">${esc(cam.stationName)}</span>`
          + `</div>`
          + (cam.location ? `<div class="bcam-pop-loc">${esc(cam.location)}</div>` : '')
          + imgTag
          + (cam.time ? `<div class="bcam-pop-time">Image: ${esc(cam.time)}</div>` : '')
          + `<div class="bcam-pop-divider"></div>`
          + `<div class="bcam-pop-obs-title">Latest Observations</div>`
          + `<div id="${obsId}"><div class="bcam-obs-loading">Loading…</div></div>`
          + `</div>`;
        new gl.Popup({ closeButton: true, closeOnClick: true, className: 'bcam-popup', maxWidth: '780px' })
          .setLngLat([cam.lon, cam.lat])
          .setHTML(html)
          .addTo(map);
        fetchObs(cam.id, obsId);
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
    // 402 = the server's Tier One gate (see PROXY_TIER_RULES in server.js).
    if (res.status === 402 && window.vortexProGate) {
      window.vortexProGate.denied('BuoyCAMs', 1, 'armrBuoyCamsSwitchElem');
      removeBuoyCams();
      return;
    }
    if (!res.ok || !_active) return;
    const text = await res.text();
    if (!_active) return;
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

window.addEventListener('vortexsplitchange', () => { if (_active) load(); });
