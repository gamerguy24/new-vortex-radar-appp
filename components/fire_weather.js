/*
 * components/fire_weather.js
 * Fire weather layers from PlaceFileNation placefiles:
 *   - Fire Danger Monitor  (METAR-based station markers, colored by risk)
 *   - Day 1 Fire Wx        (SPC fire weather outlook polygons)
 *   - Day 2 Fire Wx        (SPC fire weather outlook polygons)
 *   - Wildfires             (InciWeb reported fire locations)
 *
 * All fetched through /api/proxy (placefilenation.com is allowlisted).
 * Each placefile requires ?version=1.5&lat=..&lon=.. to bypass the GR guard.
 * Fire Danger Monitor is centered on the map center and re-fetches on pan.
 */

const CFG = {
  fireDanger: {
    url: 'https://placefilenation.com/Placefiles/fire_danger_monitor.php',
    refreshMs: 7 * 60 * 1000,
    refetchDeg: 1.5,
  },
  day1: {
    url: 'https://placefilenation.com/Placefiles/day1firewx.php',
    refreshMs: 15 * 60 * 1000,
  },
  day2: {
    url: 'https://placefilenation.com/Placefiles/day2firewx.php',
    refreshMs: 15 * 60 * 1000,
  },
  wildfires: {
    url: 'https://placefilenation.com/Placefiles/wildfire_placefile.php',
    refreshMs: 3 * 60 * 1000,
  },
};

function mkState() {
  return {
    markers: [], wrapper: null, active: false, timer: null,
    lastCenter: null, moveHandler: null, moveMap: null, moveDebounce: null,
    lastData: null,
  };
}
const _s = {};
for (const k of Object.keys(CFG)) _s[k] = mkState();

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function getMaps(st) {
  const w = st.wrapper || window.vortexMap || {};
  const out = [];
  if (w.map) out.push(w.map);
  if ((typeof w.isSplit === 'function' ? w.isSplit() : false) && w.dualMap) out.push(w.dualMap);
  return out;
}

function getCenter(st) {
  const map = (st.wrapper || window.vortexMap || {}).map;
  if (map && typeof map.getCenter === 'function') {
    const c = map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }
  return { lat: 35, lon: -98 };
}

function clearMarkers(st) {
  st.markers.forEach(m => { try { m.remove(); } catch (e) {} });
  st.markers = [];
}

function proxyUrl(key, st) {
  const c = getCenter(st);
  return `/api/proxy?url=${CFG[key].url}?version=1.5&lat=${c.lat.toFixed(3)}&lon=${c.lon.toFixed(3)}`;
}

/* ===== Parsers ===== */

function parseFireDanger(text) {
  const out = [];
  let color = '#dc2828';
  for (const line of text.split(/\r?\n/)) {
    const cm = line.match(/^\s*Color:\s*(\d+)\s+(\d+)\s+(\d+)/i);
    if (cm) { color = `rgb(${cm[1]},${cm[2]},${cm[3]})`; continue; }
    const tm = line.match(/^\s*Text:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*\d+\s*,\s*"([^"]*)"(?:\s*,\s*"([^"]*)")?/i);
    if (tm) {
      const hover = (tm[4] || '').split('\\n').map(s => s.trim()).filter(Boolean);
      out.push({ lat: +tm[1], lon: +tm[2], label: tm[3], color, lines: hover });
    }
  }
  return out;
}

function parseOutlook(text) {
  const polys = [];
  let stroke = '#e68a00', fill = 'rgba(230,138,0,0.25)';
  let inLine = false, coords = [], title = '';
  for (const line of text.split(/\r?\n/)) {
    const cm = line.match(/^\s*Color:\s*(\d+)\s+(\d+)\s+(\d+)/i);
    if (cm) {
      stroke = `rgb(${cm[1]},${cm[2]},${cm[3]})`;
      fill = `rgba(${cm[1]},${cm[2]},${cm[3]},0.25)`;
      continue;
    }
    const lm = line.match(/^\s*Line:\s*\d+\s*,\s*\d+\s*,\s*"([^"]*)"/i);
    if (lm) { inLine = true; coords = []; title = lm[1]; continue; }
    if (/^\s*End:/i.test(line)) {
      if (inLine && coords.length >= 3) {
        const [fx, fy] = coords[0], [lx, ly] = coords[coords.length - 1];
        if (fx !== lx || fy !== ly) coords.push([fx, fy]);
        polys.push({ coords, fill, stroke, title });
      }
      inLine = false; coords = []; continue;
    }
    if (inLine) {
      const cm2 = line.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
      if (cm2) coords.push([+cm2[2], +cm2[1]]); // [lon, lat] for GeoJSON
    }
  }
  return polys;
}

