/*
 * pro.js — VORTEX PRO controller.
 *
 * The licensed workspace at /pro. Media edition: everything here answers one
 * of the three questions a newsroom weather desk actually asks during severe
 * weather, in this order:
 *
 *   1. Is anything happening in OUR market?          the coverage board
 *   2. Do we need to break programming right now?    the cut-in banner
 *   3. What do I put on air?                         the crawl generator
 *
 * DATA
 *   /api/pro/session    who we are, and the coverage area on file
 *   /api/pro/board      active warnings, split in-coverage / outside   (20s)
 *   /api/pro/coverage   read and write the coverage area
 *   api.weather.gov     alert POLYGONS for the map, fetched directly
 *   /geo/counties-10m   county shapes, for drawing the coverage outline
 *
 * Why the polygons come straight from weather.gov rather than through
 * /api/pro/board: the board is a summary and deliberately carries no geometry
 * (see backend/eoc/index.js — only about one alert in ten has a polygon at
 * all, so the counts have to be built from county codes instead). The map
 * wants the shapes that do exist, and asking NWS for them directly keeps the
 * board payload small enough to poll every 20 seconds.
 *
 * DESIGN RULE, inherited from the EOC board: every number says where it came
 * from and when. A desk that shows a confident figure it can no longer refresh
 * is worse than one that admits it is stale, because someone reads the stale
 * one out loud.
 */

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

const POLL_BOARD_MS = 20000;      // the board: fast, it drives the cut-in
const POLL_POLY_MS = 60000;       // polygons: slower, they only redraw a map
const NWS_ALERTS = 'https://api.weather.gov/alerts/active';

const state = {
  org: null,
  coverage: [],                   // [{ fips, name }]
  coverageSet: new Set(),
  board: null,
  seenWarnings: new Set(),        // ids we have already shown
  primed: false,                  // first board loaded? (suppresses cut-in)
  acknowledged: new Set(),        // cut-ins the operator has dismissed
  countyTopo: null,
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ── map ──────────────────────────────────────────────────────────────────── */

mapboxgl.accessToken = window.MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: 'pro-map',
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
  drawCoverage();
  loadPolygons();
});

/*
 * Which colour a warning gets. Grouped by what a newsroom treats them as,
 * not by the NWS severity field: a Severe Thunderstorm Warning and a Tornado
 * Warning are both "Severe" to the API, and they are emphatically not the
 * same thing to a producer.
 */
function eventClass(event) {
  const e = String(event || '').toLowerCase();
  if (e.includes('tornado')) return 'tor';
  if (e.includes('severe thunderstorm')) return 'svr';
  if (e.includes('flash flood')) return 'ffw';
  return 'other';
}
const EVENT_COLOR = {
  tor: '#ff2d55',
  svr: '#ff8c1a',
  ffw: '#35d07f',
  other: '#4da3ff',
};

function installLayers() {
  const empty = { type: 'FeatureCollection', features: [] };

  // Coverage first, so warning polygons draw on top of it.
  map.addSource('coverage', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'coverage-fill', type: 'fill', source: 'coverage',
    paint: { 'fill-color': '#7fa8d4', 'fill-opacity': 0.07 },
  });
  map.addLayer({
    id: 'coverage-line', type: 'line', source: 'coverage',
    paint: { 'line-color': '#7fa8d4', 'line-width': 1.4, 'line-opacity': 0.75 },
  });

  map.addSource('warns', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'warn-fill', type: 'fill', source: 'warns',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 },
  });
  map.addLayer({
    id: 'warn-line', type: 'line', source: 'warns',
    paint: { 'line-color': ['get', 'color'], 'line-width': 2 },
  });

  map.on('click', 'warn-fill', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(
        '<div style="font:700 12px system-ui;color:#111">' + escapeHtml(p.event) + '</div>' +
        '<div style="font:11px system-ui;color:#555;max-width:240px">' + escapeHtml(p.areaDesc || '') + '</div>'
      )
      .addTo(map);
  });
  map.on('mouseenter', 'warn-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'warn-fill', () => { map.getCanvas().style.cursor = ''; });
}

