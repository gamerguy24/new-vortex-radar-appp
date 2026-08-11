/*
 * components/models_panel.js
 * "Models & Forecast" browser. Explores the NOAA model archives served by the
 * server's /api/models access layer (model_data.js) — real GRIB2 pulled live
 * from the public NOAA Open Data S3 buckets — and plots any field on the map by
 * decoding + colorizing it server-side (/field -> PNG overlay). Plot is a toggle;
 * the panel docks to the left so the map stays visible while you switch fields.
 */

const API = '/api/models';
const MODEL_SRC = 'vortex-model-src';
const MODEL_LAYER = 'vortex-model-layer';

let panel = null;
const state = {
  model: null, run: null, fhr: 0, opacity: 0.8, plotted: null,
  hours: [], hourIdx: 0, messages: [], activePreset: null, playing: false, timer: null,
};

function j(url) {
  return fetch(url).then((r) => {
    if (!r.ok) return r.json().then((e) => { throw new Error(e.error || ('HTTP ' + r.status)); }, () => { throw new Error('HTTP ' + r.status); });
    return r.json();
  });
}
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const pad2 = (n) => String(n).padStart(2, '0');

// Curated quick-pick fields (resolved against the run's index; variable + a
// level matcher). Covers the common broadcast fields; missing ones are hidden.
const PRESETS = [
  { label: '2 m Temp', v: 'TMP', lvl: '2 m above ground', icon: '🌡️' },
  { label: 'Reflectivity', v: 'REFC', lvl: 'entire atmosphere', icon: '📡' },
  { label: 'MSLP', v: 'PRMSL', lvl: 'mean sea level', icon: '🌀' },
  { label: 'Surface CAPE', v: 'CAPE', lvl: 'surface', icon: '⚡' },
  { label: 'Precip. Water', v: 'PWAT', lvl: 'entire atmosphere', icon: '💧' },
  { label: '850 mb Temp', v: 'TMP', lvl: '850 mb', icon: '🌡️' },
  { label: '500 mb Temp', v: 'TMP', lvl: '500 mb', icon: '❄️' },
  { label: 'Total Precip', v: 'APCP', lvl: 'surface', icon: '🌧️' },
];
const CONUS_BBOX = '-125,24,-66.5,50';
// Find the index message matching a preset (variable exact; level starts-with).
function resolvePreset(messages, p) {
  const v = p.v.toUpperCase(), lvl = p.lvl.toLowerCase();
  return messages.find((m) => m.variable.toUpperCase() === v && m.level.toLowerCase().startsWith(lvl)) || null;
}

