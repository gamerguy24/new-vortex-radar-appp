// Vortex Graphics — Studio controller. Loads geo data, manages the active
// template + its config, renders to the broadcast canvas, builds the editor
// panel, handles click-to-paint editing, and exports PNG frames.
import { Scene } from './engine/scene.js';
import { loadGeo } from './engine/geo.js';
import { freehandLayer, logoLayer, panelOverlayLayer, nameOverlayLayer } from './engine/overlays.js';
import { fetchRadar, radarLayer } from './engine/radar.js';
import { fetchSatellite, satelliteLayer, satelliteSig } from './engine/satellite.js';
import { TEMPLATES, TEMPLATE_BY_ID } from './templates/index.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage-canvas');

let geo = null;
let scene = null;
const state = {
  templateId: TEMPLATES[0].id,
  template: TEMPLATES[0],
  config: TEMPLATES[0].defaultConfig(),
  brush: null,          // active paint brush id, 'custom', or 'erase'
  size: { w: 1920, h: 1080 },
  tool: 'fill',         // 'fill' = click regions, 'draw'/'erase' = freehand brush
  color: '#ff3b3b',     // shared color for the custom fill brush + freehand brush
  brushPx: 16,          // freehand brush size, in canvas (broadcast) pixels
  logo: null,           // { img, src, corner, scale } — drawn on every template
  overlays: [],         // [{ type:'panel'|'name', ... }] — draggable, on every template
  radar: null,          // { img, bbox, opacity } — live NEXRAD reflectivity overlay
  satellite: null,      // { mosaic, ... } — MapTiler satellite imagery for the 'hybrid' basemap
  _satSig: null,        // signature of the region the loaded satellite covers
  _satLoading: null,    // signature currently being fetched (in-flight guard)
};

// Template layer names that are "chrome" (labels / headers / legend / branding).
// Radar is inserted just before the first of these so it sits over the map data
// but under text.
const RADAR_CHROME = new Set([
  'cities', 'point-labels', 'legend-categorical', 'legend-gradient',
  'title-bar', 'flag-header', 'banner-header', 'threat-box', 'branding',
]);
function insertRadarLayer(sc = scene) {
  // A template that renders its own radar opts out here. Without this the
  // studio's shared NWS ImageServer mosaic gets composited on top of it, so a
  // template drawing the app's Level 2 data ends up showing TWO radars at once
  // — different source, different resolution, different colour table. That is
  // exactly what made the Live Radar template disagree with the radar page.
  if (state.template && state.template.providesRadar) return;
  if (!(state.radar && state.radar.img)) return;
  const layer = radarLayer(state.radar);
  const idx = sc.layers.findIndex((l) => RADAR_CHROME.has(l.name));
  if (idx < 0) sc.add(layer);
  else sc.layers.splice(idx, 0, layer);
}

// Satellite ('hybrid') basemap: real MapTiler imagery composited under the
// vector overlays. The imagery is fetched asynchronously (like radar) and warped
// to whatever projection the active template built, then inserted just above the
// ocean background so the transparent-land border/label layers sit on top.
function insertSatelliteLayer(sc = scene) {
  if (state.config.basemap !== 'hybrid') return;
  ensureSatellite();
  if (!(state.satellite && state.satellite.mosaic)) return;
  const layer = satelliteLayer(state.satellite);
  const idx = sc.layers.findIndex((l) => l.name === 'background');
  if (idx < 0) sc.layers.unshift(layer);
  else sc.layers.splice(idx + 1, 0, layer);
}

// Fetch satellite imagery for the current view if we don't already have it.
// Re-fetches only when the region/zoom signature changes (state/region/resize).
function ensureSatellite() {
  if (!scene || !scene.projection) return;
  let want;
  try { want = satelliteSig(scene); } catch (e) { return; }
  if (state.satellite && state._satSig === want) return; // already loaded
  if (state._satLoading === want) return;                // in flight
  state._satLoading = want;
  fetchSatellite(scene)
    .then((sat) => {
      state._satLoading = null;
      if (state.config.basemap !== 'hybrid') return;      // user switched away
      state.satellite = sat;
      state._satSig = want;
      rerender();
    })
    .catch((err) => {
      state._satLoading = null;
      console.warn('[studio] satellite basemap load failed:', err.message || err);
    });
}

// Per-template freehand strokes, kept on the config so Reset / template switch
// clears them. Lazily created.
function getStrokes() {
  if (!state.config._strokes) state.config._strokes = [];
  return state.config._strokes;
}

// Controller handed to templates so paint handlers can read the brush / redraw.
// 'custom' resolves to the picked color so templates need no special-casing.
const ctrl = {
  getBrush: () => (state.brush === 'custom' ? state.color : state.brush),
  rerender,
  importSpc,
};