/*
 * Draw the coverage outline from the county TopoJSON the app already ships.
 * Loaded once and cached: it is 820 KB, which is fine to fetch a single time
 * and wasteful to fetch again every time the operator edits their market.
 */
async function drawCoverage() {
  if (!mapReady) return;
  if (!state.coverageSet.size) {
    map.getSource('coverage').setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  try {
    if (!state.countyTopo) {
      const r = await fetch('/geo/counties-10m.json');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      state.countyTopo = await r.json();
    }
    const topo = state.countyTopo;
    const all = topojson.feature(topo, topo.objects.counties).features;
    const mine = all.filter((f) => state.coverageSet.has(String(f.id).padStart(5, '0')));
    map.getSource('coverage').setData({ type: 'FeatureCollection', features: mine });

    // Frame the market the first time it is drawn, so the operator does not
    // open the page to a national view and have to find their own city.
    if (mine.length && !drawCoverage._framed) {
      drawCoverage._framed = true;
      const b = new mapboxgl.LngLatBounds();
      for (const f of mine) eachCoord(f.geometry, (c) => b.extend(c));
      if (!b.isEmpty()) map.fitBounds(b, { padding: 60, duration: 0 });
    }
  } catch (e) {
    console.warn('[PRO] coverage outline unavailable:', e.message);
  }
}

function eachCoord(geom, fn) {
  if (!geom) return;
  const walk = (a) => {
    if (typeof a[0] === 'number') fn(a);
    else a.forEach(walk);
  };
  walk(geom.coordinates);
}

/* ── warning polygons ─────────────────────────────────────────────────────── */

async function loadPolygons() {
  if (!mapReady) return;
  try {
    const r = await fetch(NWS_ALERTS + '?status=actual&message_type=alert', {
      headers: { Accept: 'application/geo+json' },
      cache: 'no-store',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const features = (j.features || [])
      .filter((f) => f.geometry)
      .map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          // The alert id, so a click on the board can find this shape. It has
          // to travel in properties: Mapbox does not hand feature.id back.
          _id: f.properties.id,
          event: f.properties.event,
          areaDesc: f.properties.areaDesc,
          color: EVENT_COLOR[eventClass(f.properties.event)],
        },
      }));
    state.polygons = features;
    map.getSource('warns').setData({ type: 'FeatureCollection', features });
  } catch (e) {
    // The board is the source of truth for the counts; a failed polygon fetch
    // only costs shapes on the map, so it must not blank the page.
    console.warn('[PRO] warning polygons unavailable:', e.message);
  }
}

/* ── time helpers ─────────────────────────────────────────────────────────── */

function minutesUntil(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 60000);
}

function expiryText(iso) {
  const m = minutesUntil(iso);
  if (m == null) return { text: 'no expiry', cls: '' };
  if (m < 0) return { text: 'expired', cls: 'gone' };
  if (m === 0) return { text: 'expiring', cls: 'soon' };
  if (m < 15) return { text: m + ' min', cls: 'soon' };
  if (m < 90) return { text: m + ' min', cls: '' };
  return { text: Math.round(m / 60) + ' hr', cls: '' };
}

/*
 * Format an expiry in the WARNING'S OWN local time, not the viewer's.
 *
 * This one matters more than it looks. toLocaleTimeString() renders in the
 * browser's zone, so a Dallas warning expiring at 14:15-05:00 came out as
 * "3:15 PM EDT" on a machine in the Eastern zone — an hour wrong, with a
 * confident timezone label on it, in the box whose entire purpose is to be
 * copied onto a crawl. Anyone running a market from an out-of-market hub, or
 * covering a market that straddles a zone line, would have aired it.
 *
 * NWS timestamps carry the issuing office's UTC offset, so the correct wall
 * time is in the string already: shift by that offset and read the result in
 * UTC. The abbreviation is lifted from the alert headline, which spells it out
 * ("until September 8 at 8:00PM CDT"). If no abbreviation can be established
 * it is left off rather than guessed — a time with no zone is ambiguous, a
 * time with the wrong zone is wrong.
 */
