/*
 * eoc.js — VORTEX EOC MODE controller.
 *
 * Aggregates what the app already knows into one operations board:
 *
 *   /api/eoc/overview     active warnings + population affected   (30s poll)
 *   /api/reports/stream   damage & field reports                  (SSE, live)
 *   /api/spotters/positions   spotter locations                   (60s poll)
 *   /api/outages/live     power outages                           (5m poll)
 *   /api/eoc/facilities   hospitals / schools / shelters          (on demand)
 *   /api/storms           storm tracks from the rotation engine   (60s poll)
 *
 * DESIGN RULE: every panel says where its number came from and when. An
 * operations screen that shows a confident number it can no longer refresh is
 * worse than one that says it is stale — decisions get made off these figures.
 */

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

/* ── map ──────────────────────────────────────────────────────────────────── */

mapboxgl.accessToken = window.MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: 'eoc-map',
  style: 'mapbox://styles/mapbox/dark-v11',
  center: [-97.5, 38.5],
  zoom: 4.2,
  attributionControl: false,
});
map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

let mapReady = false;
map.on('load', () => {
  mapReady = true;
  installLayers();
  refreshAll();
});

const state = {
  warnings: [],
  filter: 'all',
  reports: [],
  spotters: [],
  storms: [],
  facilities: [],
  overview: null,
};

/* ── layer scaffolding ─────────────────────────────────────────────────────
 * Sources are created empty once and fed with setData afterwards. Adding and
 * removing layers as data arrives is what makes map code flicker and leak.
 */
function installLayers() {
  const empty = { type: 'FeatureCollection', features: [] };

  map.addSource('warn-polys', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'warn-fill', type: 'fill', source: 'warn-polys',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 },
  });
  map.addLayer({
    id: 'warn-line', type: 'line', source: 'warn-polys',
    paint: { 'line-color': ['get', 'color'], 'line-width': 2 },
  });

  map.addSource('facilities', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'facility-dots', type: 'circle', source: 'facilities',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 7],
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 1,
      'circle-stroke-color': 'rgba(0,0,0,0.6)',
    },
  });

  map.addSource('reports', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'report-dots', type: 'circle', source: 'reports',
    paint: {
      'circle-radius': 6,
      'circle-color': '#ff7a1a',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#0b0e13',
    },
  });

  map.addSource('spotters', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'spotter-dots', type: 'circle', source: 'spotters',
    paint: {
      'circle-radius': 4,
      'circle-color': '#35d07f',
      'circle-stroke-width': 1,
      'circle-stroke-color': '#0b0e13',
    },
  });

  for (const id of ['facility-dots', 'report-dots', 'spotter-dots']) {
    map.on('click', id, (e) => {
      const p = e.features[0].properties;
      new mapboxgl.Popup({ closeButton: false })
        .setLngLat(e.lngLat)
        .setHTML(`<div style="font:600 12px system-ui;color:#111">${escapeHtml(p.label || p.name || '')}</div>
                  <div style="font:11px system-ui;color:#555">${escapeHtml(p.sub || '')}</div>`)
        .addTo(map);
    });
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }

  // Facilities are fetched per view, so reload when the operator settles
  // somewhere new. Debounced: 'moveend' fires on every flick of the wheel.
  let moveTimer = null;
  map.on('moveend', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(loadFacilities, 500);
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const SEVERITY_COLOR = {
  Extreme: '#ff2d55', Severe: '#ff7a1a', Moderate: '#ffd23f', Minor: '#4da3ff',
};
const FACILITY_COLOR = {
  hospital: '#ff2d55', school: '#ffd23f', shelter: '#35d07f',
  fire: '#ff7a1a', police: '#4da3ff', power: '#b47cff', eoc: '#ffffff',
};
const FACILITY_LABEL = {
  hospital: 'Hospitals', school: 'Schools', shelter: 'Shelters',
  fire: 'Fire stations', police: 'Police', power: 'Power substations', eoc: 'Emergency ops',
};

/* ── warnings + population ────────────────────────────────────────────────── */

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'tornado', label: 'Tornado', match: (e) => /tornado/i.test(e) },
  { id: 'severe', label: 'Severe TS', match: (e) => /severe thunderstorm/i.test(e) },
  { id: 'flood', label: 'Flood', match: (e) => /flood/i.test(e) },
  { id: 'winter', label: 'Winter', match: (e) => /(winter|snow|ice|blizzard)/i.test(e) },
  { id: 'tropical', label: 'Tropical', match: (e) => /(hurricane|tropical|storm surge)/i.test(e) },
  { id: 'land', label: 'Land only', match: (e, w) => w.counties.length > w.marineZones },
];

