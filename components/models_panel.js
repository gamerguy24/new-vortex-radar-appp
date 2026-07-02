/*
 * components/models_panel.js
 * "Models & Forecast" browser. Opens a panel to explore the NOAA model archives
 * served by the server's /api/models access layer (model_data.js): pick a model,
 * see its latest run, choose a forecast hour, browse the variable list, and pull
 * any single field as a GRIB2 byte-range download. NDFD (element-based) gets a
 * folder browser instead of run/hour/variable.
 */

const API = '/api/models';

let overlay = null;
const state = { model: null, run: null, fhr: 0 };

function j(url) {
  return fetch(url).then((r) => { if (!r.ok) return r.json().then((e) => { throw new Error(e.error || ('HTTP ' + r.status)); }, () => { throw new Error('HTTP ' + r.status); }); return r.json(); });
}
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const pad2 = (n) => String(n).padStart(2, '0');

function fmtRun(run) {
  return `${run.date.slice(0, 4)}-${run.date.slice(4, 6)}-${run.date.slice(6, 8)} ${run.cycle}z`;
}
function validTime(run, fhr) {
  const d = new Date(Date.UTC(+run.date.slice(0, 4), +run.date.slice(4, 6) - 1, +run.date.slice(6, 8), +run.cycle));
  d.setUTCHours(d.getUTCHours() + fhr);
  return `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}z`;
}

function close() { if (overlay) { overlay.remove(); overlay = null; } }

async function open() {
  if (overlay) { close(); return; }
  overlay = el(`<div id="vortexModelsOverlay"><div id="vortexModelsPanel">
    <div class="vmp-head"><span>Models &amp; Forecast</span><button id="vmpClose" class="vmp-x" title="Close">✕</button></div>
    <div class="vmp-body"><div class="vmp-side" id="vmpSide"></div><div class="vmp-main" id="vmpMain"><div class="vmp-hint">Select a model.</div></div></div>
  </div></div>`);
  document.body.appendChild(overlay);
  document.getElementById('vmpClose').onclick = close;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  try {
    const { models } = await j(API);
    const side = document.getElementById('vmpSide');
    side.innerHTML = '';
    for (const m of models) {
      const b = el(`<button class="vmp-model" data-id="${m.id}">${esc(m.name)}</button>`);
      b.onclick = () => selectModel(m);
      side.appendChild(b);
    }
  } catch (e) {
    document.getElementById('vmpMain').innerHTML = `<div class="vmp-err">Could not load models: ${esc(e.message)}</div>`;
  }
}

async function selectModel(m) {
  state.model = m;
  document.querySelectorAll('.vmp-model').forEach((b) => b.classList.toggle('active', b.dataset.id === m.id));
  const main = document.getElementById('vmpMain');
  main.innerHTML = `<div class="vmp-title">${esc(m.name)}</div><div class="vmp-status" id="vmpStatus">Loading…</div><div id="vmpControls"></div><div id="vmpList" class="vmp-list"></div>`;
  const status = document.getElementById('vmpStatus');
  try {
    if (m.type === 'browse') { status.textContent = 'Browse elements'; await browse(m); return; }
    const run = await j(`${API}/${m.id}/latest`);
    state.run = run;
    const { hours } = await j(`${API}/${m.id}/hours?date=${run.date}&cycle=${run.cycle}`);
    status.innerHTML = `Latest run <b>${fmtRun(run)}</b> · ${hours.length} forecast hours`;
    document.getElementById('vmpControls').innerHTML = `
      <label class="vmp-field">Forecast hour
        <select id="vmpFhr">${hours.map((h) => `<option value="${h}">f${pad2(h)} · valid ${validTime(run, h)}</option>`).join('')}</select>
      </label>
      <input id="vmpFilter" class="vmp-filter" placeholder="Filter variables (e.g. TMP, REFC)…" />`;
    document.getElementById('vmpFhr').onchange = (e) => loadIndex(m, run, Number(e.target.value));
    document.getElementById('vmpFilter').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#vmpList .vmp-row').forEach((r) => { r.style.display = (r.dataset.txt || '').includes(q) ? '' : 'none'; });
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
      const url = `${API}/${m.id}/grib?date=${run.date}&cycle=${run.cycle}&fhr=${fhr}&msg=${mm.n}`;
      const row = el(`<div class="vmp-row" data-txt="${esc((mm.variable + ' ' + mm.level + ' ' + mm.forecast).toLowerCase())}">
        <div class="vmp-var">${esc(mm.variable)}</div>
        <div class="vmp-meta">${esc(mm.level)} · ${esc(mm.forecast)}${kb ? ` · ${kb} KB` : ''}</div>
        <a class="vmp-dl" href="${url}" download="${m.id}_${mm.variable}_f${pad2(fhr)}.grib2">GRIB2</a></div>`);
      list.appendChild(row);
    }
  } catch (e) { list.innerHTML = `<div class="vmp-err">${esc(e.message)}</div>`; }
}

function parentPrefix(p) {
  const t = p.replace(/\/$/, '');
  const i = t.lastIndexOf('/');
  return i >= 0 ? t.slice(0, i + 1) : '';
}

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
      const r = el(`<div class="vmp-row"><div class="vmp-var">${esc(k.split('/').pop())}</div><a class="vmp-dl" href="${url}" download>GRIB2</a></div>`);
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