// The active paint scale. Templates may expose getScale(config) for datasets
// that change which brushes are available (e.g. State Spotlight); otherwise the
// static template.scale is used.
function activeScale() {
  const t = state.template;
  const base = (t.getScale ? t.getScale(state.config) : t.scale) || null;
  if (!base) return null;
  // User edits (renamed/recolored levels) live on config._scale.
  return state.config._scale || base;
}

function rerender() {
  if (!geo) return;
  state.template.build(scene, geo, state.config, ctrl);
  // Satellite ('hybrid') imagery sits just above the ocean, under the map data.
  insertSatelliteLayer();
  // Radar sits over the map data but under labels/chrome and user overlays.
  insertRadarLayer();
  // User overlays sit on top of every template (build() clears layers first).
  for (const ov of state.overlays) {
    scene.add(ov.type === 'name' ? nameOverlayLayer(ov) : panelOverlayLayer(ov));
  }
  scene.add(freehandLayer(getStrokes()));
  if (state.logo && state.logo.img) scene.add(logoLayer(state.logo));
  scene.render();
}

// ---- Template selection ----------------------------------------------------
function selectTemplate(id) {
  state.templateId = id;
  state.template = TEMPLATE_BY_ID[id];
  state.config = state.template.defaultConfig();
  const sc0 = activeScale();
  state.brush = sc0 ? sc0[0].id : null;
  buildRail();
  buildProps();
  rerender();
  updateHint();
  // The new template may cover a different region; refit radar to its view.
  if (state.radar) loadRadar();
}

// Per-template presentation metadata for the rail + properties header.
const TEMPLATE_META = {
  'severe-threat': { mono: 'T', color: '#f59e0b', name: 'Severe Storm Threat', sub: 'County threat levels' },
  outlook: { mono: 'O', color: '#4c8dff', name: 'National Outlook', sub: 'Live SPC categorical risk' },
  'precip-panels': { mono: 'P', color: '#22c55e', name: 'Day-to-Day Precip', sub: 'Multi-day panels' },
  'ice-accum': { mono: 'I', color: '#38bdf8', name: 'Ice Accumulation', sub: 'Totals by inches' },
  'state-spotlight': { mono: 'S', color: '#a855f7', name: 'State Spotlight', sub: 'One state, full frame' },
  'lower-third': { mono: 'L', color: '#94a3b8', name: 'Lower-Third', sub: 'Titles & banners' },
  'radar-forecast': { mono: 'R', color: '#1b53b3', name: 'Radar Forecast', sub: 'Broadcast radar + panels' },
  'live-radar': { mono: 'L', color: '#e8862b', name: 'Live Radar', sub: 'Moveable map + Level 2' },
  'forecast-model': { mono: 'F', color: '#16a34a', name: 'Forecast Model', sub: 'GFS / NAM / HRRR fields' },
};
function metaFor(id) {
  return TEMPLATE_META[id] || { mono: '•', color: '#94a3b8', name: id, sub: '' };
}

function buildRail() {
  const rail = $('template-rail');
  rail.innerHTML = '';
  for (const t of TEMPLATES) {
    const m = metaFor(t.id);
    const el = document.createElement('div');
    el.className = 'rail-item' + (t.id === state.templateId ? ' active' : '');
    const icon = document.createElement('div');
    icon.className = 'ri-icon';
    icon.textContent = m.mono;
    icon.style.color = m.color;
    icon.style.background = hexToRgba(m.color, 0.13);
    icon.style.borderColor = hexToRgba(m.color, 0.32);
    const body = document.createElement('div');
    body.className = 'ri-body';
    body.innerHTML = `<div class="ri-title">${m.name}</div><div class="ri-sub">${m.sub}</div>`;
    el.append(icon, body);
    el.onclick = () => selectTemplate(t.id);
    rail.appendChild(el);
  }
}

function hexToRgba(hex, a) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---- Properties editor -----------------------------------------------------
function buildProps() {
  $('props-title').textContent = state.template.label;
  const blurb = $('props-blurb');
  if (blurb) blurb.textContent = metaFor(state.template.id).sub;
  const wrap = $('props-fields');
  wrap.innerHTML = '';
  const fields = state.template.fields();
  for (const f of fields) {
    wrap.appendChild(renderField(f));
  }
  // Any template that paints gets the paint-data editor + legend toggle.
  if (fields.some((f) => f.type === 'paint') && activeScale()) {
    wrap.appendChild(renderScaleEditor());
    wrap.appendChild(renderLegendToggle());
  }
  // Overlays (panels + name plate) are available on every template.
  wrap.appendChild(renderOverlaysEditor());
}

