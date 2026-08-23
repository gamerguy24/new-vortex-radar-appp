/*
 * components/warning_search.js
 * A top-center search bar for active warnings/watches (RadarOmega-style). Type a
 * hazard or place, pick a result, and the map flies to that alert and frames it.
 *
 * Reads the live alert features already on the map (the 'alertsSource' GeoJSON),
 * grouping the duplicated / per-county features back into one entry per alert so
 * the whole affected area can be framed.
 *
 * ES module, loaded via <script type="module"> in index.html.
 */

const MAX_RESULTS = 40;

function mapObj() { return window.vortexMap && window.vortexMap.map; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function injectStyles() {
  if (document.getElementById('vwsearch-styles')) return;
  const s = document.createElement('style');
  s.id = 'vwsearch-styles';
  s.textContent = `
  #vwsearch{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:520;
    width:min(440px,72vw);font-family:'Onest',system-ui,sans-serif}
  #vwsearch .vws-box{display:flex;align-items:center;gap:8px;background:rgba(15,17,21,.96);
    border:1px solid rgba(255,255,255,.10);border-radius:11px;padding:8px 12px;
    box-shadow:0 6px 20px rgba(0,0,0,.4);backdrop-filter:blur(14px)}
  #vwsearch .vws-ico{width:16px;height:16px;flex:0 0 auto;stroke:#8ea4bd;stroke-width:2;fill:none}
  #vwsearch input{flex:1;min-width:0;background:none;border:none;outline:none;color:#e9eef5;
    font-size:14px;font-family:inherit}
  #vwsearch input::placeholder{color:#7f8a99}
  #vwsearch .vws-clear{background:none;border:none;color:#7f8a99;cursor:pointer;font-size:16px;
    line-height:1;padding:0 2px;display:none}
  #vwsearch .vws-clear:hover{color:#e9eef5}
  #vwsearch.has-text .vws-clear{display:block}
  #vwsearch .vws-results{margin-top:6px;background:rgba(15,17,21,.98);border:1px solid rgba(255,255,255,.10);
    border-radius:11px;box-shadow:0 12px 30px rgba(0,0,0,.5);max-height:min(60vh,460px);overflow-y:auto;
    display:none}
  #vwsearch.open .vws-results{display:block}
  .vws-row{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;cursor:pointer;
    border-bottom:1px solid rgba(255,255,255,.05)}
  .vws-row:last-child{border-bottom:none}
  .vws-row:hover,.vws-row.active{background:rgba(255,255,255,.06)}
  .vws-dot{width:10px;height:10px;border-radius:3px;margin-top:3px;flex:0 0 auto;border:1px solid rgba(0,0,0,.4)}
  .vws-info{min-width:0}
  .vws-ev{font-size:13.5px;font-weight:700;color:#eaf1fb;line-height:1.2}
  .vws-area{font-size:12px;color:#93a3b8;margin-top:2px;overflow:hidden;text-overflow:ellipsis;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .vws-empty{padding:14px 12px;color:#7f8a99;font-size:13px;text-align:center}
  @media (max-width:640px){#vwsearch{width:82vw}}
  `;
  document.head.appendChild(s);
}

// walk every [lng,lat] in a geometry
function eachCoord(geom, cb) {
  if (!geom) return;
  const t = geom.type, c = geom.coordinates;
  if (t === 'Point') cb(c);
  else if (t === 'MultiPoint' || t === 'LineString') c.forEach(cb);
  else if (t === 'Polygon' || t === 'MultiLineString') c.forEach((r) => r.forEach(cb));
  else if (t === 'MultiPolygon') c.forEach((p) => p.forEach((r) => r.forEach(cb)));
  else if (t === 'GeometryCollection') (geom.geometries || []).forEach((g) => eachCoord(g, cb));
}
function extend(b, geom) {
  eachCoord(geom, (p) => {
    if (!p || p.length < 2) return;
    if (p[0] < b[0]) b[0] = p[0];
    if (p[1] < b[1]) b[1] = p[1];
    if (p[0] > b[2]) b[2] = p[0];
    if (p[1] > b[3]) b[3] = p[1];
  });
}

// Build one entry per alert from the live source, with combined bounds.
function collectAlerts() {
  const m = mapObj();
  const src = m && m.getSource && m.getSource('alertsSource');
  const feats = (src && src._data && src._data.features) || [];
  const groups = new Map();
  for (const f of feats) {
    if (!f || !f.geometry) continue;
    const p = f.properties || {};
    const key = p.id || (String(p.event) + '|' + String(p.areaDesc));
    let g = groups.get(key);
    if (!g) { g = { props: p, bounds: [Infinity, Infinity, -Infinity, -Infinity] }; groups.set(key, g); }
    extend(g.bounds, f.geometry);
  }
  return [...groups.values()].filter((g) => isFinite(g.bounds[0]));
}

const rank = (ev) => (/warning$/i.test(ev) ? 0 : /watch$/i.test(ev) ? 1 : 2);

function search(query) {
  const q = query.trim().toLowerCase();
  let list = collectAlerts();
  if (q) {
    const terms = q.split(/\s+/);
    list = list.filter((g) => {
      const hay = ((g.props.event || '') + ' ' + (g.props.areaDesc || '') + ' ' + (g.props.headline || '')).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  list.sort((a, b) => {
    const r = rank(a.props.event || '') - rank(b.props.event || '');
    if (r) return r;
    return (b.props.priority || 0) - (a.props.priority || 0);
  });
  return list.slice(0, MAX_RESULTS);
}

function flyTo(g) {
  const m = mapObj();
  if (!m) return;
  const [w, s, e, n] = g.bounds;
  try {
    m.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 9.5, duration: 1100 });
  } catch (err) {}
}

let els = null;
function render(results) {
  const box = els.results;
  if (!results.length) {
    box.innerHTML = `<div class="vws-empty">No matching warnings or watches.</div>`;
    return;
  }
  box.innerHTML = '';
  results.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'vws-row';
    const color = g.props.color || '#9aa6b6';
    row.innerHTML = `
      <span class="vws-dot" style="background:${esc(color)}"></span>
      <div class="vws-info">
        <div class="vws-ev">${esc(g.props.event || 'Alert')}</div>
        <div class="vws-area">${esc(g.props.areaDesc || '')}</div>
      </div>`;
    row.addEventListener('click', () => {
      flyTo(g);
      close();
      els.input.value = g.props.event || '';
      els.wrap.classList.add('has-text');
    });
    box.appendChild(row);
  });
}

