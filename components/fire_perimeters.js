/*
 * components/fire_perimeters.js
 * Live wildfire footprint — what has actually burned.
 *
 * Complements components/fire_weather.js rather than replacing it. That module
 * draws fire DANGER, the SPC fire weather outlooks and InciWeb fire POINTS from
 * placefiles; none of them show the burned area. These two layers come from the
 * interagency NIFC feeds through /api/fire/*, where the polygons are simplified
 * and cached (see backend/fire/index.js — the raw national set is 39 MB).
 *
 *   Fire Perimeters   burned-area polygons, shaded by containment
 *   Active Fires      incident points sized by acreage
 *
 * Containment drives the colour, because that is the number that says whether a
 * fire is still a threat: an uncontained 5,000-acre fire matters more than a
 * 100,000-acre one that is 95% held.
 */

const PERIM_SRC = 'vx-fire-perimeters-src';
const PERIM_FILL = 'vx-fire-perimeters-fill';
const PERIM_LINE = 'vx-fire-perimeters-line';
const PT_SRC = 'vx-fire-points-src';
const PT_CIRCLE = 'vx-fire-points-circle';
const PT_LABEL = 'vx-fire-points-label';

const REFRESH_MS = 5 * 60 * 1000;   // matches the server-side cache
const state = { perimTimer: null, ptTimer: null, popup: null };

const fmt = (n) => (n == null ? null : Number(n).toLocaleString('en-US'));

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/* ── perimeters ───────────────────────────────────────────────────────────── */

