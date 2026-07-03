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
const state = { model: null, run: null, fhr: 0, opacity: 0.8, plotted: null };

function j(url) {
  return fetch(url).then((r) => {
    if (!r.ok) return r.json().then((e) => { throw new Error(e.error || ('HTTP ' + r.status)); }, () => { throw new Error('HTTP ' + r.status); });
    return r.json();
  });
}
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const pad2 = (n) => String(n).padStart(2, '0');

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
  markActive();
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
    const objUrl = URL.createObjectURL(await res.blob());
    clearOverlay();
    map.addSource(MODEL_SRC, { type: 'image', url: objUrl, coordinates: [[W, N], [E, N], [E, S], [W, S]] });
    map.addLayer({
      id: MODEL_LAYER, type: 'raster', source: MODEL_SRC,
      paint: { 'raster-opacity': state.opacity, 'raster-fade-duration': 0 },
    }, map.getLayer('baseReflectivity') ? 'baseReflectivity' : undefined);
    state.plotted = { model: m.id, msg: msg.n, objUrl };
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

function close() { if (panel) { panel.remove(); panel = null; } }

async function open() {
  if (panel) { close(); return; }
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
  } catch (e) {
    document.getElementById('vmpMain').innerHTML = `<div class="vmp-err">Could not load models: ${esc(e.message)}</div>`;
  }
}

async function selectModel(m) {
  state.model = m;
  panel.querySelectorAll('.vmp-model').forEach((b) => b.classList.toggle('active', b.dataset.id === m.id));
  const main = document.getElementById('vmpMain');
  main.innerHTML = `<div class="vmp-title">${esc(m.name)}</div><div class="vmp-status" id="vmpStatus">Loading…</div><div id="vmpControls"></div><div id="vmpList" class="vmp-list"></div>`;
  const status = document.getElementById('vmpStatus');
  try {
    if (m.type === 'browse') { status.innerHTML = `<span class="vmp-src">Live · <b>${esc(m.bucket)}</b> (NOAA Open Data on AWS)</span>`; await browse(m); return; }
    const run = await j(`${API}/${m.id}/latest`);
    state.run = run;
    const { hours } = await j(`${API}/${m.id}/hours?date=${run.date}&cycle=${run.cycle}`);
    status.innerHTML = `<span class="vmp-src">Live · <b>${esc(m.bucket)}</b> (NOAA Open Data on AWS)</span><br>Run <b>${fmtRun(run)}</b> · ${hours.length} forecast hours`;
    document.getElementById('vmpControls').innerHTML = `
      <label class="vmp-field">Forecast hour
        <select id="vmpFhr">${hours.map((h) => `<option value="${h}">f${pad2(h)} · valid ${validTime(run, h)}</option>`).join('')}</select>
      </label>
      <input id="vmpFilter" class="vmp-filter" placeholder="Filter variables (TMP, REFC, APCP…)" />`;
    document.getElementById('vmpFhr').onchange = (e) => loadIndex(m, run, Number(e.target.value));
    document.getElementById('vmpFilter').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      panel.querySelectorAll('#vmpList .vmp-row').forEach((r) => { r.style.display = (r.dataset.txt || '').includes(q) ? '' : 'none'; });
    };
    await loadIndex(m, run, hours[0] || 0);
  } catch (e) { status.innerHTML = `<span class="vmp-err">${esc(e.message)}</span>`; }
}

async function loadIndex(m, run, fhr) {
  state.fhr = fhr;
  const list = document.getElementById('vmpList');
  list.innerHTML = '<div class="vmp-hint">Loading variables…</div>';
  try {
    const idx = await j(`${API}/${m.id}/index?date=${run.date}&cycle=${run.cycle}&fhr=${fhr}`);
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