// ---- Overlays editor: add/edit/delete draggable panels & name plates --------
function renderOverlaysEditor() {
  const div = document.createElement('div');
  div.className = 'field';
  const label = document.createElement('label');
  label.textContent = 'Overlays (panels & name)';
  div.appendChild(label);

  const add = document.createElement('div');
  add.className = 'overlay-add';
  const addPanel = document.createElement('button');
  addPanel.className = 'ghost small'; addPanel.textContent = '+ Panel';
  addPanel.onclick = () => spawnOverlay('panel');
  const addName = document.createElement('button');
  addName.className = 'ghost small'; addName.textContent = '+ Name plate';
  addName.onclick = () => spawnOverlay('name');
  add.append(addPanel, addName);
  div.appendChild(add);

  const list = document.createElement('div');
  list.className = 'overlay-list';
  state.overlays.forEach((ov, i) => list.appendChild(renderOverlayCard(ov, i)));
  div.appendChild(list);

  const hint = document.createElement('div');
  hint.className = 'hint-text'; hint.style.marginTop = '8px';
  hint.textContent = 'With the Fill tool, drag an overlay on the canvas to position it.';
  div.appendChild(hint);
  return div;
}

function spawnOverlay(type) {
  const n = state.overlays.length;
  if (type === 'name') {
    state.overlays.push({ id: 'ov' + Date.now(), type: 'name',
      name: 'Your Name', subtitle: 'Meteorologist', x: 90 + n * 24, y: 840, accent: '#4c8dff' });
  } else {
    state.overlays.push({ id: 'ov' + Date.now(), type: 'panel',
      title: 'Panel title', text: 'First line\nSecond line\nThird line',
      x: 80 + n * 24, y: 260 + n * 24, w: 360, accent: '#5a1d22' });
  }
  buildProps();
  rerender();
}

function renderOverlayCard(ov, i) {
  const card = document.createElement('div');
  card.className = 'overlay-card';
  const head = document.createElement('div');
  head.className = 'overlay-head';
  const t = document.createElement('span');
  t.textContent = ov.type === 'name' ? 'Name plate' : 'Panel';
  const del = document.createElement('button');
  del.className = 'ghost small'; del.textContent = '✕'; del.title = 'Delete overlay';
  del.onclick = () => { state.overlays.splice(i, 1); buildProps(); rerender(); };
  head.append(t, del);
  card.appendChild(head);

  if (ov.type === 'name') {
    card.appendChild(overlayText('Name', ov.name, (v) => { ov.name = v; rerender(); }));
    card.appendChild(overlayText('Subtitle', ov.subtitle, (v) => { ov.subtitle = v; rerender(); }));
  } else {
    card.appendChild(overlayText('Title', ov.title, (v) => { ov.title = v; rerender(); }));
    const ta = document.createElement('textarea');
    ta.className = 'overlay-text'; ta.rows = 3; ta.value = ov.text || '';
    ta.placeholder = 'Type multiple lines…';
    ta.oninput = () => { ov.text = ta.value; rerender(); };
    card.appendChild(ta);
  }
  const colorRow = document.createElement('div');
  colorRow.className = 'scale-row';
  const col = document.createElement('input');
  col.type = 'color'; col.value = normHex(ov.accent);
  col.oninput = () => { ov.accent = col.value; rerender(); };
  const cl = document.createElement('span');
  cl.className = 'hint-text'; cl.textContent = 'accent color';
  colorRow.append(col, cl);
  card.appendChild(colorRow);
  return card;
}

function overlayText(placeholder, value, onChange) {
  const i = document.createElement('input');
  i.type = 'text'; i.value = value ?? ''; i.placeholder = placeholder;
  i.oninput = () => onChange(i.value);
  return i;
}

// Editor for the paint data: rename and recolor each level. Edits clone the
// active scale into config._scale (ids stay fixed so painted areas stay valid).
function renderScaleEditor() {
  const div = document.createElement('div');
  div.className = 'field';
  const label = document.createElement('label');
  label.textContent = 'Paint data (rename & recolor)';
  div.appendChild(label);

  const base = activeScale() || [];
  const ensureCopy = () => {
    if (!state.config._scale) state.config._scale = base.map((s) => ({ ...s }));
    return state.config._scale;
  };
  const editor = document.createElement('div');
  editor.className = 'scale-editor';
  (state.config._scale || base).forEach((stop, idx) => {
    const row = document.createElement('div'); row.className = 'scale-row';
    const col = document.createElement('input');
    col.type = 'color'; col.value = normHex(stop.color);
    col.oninput = () => { ensureCopy()[idx].color = col.value; refreshBrushPalette(); rerender(); };
    const txt = document.createElement('input');
    txt.type = 'text'; txt.value = stop.label ?? '';
    txt.oninput = () => { ensureCopy()[idx].label = txt.value; rerender(); };
    const del = document.createElement('button');
    del.className = 'ghost small'; del.textContent = '✕'; del.title = 'Delete this level';
    del.onclick = () => {
      const sc = ensureCopy();
      if (sc.length <= 1) return; // keep at least one level
      const [removed] = sc.splice(idx, 1);
      if (state.brush === removed.id) state.brush = sc[0] ? sc[0].id : 'custom';
      buildProps(); rerender();
    };
    row.append(col, txt, del); editor.appendChild(row);
  });
  div.appendChild(editor);
  const hint = document.createElement('div'); hint.className = 'hint-text'; hint.style.marginTop = '8px';
  hint.textContent = 'Recolor or rename each level, or ✕ to delete one you don’t need. Reset restores the defaults.';
  div.appendChild(hint);
  return div;
}