export async function addFirePerimeters(w) {
  const map = w.map;
  if (map.getSource(PERIM_SRC)) return;

  map.addSource(PERIM_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer({
    id: PERIM_FILL,
    type: 'fill',
    source: PERIM_SRC,
    paint: {
      // Red while it is still burning, fading to grey as it is contained.
      'fill-color': [
        'interpolate', ['linear'], ['coalesce', ['get', 'contained'], 0],
        0, '#ff3b1f',
        50, '#ff8c1a',
        90, '#b06a3b',
        100, '#7a7a7a',
      ],
      'fill-opacity': 0.32,
    },
  });

  map.addLayer({
    id: PERIM_LINE,
    type: 'line',
    source: PERIM_SRC,
    paint: {
      'line-color': [
        'interpolate', ['linear'], ['coalesce', ['get', 'contained'], 0],
        0, '#ff5a3c', 100, '#9a9a9a',
      ],
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 10, 2.5],
    },
  });

  map.on('click', PERIM_FILL, onPerimClick);
  map.on('mouseenter', PERIM_FILL, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', PERIM_FILL, () => { map.getCanvas().style.cursor = ''; });

  await refreshPerimeters(map);
  clearInterval(state.perimTimer);
  state.perimTimer = setInterval(() => refreshPerimeters(map), REFRESH_MS);
}

async function refreshPerimeters(map) {
  try {
    const j = await getJson('/api/fire/perimeters');
    const src = map.getSource(PERIM_SRC);
    if (src) src.setData(j.geojson);
  } catch (e) {
    console.warn('[Fire] perimeters unavailable:', e.message);
  }
}

function onPerimClick(e) {
  const p = e.features && e.features[0] && e.features[0].properties;
  if (!p) return;
  showPopup(e.target, e.lngLat, [
    `<b>${escapeHtml(p.name)}</b>`,
    p.acres ? `${fmt(p.acres)} acres burned` : null,
    p.contained != null ? `${p.contained}% contained` : 'Containment unreported',
    p.cause && p.cause !== 'Undetermined' ? `Cause: ${escapeHtml(p.cause)}` : null,
  ]);
}

export function removeFirePerimeters(w) {
  const map = w && w.map;
  clearInterval(state.perimTimer);
  state.perimTimer = null;
  if (!map) return;
  map.off('click', PERIM_FILL, onPerimClick);
  for (const id of [PERIM_FILL, PERIM_LINE]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(PERIM_SRC)) map.removeSource(PERIM_SRC);
  closePopup();
}

/* ── incident points ──────────────────────────────────────────────────────── */

export async function addActiveFires(w) {
  const map = w.map;
  if (map.getSource(PT_SRC)) return;

  map.addSource(PT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer({
    id: PT_CIRCLE,
    type: 'circle',
    source: PT_SRC,
    paint: {
      // Area, not radius, should scale with acreage — a circle whose RADIUS is
      // proportional makes a 100k-acre fire look a hundred times a 1k one.
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        3, ['interpolate', ['linear'], ['sqrt', ['coalesce', ['get', 'acres'], 1]], 1, 2.5, 320, 9],
        9, ['interpolate', ['linear'], ['sqrt', ['coalesce', ['get', 'acres'], 1]], 1, 5, 320, 22],
      ],
      'circle-color': [
        'interpolate', ['linear'], ['coalesce', ['get', 'contained'], 0],
        0, '#ff3b1f', 50, '#ff9d24', 100, '#8d8d8d',
      ],
      'circle-opacity': 0.75,
      'circle-stroke-width': 1,
      'circle-stroke-color': 'rgba(0,0,0,0.55)',
    },
  });

  map.addLayer({
    id: PT_LABEL,
    type: 'symbol',
    source: PT_SRC,
    // Only name the fires worth naming, and only once zoomed in — 500 labels
    // across the country is a smear, not information.
    filter: ['>', ['coalesce', ['get', 'acres'], 0], 1000],
    minzoom: 5,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 11,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#ffd9c9',
      'text-halo-color': 'rgba(0,0,0,0.85)',
      'text-halo-width': 1.4,
    },
  });

  map.on('click', PT_CIRCLE, onPointClick);
  map.on('mouseenter', PT_CIRCLE, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', PT_CIRCLE, () => { map.getCanvas().style.cursor = ''; });

  await refreshFires(map);
  clearInterval(state.ptTimer);
  state.ptTimer = setInterval(() => refreshFires(map), REFRESH_MS);
}

async function refreshFires(map) {
  try {
    const j = await getJson('/api/fire/incidents');
    const src = map.getSource(PT_SRC);
    if (src) src.setData(j.geojson);
  } catch (e) {
    console.warn('[Fire] incidents unavailable:', e.message);
  }
}

function onPointClick(e) {
  const p = e.features && e.features[0] && e.features[0].properties;
  if (!p) return;
  const discovered = p.discovered ? new Date(p.discovered) : null;
  showPopup(e.target, e.lngLat, [
    `<b>${escapeHtml(p.name)}</b>${p.state ? ' — ' + escapeHtml(p.state) : ''}`,
    p.acres ? `${fmt(p.acres)} acres` : null,
    p.contained != null ? `${p.contained}% contained` : null,
    p.cause && p.cause !== 'Undetermined' ? `Cause: ${escapeHtml(p.cause)}` : null,
    discovered && !isNaN(discovered) ? `Reported ${discovered.toLocaleDateString()}` : null,
  ]);
}

export function removeActiveFires(w) {
  const map = w && w.map;
  clearInterval(state.ptTimer);
  state.ptTimer = null;
  if (!map) return;
  map.off('click', PT_CIRCLE, onPointClick);
  for (const id of [PT_LABEL, PT_CIRCLE]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(PT_SRC)) map.removeSource(PT_SRC);
  closePopup();
}

/* ── popup ────────────────────────────────────────────────────────────────── */

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showPopup(map, lngLat, lines) {
  closePopup();
  const body = lines.filter(Boolean).join('<br>');
  state.popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '260px' })
    .setLngLat(lngLat)
    .setHTML(`<div style="font:13px/1.5 system-ui,-apple-system,sans-serif;color:#111">${body}</div>`)
    .addTo(map);
}

function closePopup() {
  if (state.popup) { try { state.popup.remove(); } catch (e) {} state.popup = null; }
}