function open() { els.wrap.classList.add('open'); }
function close() { els.wrap.classList.remove('open'); }

function doSearch() {
  const q = els.input.value;
  els.wrap.classList.toggle('has-text', !!q);
  render(search(q));
  open();
}

function init() {
  injectStyles();
  const wrap = document.createElement('div');
  wrap.id = 'vwsearch';
  wrap.innerHTML = `
    <div class="vws-box">
      <svg class="vws-ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input type="text" placeholder="Search warnings & watches…" autocomplete="off" spellcheck="false" aria-label="Search warnings and watches" />
      <button class="vws-clear" title="Clear" aria-label="Clear">×</button>
    </div>
    <div class="vws-results"></div>`;
  document.body.appendChild(wrap);

  els = {
    wrap,
    box: wrap.querySelector('.vws-box'),
    input: wrap.querySelector('input'),
    clear: wrap.querySelector('.vws-clear'),
    results: wrap.querySelector('.vws-results'),
  };

  let t = null;
  els.input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(doSearch, 90); });
  els.input.addEventListener('focus', doSearch);
  els.clear.addEventListener('click', () => { els.input.value = ''; els.wrap.classList.remove('has-text'); els.input.focus(); doSearch(); });
  els.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); els.input.blur(); } });

  // close when clicking outside
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