function renderLegendToggle() {
  const div = document.createElement('div');
  div.className = 'field';
  const label = document.createElement('label');
  label.textContent = 'Legend table';
  div.appendChild(label);
  const row = document.createElement('div'); row.className = 'toggle-row';
  const i = document.createElement('input'); i.type = 'checkbox';
  i.checked = state.config.showLegend !== false;
  i.onchange = () => { state.config.showLegend = i.checked; rerender(); };
  const span = document.createElement('span'); span.className = 'hint-text';
  span.textContent = i.checked ? 'shown on graphic' : 'hidden';
  i.addEventListener('change', () => { span.textContent = i.checked ? 'shown on graphic' : 'hidden'; });
  row.append(i, span); div.appendChild(row);
  return div;
}

// Coerce any scale color to a #rrggbb value an <input type=color> accepts.
function normHex(c) {
  if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return c;
  if (typeof c === 'string' && /^#[0-9a-f]{3}$/i.test(c)) {
    return '#' + c.slice(1).split('').map((x) => x + x).join('');
  }
  return '#000000';
}

function renderField(f) {
  const div = document.createElement('div');
  div.className = 'field';
  const label = document.createElement('label');
  label.textContent = f.label;
  div.appendChild(label);
  const cfg = state.config;

  switch (f.type) {
    case 'text': {
      const i = document.createElement('input');
      i.type = 'text'; i.value = cfg[f.key] ?? '';
      i.oninput = () => { cfg[f.key] = i.value; rerender(); };
      div.appendChild(i); break;
    }
    case 'color': {
      const i = document.createElement('input');
      i.type = 'color'; i.value = cfg[f.key] ?? '#1769d6';
      i.oninput = () => { cfg[f.key] = i.value; rerender(); };
      div.appendChild(i); break;
    }
    case 'toggle': {
      const row = document.createElement('div'); row.className = 'toggle-row';
      const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!cfg[f.key];
      i.onchange = () => {
        cfg[f.key] = i.checked;
        if (f.key === 'showSpc' && i.checked && !cfg.spcFeatures) importSpc().catch(() => {});
        rerender();
      };
      const span = document.createElement('span'); span.className = 'hint-text'; span.textContent = 'on/off';
      row.append(i, span); div.appendChild(row); break;
    }
    case 'select': {
      const s = document.createElement('select');
      for (const o of f.options) {
        const opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.label; if (cfg[f.key] === o.value) opt.selected = true;
        s.appendChild(opt);
      }
      s.onchange = () => {
        cfg[f.key] = s.value;
        // changing region/state invalidates painted data placement; clear it
        if (f.key === 'region' || f.key === 'stateAbbr') { resetPaintData(); }
        // switching the SPC day refetches that outlook if it's being shown
        if (f.key === 'spcDay' && cfg.showSpc) importSpc().catch(() => {});
        // changing the data set swaps the available brushes + paint-data scale
        if (f.key === 'dataset') {
          delete state.config._scale; // re-derive labels/colors from new dataset
          const sc = activeScale();
          state.brush = sc ? sc[0].id : null;
          resetPaintData();
          buildProps();
        }
        rerender();
      };
      div.appendChild(s); break;
    }
    case 'csv': {
      const i = document.createElement('input');
      i.type = 'text'; i.value = (cfg[f.key] || []).join(', ');
      i.oninput = () => { cfg[f.key] = i.value.split(',').map((x) => x.trim()).filter(Boolean); rerender(); };
      div.appendChild(i); break;
    }
    case 'paint': {
      div.appendChild(renderBrushes());
      const hint = document.createElement('div'); hint.className = 'hint-text';
      hint.style.marginTop = '8px';
      hint.textContent = 'Pick a level, then click areas on the map to paint. Use Erase to clear.';
      div.appendChild(hint); break;
    }
    case 'threats': {
      div.appendChild(renderThreatsEditor()); break;
    }
    case 'panelpick': {
      div.appendChild(renderPanelPick()); break;
    }
    case 'image': {
      const row = document.createElement('div');
      row.style.display = 'flex'; row.style.gap = '8px'; row.style.alignItems = 'center';
      const btn = document.createElement('button'); btn.className = 'action-btn';
      btn.textContent = cfg[f.key] ? 'Replace image' : 'Upload image';
      const file = document.createElement('input');
      file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
      const rem = document.createElement('button');
      rem.className = 'ghost small'; rem.textContent = 'Remove'; rem.style.display = cfg[f.key] ? '' : 'none';
      btn.onclick = () => file.click();
      file.onchange = () => {
        const fl = file.files && file.files[0];
        if (!fl) return;
        const r = new FileReader();
        r.onload = () => { cfg[f.key] = r.result; btn.textContent = 'Replace image'; rem.style.display = ''; rerender(); };
        r.readAsDataURL(fl);
        file.value = '';
      };
      rem.onclick = () => { cfg[f.key] = ''; btn.textContent = 'Upload image'; rem.style.display = 'none'; rerender(); };
      row.append(btn, rem, file);
      div.appendChild(row);
      const hint = document.createElement('div'); hint.className = 'hint-text'; hint.style.marginTop = '6px';
      hint.textContent = 'PNG/JPG. A solid black background is removed automatically.';
      div.appendChild(hint);
      break;
    }
    case 'action': {
      const b = document.createElement('button'); b.className = 'action-btn';
      b.textContent = f.action === 'import-spc' ? 'Import live SPC outlook' : f.label;
      const status = document.createElement('div'); status.className = 'status';
      b.onclick = async () => {
        if (f.action === 'import-spc') {
          status.textContent = 'Fetching SPC…';
          try { const n = await importSpc(); status.textContent = `Imported ${n} risk areas.`; }
          catch (e) { status.textContent = 'Import failed: ' + e.message; }
        }
      };
      div.append(b, status); break;
    }
    default:
      div.remove(); return document.createComment('skip');
  }
  return div;
}