function buildFilters() {
  const wrap = $('warn-filters');
  wrap.innerHTML = '';
  for (const f of FILTERS) {
    const b = document.createElement('button');
    b.className = 'chip' + (state.filter === f.id ? ' on' : '');
    b.textContent = f.label;
    b.onclick = () => { state.filter = f.id; buildFilters(); renderWarnings(); };
    wrap.appendChild(b);
  }
}

function visibleWarnings() {
  const f = FILTERS.find((x) => x.id === state.filter);
  if (!f || !f.match) return state.warnings;
  return state.warnings.filter((w) => f.match(w.event || '', w));
}

function renderWarnings() {
  const list = visibleWarnings();
  $('warn-count').textContent = fmt.format(list.length);
  const box = $('warn-list');

  if (!list.length) {
    box.innerHTML = '<div class="empty">No active warnings match this filter.</div>';
    return;
  }

  box.innerHTML = '';
  // Cap the DOM. 300+ live rows is a scroll nobody reads and a render cost on
  // every poll; the list is priority-sorted, so the tail is the least urgent.
  for (const w of list.slice(0, 120)) {
    const el = document.createElement('div');
    const emergency = /emergency/i.test(w.event || '')
      || /^(OBSERVED|CONFIRMED)$/i.test(w.tornadoDetection || '')
      || /CATASTROPHIC/i.test(w.damageThreat || '');
    el.className = `warn sev-${w.severity || 'Unknown'}${emergency ? ' emergency' : ''}`;
    el.innerHTML =
      `<div class="warn-top">
         <span class="warn-event">${escapeHtml(w.event)}</span>
         <span class="warn-time">${expiryText(w.expires)}</span>
       </div>
       <div class="warn-area">${escapeHtml(w.areaDesc || '')}</div>
       <div class="warn-meta">
         <span>${fmt.format(w.population)} pop</span>
         <span>${w.counties.length} zone${w.counties.length === 1 ? '' : 's'}</span>
         ${w.damageThreat ? `<span class="warn-tag">${escapeHtml(w.damageThreat)}</span>` : ''}
         ${w.tornadoDetection ? `<span class="warn-tag">${escapeHtml(w.tornadoDetection)}</span>` : ''}
       </div>`;
    el.onclick = () => focusWarning(w);
    box.appendChild(el);
  }
  if (list.length > 120) {
    const more = document.createElement('div');
    more.className = 'empty';
    more.textContent = `+ ${fmt.format(list.length - 120)} more, lower priority`;
    box.appendChild(more);
  }
}

function expiryText(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!isFinite(ms)) return '';
  if (ms <= 0) return 'expired';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

/**
 * Centre the map on a warning.
 *
 * Most warnings have no polygon (measured: 33 of 310), so the counties are the
 * only geometry available. Rather than ship county shapes to the browser just
 * for this, fly to the alert's area by name is unreliable — instead we use the
 * polygon when there is one, and otherwise leave the map alone and say so.
 */