function parseWildfires(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const im = line.match(/^\s*Icon:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*"([^"]*)"/i);
    if (im) out.push({ lat: +im[1], lon: +im[2], label: im[3] });
  }
  return out;
}

/* ===== Renderers ===== */

function renderFireDanger(entries, st) {
  clearMarkers(st);
  const gl = window.maplibregl || window.mapboxgl;
  if (!gl) return;
  for (const e of entries) {
    for (const map of getMaps(st)) {
      const el = document.createElement('div');
      el.className = 'fwx-danger-marker';
      el.style.background = e.color;
      el.title = e.label;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const body = e.lines.map(l => `<div class="fwx-pop-line">${esc(l)}</div>`).join('');
        new gl.Popup({ closeButton: true, closeOnClick: true, className: 'fwx-popup', maxWidth: '280px' })
          .setLngLat([e.lon, e.lat])
          .setHTML(`<div class="fwx-pop"><div class="fwx-pop-title" style="color:${e.color}">${esc(e.label)}</div>${body}</div>`)
          .addTo(map);
      });
      st.markers.push(new gl.Marker({ element: el, anchor: 'center' }).setLngLat([e.lon, e.lat]).addTo(map));
    }
  }
}

function removeGeoLayers(key) {
  const st = _s[key];
  const srcId = `fwx-${key}-src`;
  const fillId = `fwx-${key}-fill`;
  const lineId = `fwx-${key}-line`;
  for (const map of getMaps(st)) {
    try { if (map.getLayer(lineId)) map.removeLayer(lineId); } catch (e) {}
    try { if (map.getLayer(fillId)) map.removeLayer(fillId); } catch (e) {}
    try { if (map.getSource(srcId)) map.removeSource(srcId); } catch (e) {}
  }
}

function renderOutlook(polys, key) {
  const st = _s[key];
  removeGeoLayers(key);
  if (!polys.length) return;
  const gl = window.maplibregl || window.mapboxgl;
  if (!gl) return;

  const srcId = `fwx-${key}-src`;
  const fillId = `fwx-${key}-fill`;
  const lineId = `fwx-${key}-line`;

  const geojson = {
    type: 'FeatureCollection',
    features: polys.map(p => ({
      type: 'Feature',
      properties: { fill: p.fill, stroke: p.stroke, title: p.title },
      geometry: { type: 'Polygon', coordinates: [p.coords] },
    })),
  };

  for (const map of getMaps(st)) {
    try { if (map.getSource(srcId)) map.removeSource(srcId); } catch (e) {}
    map.addSource(srcId, { type: 'geojson', data: geojson });
    map.addLayer({
      id: fillId, type: 'fill', source: srcId,
      paint: { 'fill-color': ['get', 'fill'] },
    });
    map.addLayer({
      id: lineId, type: 'line', source: srcId,
      paint: { 'line-color': ['get', 'stroke'], 'line-width': 2 },
    });
    map.on('click', fillId, (ev) => {
      const f = ev.features && ev.features[0];
      if (!f) return;
      new gl.Popup({ closeButton: true, closeOnClick: true, className: 'fwx-popup', maxWidth: '300px' })
        .setLngLat(ev.lngLat)
        .setHTML(`<div class="fwx-pop"><div class="fwx-pop-title" style="color:${f.properties.stroke}">${esc(f.properties.title)}</div></div>`)
        .addTo(map);
    });
    map.on('mouseenter', fillId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', fillId, () => { map.getCanvas().style.cursor = ''; });
  }
}

function renderWildfires(fires, st) {
  clearMarkers(st);
  const gl = window.maplibregl || window.mapboxgl;
  if (!gl) return;
  for (const f of fires) {
    for (const map of getMaps(st)) {
      const el = document.createElement('div');
      el.className = 'fwx-fire-marker';
      el.title = f.label;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        new gl.Popup({ closeButton: true, closeOnClick: true, className: 'fwx-popup', maxWidth: '280px' })
          .setLngLat([f.lon, f.lat])
          .setHTML(`<div class="fwx-pop"><div class="fwx-pop-title fwx-pop-fire">${esc(f.label)}</div></div>`)
          .addTo(map);
      });
      st.markers.push(new gl.Marker({ element: el, anchor: 'center' }).setLngLat([f.lon, f.lat]).addTo(map));
    }
  }
}

/* ===== Loaders ===== */

async function loadFireDanger() {
  const st = _s.fireDanger;
  if (!st.active) return;
  st.lastCenter = getCenter(st);
  try {
    const res = await fetch(proxyUrl('fireDanger', st), { cache: 'no-store' });
    if (!res.ok || !st.active) return;
    const text = await res.text();
    if (!st.active || /^\s*</.test(text)) return;
    st.lastData = parseFireDanger(text);
    renderFireDanger(st.lastData, st);
  } catch (e) { console.error('[FireDanger] load:', e); }
}