const TZ_ABBR = /\b(A[KS]?[DS]T|[CEMP][DS]T|HST|HDT|ChST|SST)\b/;

function clockTime(iso, headline) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';

  const off = String(iso).match(/([+-])(\d{2}):(\d{2})$/);
  if (!off) {
    // No offset to honour (a bare UTC 'Z' timestamp): the viewer's zone is the
    // only sensible frame, and it gets labelled as such.
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }

  const sign = off[1] === '-' ? -1 : 1;
  const shifted = new Date(ms + sign * (Number(off[2]) * 60 + Number(off[3])) * 60000);

  let h = shifted.getUTCHours();
  const m = String(shifted.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;

  const abbr = (String(headline || '').match(TZ_ABBR) || [])[0];
  return h + ':' + m + ' ' + ampm + (abbr ? ' ' + abbr : '');
}

/* ── the board ────────────────────────────────────────────────────────────── */

/*
 * Ranking. In-coverage warnings are already separated by the server, so this
 * only orders within a list: tornado above severe above everything else, and
 * within a kind, the one expiring soonest first — that is the one a producer
 * has the least time to do something about.
 */
const KIND_RANK = { tor: 0, svr: 1, ffw: 2, other: 3 };
function rankWarnings(list) {
  return list.slice().sort((a, b) => {
    const ka = KIND_RANK[eventClass(a.event)];
    const kb = KIND_RANK[eventClass(b.event)];
    if (ka !== kb) return ka - kb;
    const ea = Date.parse(a.expires || 0) || Infinity;
    const eb = Date.parse(b.expires || 0) || Infinity;
    return ea - eb;
  });
}

function isEmergency(w) {
  const d = String(w.damageThreat || '').toUpperCase();
  return d === 'CATASTROPHIC' || d === 'CONSIDERABLE'
    || String(w.event || '').toLowerCase().includes('emergency');
}

function warningRow(w, opts = {}) {
  const kind = eventClass(w.event);
  const exp = expiryText(w.expires);
  const tags = [];

  if (opts.markNew && !state.seenWarnings.has(w.id)) tags.push('<span class="tag new">New</span>');
  if (String(w.tornadoDetection || '').toUpperCase() === 'OBSERVED') {
    tags.push('<span class="tag confirmed">Confirmed</span>');
  }
  const threat = String(w.damageThreat || '').toUpperCase();
  if (threat === 'CATASTROPHIC') tags.push('<span class="tag pds">Catastrophic</span>');
  else if (threat === 'CONSIDERABLE') tags.push('<span class="tag confirmed">Considerable</span>');
  if (w.population > 0) tags.push('<span class="tag pop">' + fmt.format(w.population) + '</span>');

  const where = opts.coverageOnly && w.coverageCountyNames && w.coverageCountyNames.length
    ? w.coverageCountyNames.map((n) => n.replace(/ County,.*$/, '')).join(', ')
    : w.areaDesc;

  return '<div class="warn ' + kind + (isEmergency(w) ? ' emergency' : '') + '" data-id="' + escapeHtml(w.id) + '">' +
    '<div class="warn-top">' +
      '<span class="warn-event">' + escapeHtml(w.event) + '</span>' +
      '<span class="warn-expires ' + exp.cls + '">' + exp.text + '</span>' +
    '</div>' +
    '<div class="warn-where">' + escapeHtml(where || '') + '</div>' +
    (tags.length ? '<div class="warn-tags">' + tags.join('') + '</div>' : '') +
  '</div>';
}