function focusWarning(w) {
  const note = $('map-note');
  if (!w.hasPolygon) {
    note.textContent = `${w.event} — ${w.areaDesc}. This warning is issued by county, not by polygon, so there is no shape to zoom to.`;
    return;
  }
  const feat = (state.warnPolys || []).find((f) => f.properties.id === w.id);
  if (!feat) { note.textContent = ''; return; }
  const b = bboxOf(feat.geometry);
  if (b) map.fitBounds(b, { padding: 80, duration: 700 });
  note.textContent = `${w.event} — ${w.areaDesc}`;
}

function bboxOf(geom) {
  let W = Infinity, S = Infinity, E = -Infinity, N = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < W) W = c[0]; if (c[0] > E) E = c[0];
      if (c[1] < S) S = c[1]; if (c[1] > N) N = c[1];
    } else c.forEach(walk);
  };
  if (!geom || !geom.coordinates) return null;
  walk(geom.coordinates);
  return isFinite(W) ? [[W, S], [E, N]] : null;
}

async function loadOverview() {
  try {
    const r = await fetch('/api/eoc/overview', { cache: 'no-store' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const o = await r.json();
    state.overview = o;
    state.warnings = o.warnings || [];

    $('stat-warnings').textContent = fmt.format(o.counts.total);
    $('stat-population').textContent = fmt.format(o.populationAffected.total);
    $('stat-counties').textContent = fmt.format(o.populationAffected.counties);

    const banner = $('stale-banner');
    if (o.stale) {
      banner.hidden = false;
      banner.textContent = `SHOWING LAST GOOD DATA — warning feed unreachable (${o.staleReason}). Fetched ${new Date(o.fetchedAt).toLocaleTimeString()}.`;
      $('feed-dot').className = 'eoc-dot stale';
    } else {
      banner.hidden = true;
      $('feed-dot').className = 'eoc-dot live';
    }

    buildFilters();
    renderWarnings();
    loadWarningPolygons();
  } catch (e) {
    $('feed-dot').className = 'eoc-dot down';
    const banner = $('stale-banner');
    banner.hidden = false;
    banner.textContent = `WARNING FEED DOWN — ${e.message}`;
  }
}

/*
 * Polygons come straight from weather.gov rather than through our overview,
 * because the overview deliberately strips geometry: sending 300 alerts with
 * their shapes and full text would be a multi-megabyte poll for a list that
 * only needs a headline per row.
 */
async function loadWarningPolygons() {
  try {
    const r = await fetch('https://api.weather.gov/alerts/active?severity=Extreme,Severe', {
      headers: { Accept: 'application/geo+json' },
    });
    if (!r.ok) return;
    const j = await r.json();
    const feats = (j.features || [])
      .filter((f) => f.geometry)
      .map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          id: f.properties.id,
          color: SEVERITY_COLOR[f.properties.severity] || '#8996a6',
          label: f.properties.event,
          sub: f.properties.areaDesc,
        },
      }));
    state.warnPolys = feats;
    if (mapReady) map.getSource('warn-polys').setData({ type: 'FeatureCollection', features: feats });
  } catch (e) {
    /* polygons are a nicety; the list is the product */
  }
}

/* ── field reports (live) ─────────────────────────────────────────────────── */

function renderReports() {
  $('report-count').textContent = fmt.format(state.reports.length);
  $('stat-reports').textContent = fmt.format(state.reports.length);
  const box = $('report-list');
  if (!state.reports.length) {
    box.innerHTML = '<div class="empty">No reports yet.</div>';
  } else {
    box.innerHTML = '';
    for (const rep of state.reports.slice(0, 40)) {
      const el = document.createElement('div');
      el.className = 'rep' + (rep.__fresh ? ' fresh' : '');
      rep.__fresh = false;
      const when = rep.time ? new Date(rep.time).toLocaleTimeString() : '';
      el.innerHTML = `<div class="rep-type">${escapeHtml(rep.type || 'Report')}</div>
                      <div class="rep-sub">${escapeHtml(rep.place || rep.notes || '')} · ${when}</div>`;
      el.onclick = () => {
        if (Number.isFinite(rep.lat) && Number.isFinite(rep.lng)) {
          map.flyTo({ center: [rep.lng, rep.lat], zoom: 9 });
        }
      };
      box.appendChild(el);
    }
  }

  const feats = state.reports
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: { label: r.type || 'Report', sub: r.place || r.notes || '' },
    }));
  if (mapReady) map.getSource('reports').setData({ type: 'FeatureCollection', features: feats });
}