function renderBrushes() {
  const wrap = document.createElement('div');
  wrap.className = 'brushes';
  const scale = activeScale() || [];
  for (const s of scale) {
    const b = document.createElement('div');
    b.className = 'brush' + (state.brush === s.id ? ' active' : '');
    b.style.background = s.color;
    b.innerHTML = `<span class="brush-swatch" style="background:${s.color}"></span>${s.label}`;
    b.onclick = () => { state.brush = s.id; refreshBrushUI(); };
    wrap.appendChild(b);
  }
  // Custom-color brush: paint regions with any color the user picks.
  const cust = document.createElement('div');
  cust.className = 'brush custom' + (state.brush === 'custom' ? ' active' : '');
  const sw = document.createElement('input');
  sw.type = 'color'; sw.value = state.color; sw.className = 'brush-color';
  sw.oninput = () => { state.color = sw.value; state.brush = 'custom'; syncColorInputs(); refreshBrushUI(); };
  const cl = document.createElement('span'); cl.textContent = 'Custom';
  cust.append(sw, cl);
  cust.onclick = (e) => { if (e.target === sw) return; state.brush = 'custom'; refreshBrushUI(); };
  wrap.appendChild(cust);

  const er = document.createElement('div');
  er.className = 'brush erase' + (state.brush === 'erase' ? ' active' : '');
  er.textContent = '⌫ Erase';
  er.onclick = () => { state.brush = 'erase'; refreshBrushUI(); };
  wrap.appendChild(er);
  return wrap;
}

// Rebuild the brush chips in place (e.g. after recoloring a level).
function refreshBrushPalette() {
  const old = document.querySelector('.brushes');
  if (old) old.replaceWith(renderBrushes());
}

function refreshBrushUI() {
  document.querySelectorAll('.brush').forEach((el) => el.classList.remove('active'));
  const nodes = document.querySelectorAll('.brushes .brush');
  if (state.brush === 'erase') nodes[nodes.length - 1]?.classList.add('active');
  else if (state.brush === 'custom') document.querySelector('.brush.custom')?.classList.add('active');
  else {
    const scale = activeScale() || [];
    const idx = scale.findIndex((s) => s.id === state.brush);
    if (idx >= 0) nodes[idx]?.classList.add('active');
  }
}

// Keep the toolbelt color input and the in-panel custom swatch in sync.
function syncColorInputs() {
  const tc = $('tool-color');
  if (tc) tc.value = state.color;
  document.querySelectorAll('.brush-color').forEach((i) => { i.value = state.color; });
}

function renderThreatsEditor() {
  const wrap = document.createElement('div');
  wrap.className = 'threats-editor';
  const icons = ['hail', 'wind', 'tornado', 'flood', 'snow', 'ice'];
  function redraw() {
    wrap.innerHTML = '';
    state.config.threats.forEach((t, i) => {
      const row = document.createElement('div'); row.className = 'threat-row';
      const sel = document.createElement('select');
      for (const ic of icons) { const o = document.createElement('option'); o.value = ic; o.textContent = ic; if (t.icon === ic) o.selected = true; sel.appendChild(o); }
      sel.onchange = () => { t.icon = sel.value; rerender(); };
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = t.text;
      inp.oninput = () => { t.text = inp.value; rerender(); };
      const del = document.createElement('button'); del.className = 'ghost small'; del.textContent = '✕';
      del.onclick = () => { state.config.threats.splice(i, 1); redraw(); rerender(); };
      row.append(sel, inp, del); wrap.appendChild(row);
    });
    const add = document.createElement('button'); add.className = 'ghost small'; add.textContent = '+ Add threat';
    add.onclick = () => { state.config.threats.push({ icon: 'hail', text: 'New threat' }); redraw(); rerender(); };
    wrap.appendChild(add);
  }
  redraw();
  return wrap;
}