function injectPhase2Styles() {
  if (document.getElementById('vmp-p2-styles')) return;
  const s = document.createElement('style');
  s.id = 'vmp-p2-styles';
  s.textContent = `
    .vmp-sub{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:#7f93b0;margin:2px 0 8px;}
    /* Quick-field cards with thumbnails */
    .vmp-cards{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:2px 0 6px;}
    .vmp-card{position:relative;border-radius:12px;overflow:hidden;cursor:pointer;
      border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));transition:all .12s;}
    .vmp-card:hover{border-color:rgba(39,190,255,.4);transform:translateY(-1px);}
    .vmp-card.active{border-color:#33c2ff;box-shadow:0 0 0 1px #33c2ff,0 6px 18px rgba(39,190,255,.32);}
    .vmp-card-thumb{width:100%;height:60px;display:block;object-fit:cover;background:#0a1424;
      border-bottom:1px solid rgba(255,255,255,.06);opacity:0;transition:opacity .3s;}
    .vmp-card-thumb.loaded{opacity:1;}
    .vmp-card-ph{position:absolute;top:0;left:0;right:0;height:60px;display:flex;align-items:center;justify-content:center;
      font-size:22px;background:linear-gradient(135deg,rgba(39,190,255,.12),rgba(39,190,255,0));pointer-events:none;}
    .vmp-card-lbl{padding:7px 9px;font-size:11.5px;font-weight:700;color:#dbe6f5;}
    .vmp-card.active .vmp-card-lbl{color:#eaf3ff;}
    /* Advanced (all variables) collapsible */
    .vmp-adv{margin-top:8px;}
    .vmp-adv-toggle{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:10.5px;font-weight:700;
      text-transform:uppercase;letter-spacing:.09em;color:#7f93b0;padding:6px 0;user-select:none;}
    .vmp-adv-toggle:hover{color:#aab9cc;}
    .vmp-adv-chev{transition:transform .15s;display:inline-block;}
    .vmp-adv.open .vmp-adv-chev{transform:rotate(90deg);}
    .vmp-adv-body{display:none;}
    .vmp-adv.open .vmp-adv-body{display:block;}
    .vmp-scrub{display:flex;align-items:center;gap:6px;margin:2px 0 13px;padding:7px;border-radius:12px;
      background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);}
    .vmp-scrub button{width:34px;height:32px;border-radius:9px;border:1px solid rgba(255,255,255,.1);
      background:rgba(255,255,255,.05);color:#e7eef7;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all .12s;}
    .vmp-scrub button:hover{background:rgba(39,190,255,.15);border-color:rgba(39,190,255,.3);}
    .vmp-scrub select{flex:0 1 auto;min-width:0;background:rgba(255,255,255,.05);color:#e7eef7;
      border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:7px 9px;font-size:12.5px;font-family:inherit;}
    .vmp-scrub select:focus{outline:none;border-color:#27beff;}
    .vmp-scrub .vmp-fhrlabel{font-size:11px;color:#8ea4bd;flex:1;text-align:right;font-weight:600;white-space:nowrap;}
    #vortexModelLegend{position:absolute;right:16px;bottom:96px;z-index:60;
      background:linear-gradient(180deg,rgba(17,25,42,.95),rgba(9,14,26,.95));
      border:1px solid rgba(255,255,255,.12);border-radius:13px;padding:12px 14px;color:#eef4fb;
      font-family:'Onest',system-ui,sans-serif;box-shadow:0 16px 38px rgba(0,0,0,.55);min-width:206px;
      -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);}
    #vortexModelLegend .vml-title{font-size:12px;font-weight:800;margin-bottom:8px;letter-spacing:.2px;}
    #vortexModelLegend .vml-bar{height:13px;border-radius:7px;border:1px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 2px rgba(0,0,0,.35);}
    #vortexModelLegend .vml-scale{display:flex;justify-content:space-between;font-size:10px;opacity:.72;margin-top:5px;font-weight:600;}`;
  document.head.appendChild(s);
}

function fmtRun(run) { return `${run.date.slice(0, 4)}-${run.date.slice(4, 6)}-${run.date.slice(6, 8)} ${run.cycle}z`; }
function validTime(run, fhr) {
  const d = new Date(Date.UTC(+run.date.slice(0, 4), +run.date.slice(4, 6) - 1, +run.date.slice(6, 8), +run.cycle));
  d.setUTCHours(d.getUTCHours() + fhr);
  return `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}z`;
}

function mapObj() { return window.vortexMap && window.vortexMap.map; }

function clearOverlay() {
  const map = mapObj();
  if (map) {
    if (map.getLayer(MODEL_LAYER)) map.removeLayer(MODEL_LAYER);
    if (map.getSource(MODEL_SRC)) map.removeSource(MODEL_SRC);
  }
  if (state.plotted && state.plotted.objUrl) { try { URL.revokeObjectURL(state.plotted.objUrl); } catch (e) {} }
  state.plotted = null;
  clearLegend();
  markActive();
}

// On-map legend built from the /field response's X-Legend header.
function clearLegend() { const el = document.getElementById('vortexModelLegend'); if (el) el.remove(); }
function drawLegend(legend, title) {
  clearLegend();
  if (!legend || !legend.stops || !legend.stops.length) return;
  const stops = legend.stops;
  const min = stops[0][0], max = stops[stops.length - 1][0];
  const span = (max - min) || 1;
  const grad = stops.map(([val, col]) => `${col} ${((val - min) / span * 100).toFixed(1)}%`).join(', ');
  const mid = stops[Math.floor(stops.length / 2)][0];
  const el = document.createElement('div');
  el.id = 'vortexModelLegend';
  el.innerHTML = `<div class="vml-title">${esc(title)} <span style="opacity:.6">(${esc(legend.unit || '')})</span></div>
    <div class="vml-bar" style="background:linear-gradient(90deg, ${grad})"></div>
    <div class="vml-scale"><span>${min}</span><span>${mid}</span><span>${max}</span></div>`;
  document.body.appendChild(el);
}