function renderBoard() {
  const b = state.board;
  if (!b) return;

  const inArea = rankWarnings(b.inArea || []);
  const outside = rankWarnings(b.outside || []);

  // ── stats ──
  const torCount = inArea.filter((w) => eventClass(w.event) === 'tor').length;
  $('stat-inarea').textContent = inArea.length;
  $('stat-tor').textContent = torCount;
  $('stat-counties').textContent = (b.coverage && b.coverage.countiesAffected) || 0;
  $('stat-national').textContent = (b.counts && b.counts.total) || 0;

  const pop = inArea.reduce((n, w) => n + (w.population || 0), 0);
  $('stat-pop').textContent = pop ? fmt.format(pop) : '0';

  document.querySelector('.stat-major').classList.toggle('hot', inArea.length > 0);

  // ── in coverage ──
  $('inarea-count').textContent = inArea.length;
  if (!b.coverage || !b.coverage.configured) {
    $('inarea-body').innerHTML =
      '<div class="empty">No coverage area set yet. Choose the counties this ' +
      'operation covers and warnings for them will be promoted here.<br><br>' +
      '<button class="btn" id="empty-coverage">Set coverage area</button></div>';
    const btn = $('empty-coverage');
    if (btn) btn.onclick = openCoverage;
  } else if (!inArea.length) {
    $('inarea-body').innerHTML = '<div class="empty">No active warnings in your coverage area.</div>';
  } else {
    $('inarea-body').innerHTML = inArea.map((w) => warningRow(w, { markNew: true, coverageOnly: true })).join('');
  }

  // ── outside coverage ──
  // Capped: this is peripheral vision, not a national feed. The whole list is
  // still counted in the header so nothing is silently hidden.
  const SHOW = 12;
  $('outside-count').textContent = outside.length;
  $('outside-body').innerHTML = outside.length
    ? outside.slice(0, SHOW).map((w) => warningRow(w)).join('') +
      (outside.length > SHOW
        ? '<div class="empty">' + (outside.length - SHOW) + ' more elsewhere in the country.</div>'
        : '')
    : '<div class="empty">Nothing active elsewhere.</div>';

  // ── expiring soon ──
  const soon = inArea
    .filter((w) => { const m = minutesUntil(w.expires); return m != null && m >= 0 && m <= 30; })
    .sort((a, b2) => Date.parse(a.expires || 0) - Date.parse(b2.expires || 0));
  $('expiry-count').textContent = soon.length;
  $('expiry-body').innerHTML = soon.length
    ? soon.map((w) => warningRow(w, { coverageOnly: true })).join('')
    : '<div class="empty">Nothing in your area expires within 30 minutes.</div>';

  renderCrawl(inArea);
  checkCutIn(inArea);

  // Mark everything seen only AFTER the New tags have been rendered from it.
  for (const w of inArea) state.seenWarnings.add(w.id);
  for (const w of outside) state.seenWarnings.add(w.id);

  wireRowClicks();
}

/*
 * Clicking a warning frames it. The board and the map are the same object
 * viewed two ways, and an operator should not have to find on the map what
 * they just read in the list.
 */
function wireRowClicks() {
  for (const el of document.querySelectorAll('.warn')) {
    el.onclick = () => {
      const id = el.getAttribute('data-id');
      // Only about one warning in ten has a polygon, so a row that cannot be
      // framed is normal and must not look like a broken click.
      const f = (state.polygons || []).find((x) => x.properties && x.properties._id === id);
      if (!f) {
        el.classList.add('no-shape');
        setTimeout(() => el.classList.remove('no-shape'), 900);
        return;
      }
      const b = new mapboxgl.LngLatBounds();
      eachCoord(f.geometry, (c) => b.extend(c));
      if (!b.isEmpty()) map.fitBounds(b, { padding: 80, duration: 500 });
    };
  }
}