function renderPanelPick() {
  const wrap = document.createElement('div'); wrap.className = 'panelpick';
  (state.config.days || []).forEach((d, i) => {
    const b = document.createElement('div');
    b.className = 'pp' + ((state.config.activePanel ?? 0) === i ? ' active' : '');
    b.textContent = d;
    b.onclick = () => { state.config.activePanel = i; wrap.querySelectorAll('.pp').forEach((x) => x.classList.remove('active')); b.classList.add('active'); rerender(); };
    wrap.appendChild(b);
  });
  return wrap;
}

// Clear painted data when region changes (coords no longer valid).
function resetPaintData() {
  const c = state.config;
  if (c.levels) c.levels = {};
  if (c.values) c.values = {};
  if (c.stateLevels) c.stateLevels = {};
  if (c.panels) c.panels = c.panels.map(() => ({}));
}

// ---- SPC live import -------------------------------------------------------
// Uses the host Vortex Dome's existing /spc/* proxy (server.js) instead of a
// dedicated studio-server endpoint, so the studio runs in-process with no
// separate backend.
async function importSpc() {
  const day = state.config.spcDay || '1';
  // Route through Vortex Radar's server-side CORS proxy (see server.js /api/proxy;
  // spc.noaa.gov is on its allowlist) instead of a Dome-only /spc/ endpoint.
  const res = await fetch(`/api/proxy?url=https://www.spc.noaa.gov/products/outlook/day${day}otlk_cat.nolyr.geojson`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const gj = await res.json();
  state.config.spcFeatures = gj;
  // Templates that gate SPC behind a toggle (State Spotlight) turn it on import.
  if ('showSpc' in state.config) state.config.showSpc = true;
  rerender();
  return gj.features ? gj.features.length : 0;
}

// ---- Canvas interaction ----------------------------------------------------
function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

// Topmost overlay whose drawn rect contains the point (for drag-to-move).
function overlayAt(pt) {
  for (let i = state.overlays.length - 1; i >= 0; i--) {
    const r = state.overlays[i]._rect;
    if (r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return state.overlays[i];
  }
  return null;
}

// Fill tool: click a region to paint it (unless we just dragged an overlay).
canvas.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  if (state.tool !== 'fill') return;
  const { x, y } = canvasPoint(e);
  const hit = scene.pick(x, y);
  if (hit && hit.onClick) hit.onClick();
});

// Freehand brush tools: drag to draw/erase. Fill tool: drag overlays to place.
let drawing = false, curStroke = null, lastPt = null;
let draggingOverlay = null, dragOffset = null, suppressClick = false;

canvas.addEventListener('pointerdown', (e) => {
  const pt = canvasPoint(e);
  if (state.tool === 'fill') {
    const ov = overlayAt(pt);
    if (ov) {
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      draggingOverlay = ov;
      dragOffset = { dx: pt.x - ov.x, dy: pt.y - ov.y };
      suppressClick = true;
    }
    return; // region fill happens on click
  }
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  drawing = true;
  if (state.tool === 'erase') { eraseAt(pt); return; }
  curStroke = { color: state.color, size: state.brushPx, points: [pt] };
  getStrokes().push(curStroke);
  lastPt = pt;
  drawDot(pt, state.color, state.brushPx);
});

canvas.addEventListener('pointermove', (e) => {
  const pt = canvasPoint(e);
  if (draggingOverlay) {
    draggingOverlay.x = Math.round(pt.x - dragOffset.dx);
    draggingOverlay.y = Math.round(pt.y - dragOffset.dy);
    rerender();
    return;
  }
  if (!drawing) {
    if (state.tool === 'fill') canvas.style.cursor = overlayAt(pt) ? 'move' : 'default';
    return;
  }
  if (state.tool === 'erase') { eraseAt(pt); return; }
  curStroke.points.push(pt);
  drawSeg(lastPt, pt, state.color, state.brushPx);
  lastPt = pt;
});

function endDraw() {
  if (draggingOverlay) { draggingOverlay = null; dragOffset = null; return; }
  if (!drawing) return;
  drawing = false; curStroke = null; lastPt = null;
  rerender(); // bake the stroke into the layer stack (correct ordering on export)
}
canvas.addEventListener('pointerup', endDraw);
canvas.addEventListener('pointercancel', endDraw);
canvas.addEventListener('pointerleave', endDraw);

// Draw directly to the canvas while dragging so the brush feels responsive
// without re-rendering the whole scene on every move.
function drawSeg(a, b, color, size) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = color; ctx.lineWidth = size;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.restore();
}
function drawDot(p, color, size) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function eraseAt(pt) {
  const strokes = getStrokes();
  const r = state.brushPx;
  let changed = false;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const hit = strokes[i].points.some((q) => Math.hypot(q.x - pt.x, q.y - pt.y) <= r + strokes[i].size / 2);
    if (hit) { strokes.splice(i, 1); changed = true; }
  }
  if (changed) rerender();
}