// Toggle a field overlay on the map. Fetches the rendered PNG so failures are
// visible (e.g. server not restarted after adding /field) rather than silent.
async function plotField(m, msg, btn) {
  const map = mapObj();
  if (!map) { alert('Map is not ready yet.'); return; }
  // Clicking the field that's already plotted turns it off.
  if (state.plotted && state.plotted.model === m.id && state.plotted.msg === msg.n) { clearOverlay(); return; }

  const b = map.getBounds();
  const W = Math.max(-179, b.getWest()), E = Math.min(179, b.getEast());
  const S = Math.max(-85, b.getSouth()), N = Math.min(85, b.getNorth());
  const bbox = `${W.toFixed(3)},${S.toFixed(3)},${E.toFixed(3)},${N.toFixed(3)}`;
  const url = `${API}/${m.id}/field?date=${state.run.date}&cycle=${state.run.cycle}&fhr=${state.fhr}&msg=${msg.n}&bbox=${bbox}`;

  const label = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '…'; btn.disabled = true; }
  try {
    const res = await fetch(url);
    if (!res.ok) {
      let m2 = 'HTTP ' + res.status;
      try { m2 = (await res.json()).error || m2; } catch (e) {}
      throw new Error(m2);
    }
    let legend = null;
    try { legend = JSON.parse(res.headers.get('X-Legend') || 'null'); } catch (e) {}
    const vLabel = `${res.headers.get('X-Var') || msg.variable} · ${res.headers.get('X-Level') || msg.level}`;
    const objUrl = URL.createObjectURL(await res.blob());
    clearOverlay();
    map.addSource(MODEL_SRC, { type: 'image', url: objUrl, coordinates: [[W, N], [E, N], [E, S], [W, S]] });
    map.addLayer({
      id: MODEL_LAYER, type: 'raster', source: MODEL_SRC,
      paint: { 'raster-opacity': state.opacity, 'raster-fade-duration': 0 },
    }, map.getLayer('baseReflectivity') ? 'baseReflectivity' : undefined);
    state.plotted = { model: m.id, msg: msg.n, objUrl };
    drawLegend(legend, vLabel);
    markActive();
  } catch (e) {
    alert('Could not plot this field:\n' + e.message
      + (/404/.test(e.message) ? '\n\nTip: the /field endpoint is new — restart the server (npm start) so it loads.' : ''));
  } finally {
    if (btn) { btn.disabled = false; }
    markActive(label);
  }
}

function markActive(fallbackLabel) {
  if (!panel) return;
  panel.querySelectorAll('.vmp-row').forEach((row) => {
    const on = state.plotted && String(row.dataset.msg) === String(state.plotted.msg) && state.model && state.plotted.model === state.model.id;
    const btn = row.querySelector('.vmp-plot');
    if (btn) { btn.textContent = on ? 'On' : 'Plot'; btn.classList.toggle('active', !!on); }
  });
}

function close() { stopPlay(); clearLegend(); if (panel) { panel.remove(); panel = null; } }

async function open() {
  if (panel) { close(); return; }
  injectPhase2Styles();
  panel = el(`<div id="vortexModelsPanel">
    <div class="vmp-head"><span>Models &amp; Forecast</span>
      <span class="vmp-head-actions">
        <button id="vmpClear" class="vmp-clear" title="Remove the model overlay">Clear</button>
        <button id="vmpClose" class="vmp-x" title="Close">✕</button>
      </span>
    </div>
    <div class="vmp-models" id="vmpSide"></div>
    <div class="vmp-main" id="vmpMain"><div class="vmp-hint">Select a model above.</div></div>
    <div class="vmp-foot">
      <label class="vmp-op">Overlay opacity <input type="range" id="vmpOpacity" min="20" max="100" value="${Math.round(state.opacity * 100)}"></label>
    </div>
  </div>`);
  document.body.appendChild(panel);
  document.getElementById('vmpClose').onclick = close;
  document.getElementById('vmpClear').onclick = clearOverlay;
  document.getElementById('vmpOpacity').oninput = (e) => {
    state.opacity = (Number(e.target.value) || 80) / 100;
    const map = mapObj();
    if (map && map.getLayer(MODEL_LAYER)) map.setPaintProperty(MODEL_LAYER, 'raster-opacity', state.opacity);
  };

  try {
    const { models } = await j(API);
    const side = document.getElementById('vmpSide');
    side.innerHTML = '';
    for (const m of models) {
      const b = el(`<button class="vmp-model" data-id="${m.id}">${esc(m.name.split(' (')[0])}</button>`);
      b.title = m.name;
      b.onclick = () => selectModel(m);
      side.appendChild(b);
    }
    // Smoother flow: auto-open a model so you land on fields (prefer GFS — it
    // decodes cleanly; some HRRR products are JPEG2000-packed and won't render).
    const first = models.find((m) => m.id === 'gfs') || models.find((m) => m.type === 'cycle') || models[0];
    if (first) selectModel(first);
  } catch (e) {
    document.getElementById('vmpMain').innerHTML = `<div class="vmp-err">Could not load models: ${esc(e.message)}</div>`;
  }
}