/* ── crawl ────────────────────────────────────────────────────────────────── */

/*
 * Build the text that goes on the crawl.
 *
 * Grouped by event and phrased the way a station reads it out, because the
 * point of this box is that a producer copies it and it is done — not that
 * they retype a list of warnings under deadline. Counties are stripped of
 * ", State" and of the word "County": nobody crawls "Tarrant County, Texas".
 */
function renderCrawl(inArea) {
  if (!inArea.length) {
    $('crawl-text').value = '';
    $('crawl-meta').textContent = 'Nothing active in your coverage area.';
    return;
  }
  const byEvent = new Map();
  for (const w of inArea) {
    if (!byEvent.has(w.event)) byEvent.set(w.event, { counties: new Set(), expires: w.expires, headline: w.headline });
    const g = byEvent.get(w.event);
    for (const n of (w.coverageCountyNames || [])) g.counties.add(n.replace(/ County,.*$/, '').replace(/,.*$/, ''));
    // The group carries the LATEST expiry of its warnings: a crawl that says
    // 4:15 while one of the warnings runs to 4:45 takes itself off air early.
    // The headline travels with it, because that is where the timezone
    // abbreviation for THAT expiry comes from.
    if (Date.parse(w.expires || 0) > Date.parse(g.expires || 0)) {
      g.expires = w.expires;
      g.headline = w.headline;
    }
  }

  const lines = [];
  for (const [event, g] of byEvent) {
    const counties = [...g.counties];
    const list = counties.length > 1
      ? counties.slice(0, -1).join(', ') + ' and ' + counties[counties.length - 1]
      : counties[0] || '';
    const until = g.expires ? ' until ' + clockTime(g.expires, g.headline) : '';
    lines.push(event.toUpperCase() + ' for ' + list + (counties.length === 1 ? ' County' : ' counties') + until + '.');
  }

  $('crawl-text').value = lines.join('  ');
  $('crawl-meta').textContent =
    lines.length + ' warning group' + (lines.length === 1 ? '' : 's') +
    ' · rebuilt ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

$('btn-copy-crawl').onclick = async () => {
  const t = $('crawl-text').value;
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
    $('crawl-meta').textContent = 'Copied to the clipboard.';
  } catch (e) {
    // Clipboard access can be refused (insecure context, or a permission
    // policy). Select the text so the operator can still copy it by hand
    // rather than being told nothing happened.
    $('crawl-text').removeAttribute('readonly');
    $('crawl-text').select();
    $('crawl-meta').textContent = 'Clipboard blocked — text selected, press Ctrl+C.';
  }
};

/* ── cut-in ───────────────────────────────────────────────────────────────── */

/*
 * Fire only for a tornado warning that is NEW and inside the coverage area.
 *
 * Never on the first load. Opening the page during an active tornado warning
 * is not news to the person opening it — they opened it because they already
 * know — and a banner that fires on every page load is a banner that gets
 * dismissed reflexively, including on the one occasion it was telling the
 * truth. state.primed is what enforces that.
 */
function checkCutIn(inArea) {
  if (!state.primed) return;
  const fresh = inArea.find((w) =>
    eventClass(w.event) === 'tor' &&
    !state.seenWarnings.has(w.id) &&
    !state.acknowledged.has(w.id));
  if (!fresh) return;

  state.cutInId = fresh.id;
  $('cutin-event').textContent = fresh.event +
    (String(fresh.tornadoDetection || '').toUpperCase() === 'OBSERVED' ? ' — CONFIRMED' : '');
  $('cutin-where').textContent = (fresh.coverageCountyNames || []).join(', ') || fresh.areaDesc || '';
  $('cutin').hidden = false;
}

$('cutin-ack').onclick = () => {
  if (state.cutInId) state.acknowledged.add(state.cutInId);
  $('cutin').hidden = true;
};

/* ── feed health ──────────────────────────────────────────────────────────── */