async function loadReports() {
  try {
    const r = await fetch('/api/reports', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    state.reports = j.reports || [];
    renderReports();
  } catch (e) { /* the SSE stream below will fill in */ }
}

// Reports arrive live; the poll above is only the initial fill. Same stream the
// radar page uses, so a report logged in the field shows here immediately.
function openReportStream() {
  let es;
  try { es = new EventSource('/api/reports/stream'); } catch (e) { return; }
  es.addEventListener('report-added', (ev) => {
    try {
      const rep = JSON.parse(ev.data);
      rep.__fresh = true;
      state.reports.unshift(rep);
      renderReports();
    } catch (e) { /* ignore a malformed frame */ }
  });
  es.addEventListener('report-removed', (ev) => {
    try {
      const { id } = JSON.parse(ev.data);
      state.reports = state.reports.filter((r) => r.id !== id);
      renderReports();
    } catch (e) { /* ignore */ }
  });
  // EventSource reconnects on its own; nothing to do but note it.
  es.onerror = () => { /* browser retries */ };
}

/* ── spotters, storms, outages, facilities ────────────────────────────────── */

async function loadSpotters() {
  try {
    const r = await fetch('/api/spotters/positions', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    const list = Array.isArray(j) ? j : (j.positions || j.reports || []);
    state.spotters = list;
    $('stat-spotters').textContent = fmt.format(list.length);
    const feats = list
      .filter((s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon || s.lng)))
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(s.lon || s.lng), Number(s.lat)] },
        properties: { label: s.name || s.callsign || 'Spotter', sub: s.note || s.active || '' },
      }));
    if (mapReady) map.getSource('spotters').setData({ type: 'FeatureCollection', features: feats });
  } catch (e) { /* optional layer */ }
}

async function loadStorms() {
  try {
    const r = await fetch('/api/storms', { cache: 'no-store' });
    if (!r.ok) { $('storm-list').innerHTML = '<div class="empty">Rotation engine is off.</div>'; return; }
    const j = await r.json();
    const storms = j.storms || [];
    state.storms = storms;
    $('storm-count').textContent = fmt.format(storms.length);
    $('storm-list').innerHTML = storms.length
      ? storms.slice(0, 20).map((s) => (
        `<div class="rep"><div class="rep-type">${escapeHtml(s.id || 'Cell')}</div>
         <div class="rep-sub">${escapeHtml(s.site || '')} · ${s.score != null ? 'score ' + s.score : ''}</div></div>`
      )).join('')
      : '<div class="empty">No tracked cells.</div>';
  } catch (e) {
    $('storm-list').innerHTML = '<div class="empty">Storm tracks unavailable.</div>';
  }
}

async function loadOutages() {
  try {
    const r = await fetch('/api/outages/live', { cache: 'no-store' });
    if (!r.ok) {
      $('outage-body').innerHTML = `<div class="empty">${r.status === 403 ? 'Requires a Tier One subscription.' : 'Outage feed unavailable.'}</div>`;
      return;
    }
    const j = await r.json();
    // The upstream shape varies; count what looks like outage records and sum
    // any customer counts we can find rather than assuming one schema.
    const rows = Array.isArray(j) ? j : (j.data || j.outages || j.features || []);
    let customers = 0;
    for (const row of rows) {
      const n = Number(row.customers ?? row.customersOut ?? row.cust_a?.val ?? (row.properties && row.properties.customers));
      if (Number.isFinite(n)) customers += n;
    }
    $('outage-count').textContent = fmt.format(rows.length);
    $('outage-body').innerHTML = customers
      ? `<div class="stat-num">${fmt.format(customers)}</div><div class="stat-lbl">Customers without power</div>`
      : `<div class="empty">${rows.length} outage areas reported.</div>`;
  } catch (e) {
    $('outage-body').innerHTML = '<div class="empty">Outage feed unavailable.</div>';
  }
}