async function selectModel(m) {
  state.model = m;
  _thumbCache = { model: m.id, byLabel: {} };  // fresh thumbnails per model
  panel.querySelectorAll('.vmp-model').forEach((b) => b.classList.toggle('active', b.dataset.id === m.id));
  const main = document.getElementById('vmpMain');
  main.innerHTML = `<div class="vmp-title">${esc(m.name)}</div><div class="vmp-status" id="vmpStatus">Loading…</div><div id="vmpControls"></div>`;
  const status = document.getElementById('vmpStatus');
  try {
    if (m.type === 'browse') { status.innerHTML = `<span class="vmp-src">Live · <b>${esc(m.bucket)}</b> (NOAA Open Data on AWS)</span>`; await browse(m); return; }
    const run = await j(`${API}/${m.id}/latest`);
    state.run = run;
    const { hours } = await j(`${API}/${m.id}/hours?date=${run.date}&cycle=${run.cycle}`);
    status.innerHTML = `<span class="vmp-src">Live · <b>${esc(m.bucket)}</b> (NOAA Open Data on AWS)</span><br>Run <b>${fmtRun(run)}</b> · ${hours.length} forecast hours`;
    state.hours = hours; state.hourIdx = 0; state.activePreset = null;
    document.getElementById('vmpControls').innerHTML = `
      <div class="vmp-scrub">
        <button id="vmpPrev" title="Previous hour">◀</button>
        <select id="vmpFhr">${hours.map((h) => `<option value="${h}">f${pad2(h)} · valid ${validTime(run, h)}</option>`).join('')}</select>
        <button id="vmpNext" title="Next hour">▶</button>
        <button id="vmpPlay" title="Animate forecast hours">▶︎</button>
        <span class="vmp-fhrlabel" id="vmpFhrLabel"></span>
      </div>
      <div class="vmp-sub">Quick fields</div>
      <div id="vmpPresets" class="vmp-cards"></div>
      <div class="vmp-adv" id="vmpAdv">
        <div class="vmp-adv-toggle" id="vmpAdvToggle"><span class="vmp-adv-chev">▸</span> All variables</div>
        <div class="vmp-adv-body">
          <input id="vmpFilter" class="vmp-filter" placeholder="Filter variables (TMP, REFC, APCP…)" />
          <div id="vmpList" class="vmp-list"></div>
        </div>
      </div>`;
    document.getElementById('vmpFhr').onchange = (e) => { stopPlay(); setHour(state.hours.indexOf(Number(e.target.value))); };
    document.getElementById('vmpPrev').onclick = () => { stopPlay(); setHour(state.hourIdx - 1); };
    document.getElementById('vmpNext').onclick = () => { stopPlay(); setHour(state.hourIdx + 1); };
    document.getElementById('vmpPlay').onclick = togglePlay;
    document.getElementById('vmpAdvToggle').onclick = () => document.getElementById('vmpAdv').classList.toggle('open');
    document.getElementById('vmpFilter').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      panel.querySelectorAll('#vmpList .vmp-row').forEach((r) => { r.style.display = (r.dataset.txt || '').includes(q) ? '' : 'none'; });
    };
    await loadIndex(m, run, hours[0] || 0);
  } catch (e) { status.innerHTML = `<span class="vmp-err">${esc(e.message)}</span>`; }
}