function setFeed(status, note) {
  const dot = $('feed-dot');
  dot.className = 'pro-dot ' + status;
  const banner = $('stale-banner');
  if (note) { banner.textContent = note; banner.hidden = false; }
  else banner.hidden = true;
}

/* ── polling ──────────────────────────────────────────────────────────────── */

async function loadBoard() {
  try {
    const r = await fetch('/api/pro/board', { cache: 'no-store' });
    if (r.status === 403) {
      document.body.innerHTML =
        '<div style="padding:60px;text-align:center;color:#8a97a7;font:14px system-ui">' +
        'This account is not licensed for Vortex Pro.</div>';
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    state.board = await r.json();

    if (state.board.stale) {
      setFeed('stale', 'Warning feed could not be refreshed — showing the last good copy from ' +
        clockTime(state.board.fetchedAt) + '. ' + (state.board.staleReason || ''));
    } else {
      setFeed('live', null);
    }
    renderBoard();
    state.primed = true;
  } catch (e) {
    setFeed('down', 'Cannot reach the warning service: ' + (e.message || e) +
      '. The board below may be out of date.');
  }
}

/* ── coverage picker ──────────────────────────────────────────────────────── */

let draft = [];     // [{ fips, name }] while the modal is open

function openCoverage() {
  draft = state.coverage.slice();
  $('coverage-modal').hidden = false;
  $('coverage-search').value = '';
  $('coverage-results').innerHTML = '';
  $('coverage-status').textContent = '';
  renderChips();
  $('coverage-search').focus();
}
function closeCoverage() { $('coverage-modal').hidden = true; }

$('btn-coverage').onclick = openCoverage;
$('coverage-close').onclick = closeCoverage;
$('coverage-modal').onclick = (e) => { if (e.target === $('coverage-modal')) closeCoverage(); };

let searchTimer = null;
$('coverage-search').oninput = () => {
  clearTimeout(searchTimer);
  // Debounced: a county search fires on every keystroke otherwise, and the
  // results of the slower earlier query can land after the newer one.
  searchTimer = setTimeout(runSearch, 180);
};

async function runSearch() {
  const q = $('coverage-search').value.trim();
  if (q.length < 2) { $('coverage-results').innerHTML = ''; return; }
  try {
    const r = await fetch('/api/pro/counties?q=' + encodeURIComponent(q), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const have = new Set(draft.map((c) => c.fips));
    $('coverage-results').innerHTML = (j.counties || []).length
      ? j.counties.map((c) =>
          '<div class="result' + (have.has(c.fips) ? ' on' : '') + '" data-fips="' + c.fips + '">' +
            '<span>' + escapeHtml(c.name) + '</span>' +
            '<span class="result-fips">' + (have.has(c.fips) ? 'added' : c.fips) + '</span>' +
          '</div>').join('')
      : '<div class="empty">No counties match that.</div>';

    for (const el of $('coverage-results').querySelectorAll('.result:not(.on)')) {
      el.onclick = () => {
        const fips = el.getAttribute('data-fips');
        const found = (j.counties || []).find((c) => c.fips === fips);
        if (found && !draft.some((c) => c.fips === fips)) {
          draft.push(found);
          renderChips();
          runSearch();
        }
      };
    }
  } catch (e) {
    $('coverage-results').innerHTML = '<div class="empty">Search failed: ' + escapeHtml(e.message) + '</div>';
  }
}

function renderChips() {
  $('coverage-chosen-count').textContent = draft.length;
  $('coverage-chips').innerHTML = draft.length
    ? draft.map((c, i) =>
        '<span class="chip">' + escapeHtml(c.name.replace(/,.*$/, '')) +
        '<button data-i="' + i + '" title="Remove">×</button></span>').join('')
    : '<span class="empty">Nothing selected.</span>';
  for (const b of $('coverage-chips').querySelectorAll('button')) {
    b.onclick = () => { draft.splice(Number(b.getAttribute('data-i')), 1); renderChips(); runSearch(); };
  }
}

$('coverage-clear').onclick = () => { draft = []; renderChips(); runSearch(); };

$('coverage-save').onclick = async () => {
  $('coverage-status').textContent = 'Saving…';
  try {
    const r = await fetch('/api/pro/coverage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counties: draft.map((c) => c.fips) }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    applyCoverage(j.counties || []);
    closeCoverage();
    // Reframe on the new market, and refresh the board so the split is
    // recomputed against it rather than waiting up to 20 seconds.
    drawCoverage._framed = false;
    drawCoverage();
    loadBoard();
  } catch (e) {
    $('coverage-status').textContent = 'Could not save: ' + e.message;
  }
};

function applyCoverage(list) {
  state.coverage = list;
  state.coverageSet = new Set(list.map((c) => c.fips));
}

/* ── on-air mode ──────────────────────────────────────────────────────────── */

/*
 * Strips the interface to a full-bleed map for a camera shot or a window
 * capture in the switcher. The panels are removed from the layout rather than
 * covered, so nothing can catch an edge at the frame boundary.
 */
function setOnAir(on) {
  document.body.classList.toggle('onair', on);
  // Mapbox measures its canvas on resize; without this the map keeps the old
  // three-column width and the right side of the shot is empty.
  setTimeout(() => map.resize(), 60);
  if (on) {
    const hint = document.createElement('div');
    hint.className = 'onair-hint';
    hint.id = 'onair-hint';
    hint.textContent = 'Esc to exit';
    document.body.appendChild(hint);
    setTimeout(() => { hint.style.opacity = '0'; }, 2600);
    setTimeout(() => hint.remove(), 3200);
  } else {
    const h = $('onair-hint');
    if (h) h.remove();
  }
}
$('btn-onair').onclick = () => setOnAir(true);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('coverage-modal').hidden) closeCoverage();
    else if (document.body.classList.contains('onair')) setOnAir(false);
  }
});