async function loadOutlook(key) {
  const st = _s[key];
  if (!st.active) return;
  try {
    const res = await fetch(proxyUrl(key, st), { cache: 'no-store' });
    if (!res.ok || !st.active) return;
    const text = await res.text();
    if (!st.active || /^\s*</.test(text)) return;
    st.lastData = parseOutlook(text);
    renderOutlook(st.lastData, key);
  } catch (e) { console.error(`[FireWx:${key}] load:`, e); }
}

async function loadWildfires() {
  const st = _s.wildfires;
  if (!st.active) return;
  try {
    const res = await fetch(proxyUrl('wildfires', st), { cache: 'no-store' });
    if (!res.ok || !st.active) return;
    const text = await res.text();
    if (!st.active || /^\s*</.test(text)) return;
    st.lastData = parseWildfires(text);
    renderWildfires(st.lastData, st);
  } catch (e) { console.error('[Wildfires] load:', e); }
}

/* ===== Pan handler (fire danger only — centered on map view) ===== */

function onFireDangerMove() {
  const st = _s.fireDanger;
  clearTimeout(st.moveDebounce);
  st.moveDebounce = setTimeout(() => {
    if (!st.active || !st.lastCenter) return;
    const c = getCenter(st);
    if (Math.abs(c.lat - st.lastCenter.lat) > CFG.fireDanger.refetchDeg ||
        Math.abs(c.lon - st.lastCenter.lon) > CFG.fireDanger.refetchDeg) {
      loadFireDanger();
    }
  }, 800);
}

/* ===== Public API ===== */

export function addFireDanger(mapWrapper) {
  const st = _s.fireDanger;
  st.wrapper = mapWrapper || window.vortexMap;
  st.active = true;
  loadFireDanger();
  clearInterval(st.timer);
  st.timer = setInterval(() => { if (st.active) loadFireDanger(); }, CFG.fireDanger.refreshMs);
  const map = (st.wrapper || {}).map || null;
  if (map && !st.moveHandler) {
    st.moveHandler = onFireDangerMove;
    st.moveMap = map;
    map.on('moveend', st.moveHandler);
  }
}

export function removeFireDanger() {
  const st = _s.fireDanger;
  st.active = false;
  clearInterval(st.timer); st.timer = null;
  clearTimeout(st.moveDebounce);
  if (st.moveMap && st.moveHandler) { try { st.moveMap.off('moveend', st.moveHandler); } catch (e) {} }
  st.moveHandler = null; st.moveMap = null;
  clearMarkers(st);
  st.lastData = null;
}

export function addDay1FireWx(mapWrapper) {
  const st = _s.day1;
  st.wrapper = mapWrapper || window.vortexMap;
  st.active = true;
  loadOutlook('day1');
  clearInterval(st.timer);
  st.timer = setInterval(() => { if (st.active) loadOutlook('day1'); }, CFG.day1.refreshMs);
}

export function removeDay1FireWx() {
  const st = _s.day1;
  st.active = false;
  clearInterval(st.timer); st.timer = null;
  removeGeoLayers('day1');
  st.lastData = null;
}

export function addDay2FireWx(mapWrapper) {
  const st = _s.day2;
  st.wrapper = mapWrapper || window.vortexMap;
  st.active = true;
  loadOutlook('day2');
  clearInterval(st.timer);
  st.timer = setInterval(() => { if (st.active) loadOutlook('day2'); }, CFG.day2.refreshMs);
}

export function removeDay2FireWx() {
  const st = _s.day2;
  st.active = false;
  clearInterval(st.timer); st.timer = null;
  removeGeoLayers('day2');
  st.lastData = null;
}

export function addWildfires(mapWrapper) {
  const st = _s.wildfires;
  st.wrapper = mapWrapper || window.vortexMap;
  st.active = true;
  loadWildfires();
  clearInterval(st.timer);
  st.timer = setInterval(() => { if (st.active) loadWildfires(); }, CFG.wildfires.refreshMs);
}

export function removeWildfires() {
  const st = _s.wildfires;
  st.active = false;
  clearInterval(st.timer); st.timer = null;
  clearMarkers(st);
  st.lastData = null;
}

window.addEventListener('vortexsplitchange', () => {
  for (const key of Object.keys(CFG)) {
    const st = _s[key];
    if (!st.active || !st.lastData) continue;
    if (key === 'fireDanger') renderFireDanger(st.lastData, st);
    else if (key === 'day1' || key === 'day2') renderOutlook(st.lastData, key);
    else if (key === 'wildfires') renderWildfires(st.lastData, st);
  }
});