// Curated quick-pick CARDS (with lazy thumbnails) for fields present in the run.
function renderPresets(m) {
  const wrap = document.getElementById('vmpPresets');
  if (!wrap) return;
  wrap.innerHTML = '';
  const thumbs = [];
  for (const p of PRESETS) {
    const msg = resolvePreset(state.messages, p);
    if (!msg) continue;
    const active = state.activePreset && state.activePreset.label === p.label;
    const card = el(`<div class="vmp-card${active ? ' active' : ''}" data-msg="${msg.n}">
        <div class="vmp-card-ph">${p.icon || '▦'}</div>
        <img class="vmp-card-thumb" alt="">
        <div class="vmp-card-lbl">${esc(p.label)}</div>
      </div>`);
    card.onclick = () => {
      const isOn = state.activePreset && state.activePreset.label === p.label && state.plotted && state.plotted.msg === msg.n;
      if (isOn) { state.activePreset = null; clearOverlay(); renderPresets(m); return; }
      state.activePreset = p; plotField(m, msg, null); renderPresets(m); prefetchHour(state.hourIdx + 1);
    };
    wrap.appendChild(card);
    const img = card.querySelector('.vmp-card-thumb');
    const ph = card.querySelector('.vmp-card-ph');
    const cached = _thumbCache.model === m.id && _thumbCache.byLabel[p.label];
    if (cached) { img.onload = () => { img.classList.add('loaded'); ph.style.display = 'none'; }; img.src = cached; }
    else { thumbs.push({ img, ph, msg, label: p.label }); }
  }
  if (thumbs.length) loadThumbs(m, thumbs);
}

// Small CONUS thumbnails, cached per model so hour changes don't re-fetch them.
let _thumbSeq = 0;
let _thumbCache = { model: null, byLabel: {} };
function loadThumbs(m, thumbs) {
  const seq = ++_thumbSeq;
  let i = 0;
  const worker = async () => {
    while (i < thumbs.length && seq === _thumbSeq) {
      const t = thumbs[i++];
      const url = `${API}/${m.id}/field?date=${state.run.date}&cycle=${state.run.cycle}&fhr=${state.fhr}&msg=${t.msg.n}&bbox=${CONUS_BBOX}&w=240`;
      try {
        const res = await fetch(url);
        if (!res.ok || seq !== _thumbSeq) continue;
        const obj = URL.createObjectURL(await res.blob());
        _thumbCache.byLabel[t.label] = obj;
        t.img.onload = () => { t.img.classList.add('loaded'); if (t.ph) t.ph.style.display = 'none'; };
        t.img.src = obj;
      } catch (e) { /* leave placeholder */ }
    }
  };
  worker(); worker();
}

function updateHourLabel() {
  const lab = document.getElementById('vmpFhrLabel');
  if (lab && state.run) lab.textContent = `f${pad2(state.fhr)} · valid ${validTime(state.run, state.fhr)}`;
}

// Jump to an hour by index into state.hours; reloads the index + replots active preset.
async function setHour(idx) {
  if (!state.hours.length) return;
  idx = Math.max(0, Math.min(state.hours.length - 1, idx));
  state.hourIdx = idx;
  const fhr = state.hours[idx];
  const sel = document.getElementById('vmpFhr');
  if (sel) sel.value = String(fhr);
  await loadIndex(state.model, state.run, fhr);
}

// Warm the server PNG cache for the active preset at a future hour.
function prefetchHour(idx) {
  if (!state.activePreset || idx < 0 || idx >= state.hours.length) return;
  const m = state.model, fhr = state.hours[idx];
  fetch(`${API}/${m.id}/index?date=${state.run.date}&cycle=${state.run.cycle}&fhr=${fhr}`)
    .then((r) => r.json()).then((idxData) => {
      const msg = resolvePreset(idxData.messages || [], state.activePreset);
      if (!msg) return;
      const map = mapObj(); if (!map) return;
      const b = map.getBounds();
      const bbox = `${Math.max(-179, b.getWest()).toFixed(3)},${Math.max(-85, b.getSouth()).toFixed(3)},${Math.min(179, b.getEast()).toFixed(3)},${Math.min(85, b.getNorth()).toFixed(3)}`;
      fetch(`${API}/${m.id}/field?date=${state.run.date}&cycle=${state.run.cycle}&fhr=${fhr}&msg=${msg.n}&bbox=${bbox}`).catch(() => {});
    }).catch(() => {});
}