function updateHint() {
  const t = state.template;
  const hints = {
    'severe-threat': 'Click counties to paint threat levels. Edit title, region & threat list at right.',
    outlook: 'Import live SPC data, or paint states manually. Edit header & branding at right.',
    'precip-panels': 'Pick the day you are editing, choose a precip type, then click counties.',
    'ice-accum': 'Pick an ice amount, then click counties to paint accumulation.',
    'state-spotlight': 'Pick a state and data set, choose a brush, then click counties. Switch states to go through them one by one.',
    'lower-third': 'Pick a style and edit text. Toggle transparent background for keying in OBS.',
  };
  const base = hints[t.id] || '';
  $('stage-hint').textContent = base
    + (base ? '  ·  ' : '')
    + 'Pick a Custom color to fill regions, switch to the Brush tool to color freely, or add your logo above.';
}

// ---- Toolbar ---------------------------------------------------------------
$('btn-export').onclick = () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  scene.exportPNG(`${state.templateId}_${stamp}.png`, downloadBlob);
};
$('btn-reset').onclick = () => selectTemplate(state.templateId);
$('canvas-size').onchange = (e) => {
  const [w, h] = e.target.value.split('x').map(Number);
  state.size = { w, h };
  scene.resize(w, h);
  rerender();
};

// ---- Tool belt: color brush + logo -----------------------------------------
function setTool(t) {
  state.tool = t;
  $('tool-fill').classList.toggle('active', t === 'fill');
  $('tool-draw').classList.toggle('active', t === 'draw');
  $('tool-erase').classList.toggle('active', t === 'erase');
  canvas.style.cursor = t === 'fill' ? 'default' : 'crosshair';
}
$('tool-fill').onclick = () => setTool('fill');
$('tool-draw').onclick = () => setTool('draw');
$('tool-erase').onclick = () => setTool('erase');
$('tool-color').oninput = (e) => {
  state.color = e.target.value;
  if (state.brush === 'custom') refreshBrushUI();
  syncColorInputs();
};
$('tool-size').oninput = (e) => {
  state.brushPx = +e.target.value;
  $('tool-size-val').textContent = e.target.value;
};
$('tool-clear').onclick = () => { state.config._strokes = []; rerender(); };