/* ── clock ────────────────────────────────────────────────────────────────── */

function tickClock() {
  const d = new Date();
  $('clock-local').textContent = d.toLocaleTimeString([], { hour12: false });
  $('clock-utc').textContent =
    String(d.getUTCHours()).padStart(2, '0') + ':' +
    String(d.getUTCMinutes()).padStart(2, '0') + 'Z';
}
setInterval(tickClock, 1000);
tickClock();

/*
 * Expiry countdowns are re-rendered on their own slow timer rather than by
 * re-polling. "expires in 3 min" has to keep counting down between board
 * fetches, and asking the server every 15 seconds to find that out would be
 * twenty times the traffic for a number the browser can work out itself.
 */
setInterval(() => { if (state.board) renderBoard(); }, 15000);

/* ── boot ─────────────────────────────────────────────────────────────────── */

async function boot() {
  try {
    const r = await fetch('/api/pro/session', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login.html'; return; }
    if (r.status === 403) {
      document.body.innerHTML =
        '<div style="padding:60px;text-align:center;color:#8a97a7;font:14px system-ui">' +
        'This account is not licensed for Vortex Pro.<br><br>' +
        '<a href="/" style="color:#7fa8d4">Back to the radar</a></div>';
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const s = await r.json();
    state.org = s.org;
    $('org-name').textContent = s.org ? s.org.name : '';
    document.title = (s.org ? s.org.name + ' · ' : '') + 'Vortex Pro';

    const cov = await fetch('/api/pro/coverage', { cache: 'no-store' }).then((x) => x.json());
    applyCoverage(cov.counties || []);
    drawCoverage();
  } catch (e) {
    setFeed('down', 'Could not load your Pro session: ' + (e.message || e));
  }

  loadBoard();
  setInterval(loadBoard, POLL_BOARD_MS);
  setInterval(loadPolygons, POLL_POLY_MS);
}

boot();