function stopPlay() {
  state.playing = false;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  const b = document.getElementById('vmpPlay'); if (b) b.textContent = '▶︎';
}
function togglePlay() {
  if (state.playing) { stopPlay(); return; }
  if (!state.activePreset) { alert('Pick a quick field first, then press play to animate it.'); return; }
  state.playing = true;
  const b = document.getElementById('vmpPlay'); if (b) b.textContent = '⏸';
  state.timer = setInterval(async () => {
    let next = state.hourIdx + 1; if (next >= state.hours.length) next = 0;
    await setHour(next);
    prefetchHour(next + 1);
  }, 1100);
}

async function loadIndex(m, run, fhr) {
  state.fhr = fhr; state.model = m; state.run = run;
  updateHourLabel();
  const list = document.getElementById('vmpList');
  list.innerHTML = '<div class="vmp-hint">Loading variables…</div>';
  try {
    const idx = await j(`${API}/${m.id}/index?date=${run.date}&cycle=${run.cycle}&fhr=${fhr}`);
    state.messages = idx.messages || [];
    renderPresets(m);
    // Replot the active preset at the (possibly new) hour.
    if (state.activePreset) {
      const pm = resolvePreset(state.messages, state.activePreset);
      if (pm) plotField(m, pm, null);
    }
    list.innerHTML = '';
    for (const mm of idx.messages) {
      const kb = mm.end != null ? Math.round((mm.end - mm.start + 1) / 1024) : null;
      const dl = `${API}/${m.id}/grib?date=${run.date}&cycle=${run.cycle}&fhr=${fhr}&msg=${mm.n}`;
      const row = el(`<div class="vmp-row" data-msg="${mm.n}" data-txt="${esc((mm.variable + ' ' + mm.level + ' ' + mm.forecast).toLowerCase())}">
        <div class="vmp-info"><div class="vmp-var">${esc(mm.variable)}</div><div class="vmp-meta">${esc(mm.level)} · ${esc(mm.forecast)}${kb ? ` · ${kb} KB` : ''}</div></div>
        <button class="vmp-plot" title="Toggle this field on the map">Plot</button>
        <a class="vmp-dl" href="${dl}" download="${m.id}_${mm.variable}_f${pad2(fhr)}.grib2" title="Download raw GRIB2">⤓</a></div>`);
      row.querySelector('.vmp-plot').addEventListener('click', (ev) => plotField(m, mm, ev.currentTarget));
      list.appendChild(row);
    }
    markActive();
  } catch (e) { list.innerHTML = `<div class="vmp-err">${esc(e.message)}</div>`; }
}

function parentPrefix(p) { const t = p.replace(/\/$/, ''); const i = t.lastIndexOf('/'); return i >= 0 ? t.slice(0, i + 1) : ''; }

async function browse(m, prefix) {
  const list = document.getElementById('vmpList');
  list.innerHTML = '<div class="vmp-hint">Loading…</div>';
  try {
    const data = await j(`${API}/${m.id}/list${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`);
    list.innerHTML = '';
    if (data.prefix && !data.prefix.endsWith('AR.conus/') && data.prefix !== '') {
      const up = el('<div class="vmp-row vmp-nav">📁  ..</div>');
      up.onclick = () => browse(m, parentPrefix(data.prefix));
      list.appendChild(up);
    }
    for (const pre of data.prefixes) {
      const r = el(`<div class="vmp-row vmp-nav">📁  ${esc(pre.replace(data.prefix, ''))}</div>`);
      r.onclick = () => browse(m, pre);
      list.appendChild(r);
    }
    for (const k of data.keys) {
      const url = `${API}/${m.id}/grib?key=${encodeURIComponent(k)}`;
      const r = el(`<div class="vmp-row"><div class="vmp-info"><div class="vmp-var">${esc(k.split('/').pop())}</div></div><a class="vmp-dl" href="${url}" download>⤓</a></div>`);
      list.appendChild(r);
    }
    if (!data.prefixes.length && !data.keys.length) list.innerHTML = '<div class="vmp-hint">Empty.</div>';
  } catch (e) { list.innerHTML = `<div class="vmp-err">${esc(e.message)}</div>`; }
}

function init() {
  const btn = document.getElementById('vortexModelsBtn');
  if (btn) btn.addEventListener('click', open);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