// Radar: overlay live NEXRAD base reflectivity, warped to the current view.
function setRadarUI(on) {
  $('radar-toggle').classList.toggle('active', on);
  $('radar-refresh').hidden = !on;
}
async function loadRadar() {
  const btn = $('radar-toggle');
  const label = btn.textContent;
  btn.textContent = '… Radar';
  btn.disabled = true;
  try {
    const opacity = (Number($('radar-opacity').value) || 80) / 100;
    state.radar = await fetchRadar(scene, { opacity });
    setRadarUI(true);
    rerender();
  } catch (err) {
    console.error('[Radar] load failed:', err);
    state.radar = null;
    setRadarUI(false);
    alert('Could not load radar: ' + (err.message || err));
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
}
$('radar-toggle').onclick = () => {
  if (state.radar) { state.radar = null; setRadarUI(false); rerender(); }
  else loadRadar();
};
$('radar-refresh').onclick = () => { if (state.radar) loadRadar(); };
$('radar-opacity').oninput = (e) => {
  if (state.radar) { state.radar.opacity = (Number(e.target.value) || 80) / 100; rerender(); }
};

// Custom logo: upload an image and stamp it on every template.
$('logo-add').onclick = () => $('logo-file').click();
$('logo-file').onchange = (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.logo = { img, src: reader.result, corner: $('logo-corner').value, scale: 0.16 };
      $('logo-remove').hidden = false;
      rerender();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};
$('logo-remove').onclick = () => { state.logo = null; $('logo-remove').hidden = true; rerender(); };
$('logo-corner').onchange = (e) => { if (state.logo) { state.logo.corner = e.target.value; rerender(); } };

// ---- Save / Open project + PSD export --------------------------------------
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Inside the Capacitor app a WebView can't trigger an <a download>, so write the
// file to storage and open the share sheet instead. Plain browsers use <a>.
async function downloadBlob(blob, filename) {
  const C = window.Capacitor;
  if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()
      && C.Plugins && C.Plugins.Filesystem && C.Plugins.Share) {
    try {
      const { Filesystem, Share } = C.Plugins;
      const data = await blobToBase64(blob);
      const res = await Filesystem.writeFile({ path: filename, data, directory: 'CACHE' });
      await Share.share({ title: filename, url: res.uri });
      return;
    } catch (e) {
      console.warn('[studio] native save failed, falling back:', e);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function fileStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Reloadable project file (JSON): captures the whole studio state so a project
// can be reopened later and keep editing — nothing is lost.
function saveProject() {
  const project = {
    format: 'vortex-graphics-project', version: 1,
    templateId: state.templateId,
    size: state.size, color: state.color, brushPx: state.brushPx,
    config: state.config,
    overlays: state.overlays.map(({ _rect, ...rest }) => rest),
    logo: state.logo ? { src: state.logo.src, corner: state.logo.corner, scale: state.logo.scale } : null,
  };
  downloadBlob(new Blob([JSON.stringify(project)], { type: 'application/json' }),
    `${state.templateId}_${fileStamp()}.vortexproj.json`);
}

function loadProject(project) {
  if (!project || project.format !== 'vortex-graphics-project') throw new Error('Not a Vortex project file.');
  const tmpl = TEMPLATE_BY_ID[project.templateId];
  if (!tmpl) throw new Error('Unknown template "' + project.templateId + '".');
  state.templateId = project.templateId;
  state.template = tmpl;
  state.config = project.config || tmpl.defaultConfig();
  state.overlays = Array.isArray(project.overlays) ? project.overlays : [];
  state.size = project.size || state.size;
  state.color = project.color || state.color;
  state.brushPx = project.brushPx || state.brushPx;
  state.logo = null;
  $('logo-remove').hidden = true;
  if (project.logo && project.logo.src) {
    const img = new Image();
    img.onload = () => {
      state.logo = { img, src: project.logo.src, corner: project.logo.corner || 'tr', scale: project.logo.scale ?? 0.16 };
      $('logo-remove').hidden = false;
      $('logo-corner').value = state.logo.corner;
      rerender();
    };
    img.src = project.logo.src;
  }
  const sc = activeScale();
  state.brush = sc ? sc[0].id : null;
  scene.resize(state.size.w, state.size.h);
  $('canvas-size').value = `${state.size.w}x${state.size.h}`;
  $('tool-color').value = normHex(state.color);
  $('tool-size').value = state.brushPx;
  $('tool-size-val').textContent = String(state.brushPx);
  buildRail();
  buildProps();
  rerender();
  updateHint();
}

$('btn-save').onclick = saveProject;
$('btn-open').onclick = () => $('open-project').click();
$('open-project').onchange = (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { loadProject(JSON.parse(reader.result)); }
    catch (err) { alert('Could not open project: ' + err.message); }
  };
  reader.readAsText(file);
  e.target.value = '';
};

// Layered PSD (Photoshop). The writer library is large, so it's loaded on first
// use only. Each logical group becomes its own Photoshop layer.
let agPsdPromise = null;
function loadAgPsd() {
  if (window.agPsd) return Promise.resolve(window.agPsd);
  if (!agPsdPromise) {
    agPsdPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/ag-psd.js';
      s.onload = () => res(window.agPsd);
      s.onerror = () => rej(new Error('failed to load the PSD library.'));
      document.head.appendChild(s);
    });
  }
  return agPsdPromise;
}
// Render a subset of layers to its own canvas (transparent except the base map).
function renderLayerCanvas(addFn) {
  const c = document.createElement('canvas');
  c.width = state.size.w; c.height = state.size.h;
  const s = new Scene(c, { width: state.size.w, height: state.size.h });
  addFn(s);
  s.render();
  return c;
}
async function savePsd() {
  const btn = $('btn-psd');
  const prev = btn.textContent;
  btn.disabled = true; btn.textContent = 'PSD…';
  try {
    const agPsd = await loadAgPsd();
    const children = [];
    // Bottom-to-top: the base graphic, then overlays, drawings, logo.
    children.push({ name: 'Graphic', canvas: renderLayerCanvas((s) => { state.template.build(s, geo, state.config, ctrl); insertSatelliteLayer(s); insertRadarLayer(s); }) });
    if (state.overlays.length) {
      children.push({ name: 'Overlays', canvas: renderLayerCanvas((s) => {
        for (const ov of state.overlays) s.add(ov.type === 'name' ? nameOverlayLayer(ov) : panelOverlayLayer(ov));
      }) });
    }
    if (getStrokes().length) {
      children.push({ name: 'Drawings', canvas: renderLayerCanvas((s) => s.add(freehandLayer(getStrokes()))) });
    }
    if (state.logo && state.logo.img) {
      children.push({ name: 'Logo', canvas: renderLayerCanvas((s) => s.add(logoLayer(state.logo))) });
    }
    rerender(); // refresh the flattened composite used as the merged preview
    const buffer = agPsd.writePsd({ width: state.size.w, height: state.size.h, canvas, children });
    downloadBlob(new Blob([buffer], { type: 'image/vnd.adobe.photoshop' }), `${state.templateId}_${fileStamp()}.psd`);
  } catch (err) {
    alert('Could not export PSD: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = prev;
  }
}
$('btn-psd').onclick = savePsd;

// ---- Boot ------------------------------------------------------------------
(async function boot() {
  scene = new Scene(canvas, { width: state.size.w, height: state.size.h });
  try {
    geo = await loadGeo();
  } catch (e) {
    $('stage-hint').textContent = 'Failed to load map data: ' + e.message;
    return;
  }
  buildRail();
  buildProps();
  setTool('fill');
  rerender();
  updateHint();
})();