const FACILITY_KINDS = ['hospital', 'school', 'shelter', 'fire', 'police', 'power'];

async function loadFacilities() {
  if (!mapReady) return;
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  if (bbox[2] - bbox[0] > 8 || bbox[3] - bbox[1] > 8) {
    $('fac-summary').innerHTML = '<div class="empty">Zoom in to load hospitals, schools and shelters.</div>';
    $('fac-count').textContent = '—';
    map.getSource('facilities').setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  $('fac-summary').innerHTML = '<div class="empty">Loading facilities…</div>';
  try {
    const qs = new URLSearchParams({ bbox: bbox.map((n) => n.toFixed(4)).join(','), kinds: FACILITY_KINDS.join(',') });
    const r = await fetch(`/api/eoc/facilities?${qs}`, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);

    state.facilities = j.facilities || [];
    $('fac-count').textContent = fmt.format(state.facilities.length);

    const counts = {};
    for (const f of state.facilities) counts[f.kind] = (counts[f.kind] || 0) + 1;
    $('fac-summary').innerHTML =
      FACILITY_KINDS.map((k) => (
        `<div class="fac-row">
           <span class="fac-key"><span class="fac-swatch" style="background:${FACILITY_COLOR[k]}"></span>${FACILITY_LABEL[k]}</span>
           <span class="fac-n">${fmt.format(counts[k] || 0)}</span>
         </div>`
      )).join('')
      // Say where this comes from and what that implies. An operator must not
      // read an empty Shelters row as "there are none".
      + `<div class="fac-src">In view, from OpenStreetMap. Coverage varies by area — a facility absent from the map is absent here.</div>`;

    map.getSource('facilities').setData({
      type: 'FeatureCollection',
      features: state.facilities.map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
        properties: {
          color: FACILITY_COLOR[f.kind] || '#8996a6',
          label: f.name || FACILITY_LABEL[f.kind],
          sub: [FACILITY_LABEL[f.kind], f.beds ? `${f.beds} beds` : null, f.phone].filter(Boolean).join(' · '),
        },
      })),
    });
  } catch (e) {
    $('fac-summary').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

/* ── clock + scheduling ───────────────────────────────────────────────────── */

function tickClock() {
  const d = new Date();
  $('clock-local').textContent = d.toLocaleTimeString('en-US', { hour12: false });
  $('clock-utc').textContent = d.toISOString().slice(11, 16) + 'Z';
}
setInterval(tickClock, 1000);
tickClock();

function refreshAll() {
  loadOverview();
  loadReports();
  loadSpotters();
  loadStorms();
  loadOutages();
  loadFacilities();
}

// Staggered so a board left running does not fire every request at once.
setInterval(loadOverview, 30 * 1000);
setInterval(loadSpotters, 60 * 1000);
setInterval(loadStorms, 60 * 1000);
setInterval(loadOutages, 5 * 60 * 1000);

openReportStream();

$('btn-cams').onclick = async () => {
  try {
    const cams = await import('../components/cams.js');
    (cams.default || cams.openCams)();
  } catch (e) {
    $('map-note').textContent = 'Camera list unavailable: ' + e.message;
  }
};

// If the map never loads (blocked CDN, bad token), the panels still work — say
// so rather than leaving a black rectangle.
setTimeout(() => {
  if (!mapReady) $('map-note').textContent = 'Map unavailable — panels below are still live.';
}, 8000);
