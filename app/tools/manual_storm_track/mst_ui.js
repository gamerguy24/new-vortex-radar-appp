/*
 * mst_ui.js
 * DOM for the Manual Storm Track tool: the "Enter Speed" popup that appears
 * where the user finishes dragging, the "Impact Times" panel that lists the
 * communities in the storm's path, and a small mode toggle (Cellular / Linear).
 * Presentation only — the controller wires the callbacks.
 */

function injectStyles() {
    if (document.getElementById('mst-styles')) return;
    const s = document.createElement('style');
    s.id = 'mst-styles';
    s.textContent = `
    .mst-card{position:absolute;z-index:100060;background:var(--vx-surface);color:#e5edff;
      border-radius:var(--vx-r-3);border:1px solid #2b3c5e;box-shadow:0 12px 34px rgba(0,0,0,.55);
      font-family:var(--vx-font);-webkit-user-select:none;user-select:none}
    .mst-speed{width:190px;padding:12px 13px}
    .mst-speed .mst-title{font-weight:800;font-size:14px;margin-bottom:9px}
    .mst-speed-row{display:flex;gap:7px;align-items:center;margin-bottom:10px}
    .mst-speed input{flex:1;min-width:0;background:#0a1220;border:1px solid #33456a;color:#fff;
      border-radius:var(--vx-r-2);padding:8px 10px;font-size:15px;font-weight:700;outline:none}
    .mst-speed input:focus{border-color:var(--vx-accent)}
    .mst-speed .mst-unit{font-size:12px;opacity:.75;font-weight:700}
    .mst-btn{width:100%;border:none;border-radius:var(--vx-r-2);padding:9px;font-size:14px;font-weight:800;
      cursor:pointer;background:#1f7ae0;color:#fff}
    .mst-btn:hover{background:#2a8bf5}
    .mst-btn:disabled{opacity:.5;cursor:default}
    .mst-speed .mst-x{position:absolute;top:6px;right:9px;cursor:pointer;opacity:.6;font-size:15px;line-height:1}
    .mst-speed .mst-x:hover{opacity:1}

    .mst-panel{top:64px;right:12px;width:236px;max-width:70vw;padding:0;overflow:hidden}
    .mst-panel-head{display:flex;align-items:center;justify-content:space-between;
      padding:10px 12px;background:#132340;border-bottom:1px solid #22344f}
    .mst-panel-head .mst-title{font-weight:800;font-size:14px}
    .mst-panel-head .mst-x{cursor:pointer;opacity:.65;font-size:16px;line-height:1}
    .mst-panel-head .mst-x:hover{opacity:1}
    .mst-rows{max-height:44vh;overflow-y:auto;padding:6px 0}
    .mst-row{display:flex;justify-content:space-between;gap:12px;padding:5px 12px;font-size:12.5px}
    .mst-row span{opacity:.9}
    .mst-row b{white-space:nowrap;font-variant-numeric:tabular-nums}
    .mst-row .mst-eta{color:#7fd7ff}
    .mst-empty{padding:12px;font-size:12.5px;opacity:.8;font-style:italic}
    .mst-foot{padding:9px 12px;border-top:1px solid #22344f;font-size:12.5px}
    .mst-foot .mst-pop{display:flex;justify-content:space-between}
    .mst-foot b{font-weight:800}
    .mst-foot .mst-clear{margin-top:9px;background:#27324a}
    .mst-foot .mst-clear:hover{background:#33425f}

    .mst-mode{top:64px;left:50%;transform:translateX(-50%);padding:5px;display:flex;gap:4px}
    .mst-mode button{border:none;background:transparent;color:#cdd9f0;font-weight:700;font-size:12.5px;
      padding:6px 14px;border-radius:var(--vx-r-2);cursor:pointer;font-family:inherit}
    .mst-mode button.on{background:#1f7ae0;color:#fff}
    .mst-hint{position:absolute;bottom:auto;top:108px;left:50%;transform:translateX(-50%);
      z-index:100060;background:var(--vx-surface);color:#cdd9f0;border:1px solid #22344f;
      border-radius:var(--vx-r-3);padding:6px 14px;font-size:12px;font-family:var(--vx-font);
      pointer-events:none;white-space:nowrap}`;
    document.head.appendChild(s);
}

const fmtPop = (n) => (n >= 1000 ? n.toLocaleString() : String(n));

// ---- mode toggle + drag hint -------------------------------------------------
function showModeBar(getMode, onChange) {
    injectStyles();
    removeModeBar();
    const bar = document.createElement('div');
    bar.className = 'mst-card mst-mode';
    bar.id = 'mstModeBar';
    const mk = (m, label) => {
        const b = document.createElement('button');
        b.textContent = label;
        if (getMode() === m) b.classList.add('on');
        b.onclick = () => { onChange(m); [...bar.children].forEach((c) => c.classList.remove('on')); b.classList.add('on'); };
        return b;
    };
    bar.appendChild(mk('cellular', 'Cellular'));
    bar.appendChild(mk('linear', 'Linear'));
    document.body.appendChild(bar);
}
function removeModeBar() {
    const b = document.getElementById('mstModeBar');
    if (b) b.remove();
}

function showHint(text) {
    injectStyles();
    removeHint();
    const h = document.createElement('div');
    h.className = 'mst-hint';
    h.id = 'mstHint';
    h.textContent = text;
    document.body.appendChild(h);
}
function removeHint() {
    const h = document.getElementById('mstHint');
    if (h) h.remove();
}

// ---- speed popup -------------------------------------------------------------
// pos: {x,y} pixel position. onCalculate(speed). onCancel().
function showSpeedPopup(pos, onCalculate, onCancel) {
    injectStyles();
    removeSpeedPopup();
    const el = document.createElement('div');
    el.className = 'mst-card mst-speed';
    el.id = 'mstSpeedPopup';
    el.innerHTML =
        `<span class="mst-x" title="Cancel">&times;</span>` +
        `<div class="mst-title">Enter Speed</div>` +
        `<div class="mst-speed-row">` +
            `<input type="number" inputmode="numeric" min="1" max="120" placeholder="0" />` +
            `<span class="mst-unit">MPH</span>` +
        `</div>` +
        `<button class="mst-btn" disabled>Calculate</button>`;
    document.body.appendChild(el);

    // Keep the popup on-screen.
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = pos.x + 14, y = pos.y - h / 2;
    x = Math.min(Math.max(8, x), window.innerWidth - w - 8);
    y = Math.min(Math.max(8, y), window.innerHeight - h - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';

    const input = el.querySelector('input');
    const btn = el.querySelector('button');
    const validate = () => { const v = parseFloat(input.value); btn.disabled = !(v > 0); };
    const submit = () => {
        const v = parseFloat(input.value);
        if (!(v > 0)) return;
        onCalculate(v);
    };
    input.addEventListener('input', validate);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); });
    btn.addEventListener('click', submit);
    el.querySelector('.mst-x').addEventListener('click', onCancel);
    setTimeout(() => input.focus(), 0);
}
function removeSpeedPopup() {
    const el = document.getElementById('mstSpeedPopup');
    if (el) el.remove();
}

// ---- impact panel ------------------------------------------------------------
// data: result of computeImpacts. meta: { motionText, mode }. onClear().
function showImpactPanel(data, meta, onClear) {
    injectStyles();
    removeImpactPanel();
    const el = document.createElement('div');
    el.className = 'mst-card mst-panel';
    el.id = 'mstImpactPanel';

    const rowsHtml = data.rows.length
        ? data.rows.map((r) =>
            `<div class="mst-row"><span>${r.name}</span>` +
            `<b class="mst-eta">${r.clock || (r.etaMin + ' min')}</b></div>`).join('')
        : `<div class="mst-empty">No mapped communities in this storm's path. Try a longer or repositioned track.</div>`;

    el.innerHTML =
        `<div class="mst-panel-head"><span class="mst-title">Impact Times</span>` +
            `<span class="mst-x" title="Clear">&times;</span></div>` +
        `<div class="mst-rows">${rowsHtml}</div>` +
        `<div class="mst-foot">` +
            `<div class="mst-pop"><span>Total population</span><b>${fmtPop(data.totalPopulation)}</b></div>` +
            `<button class="mst-btn mst-clear">Clear</button>` +
        `</div>`;
    document.body.appendChild(el);

    el.querySelector('.mst-x').addEventListener('click', onClear);
    el.querySelector('.mst-clear').addEventListener('click', onClear);
}
function removeImpactPanel() {
    const el = document.getElementById('mstImpactPanel');
    if (el) el.remove();
}

function removeAll() {
    removeSpeedPopup();
    removeImpactPanel();
    removeModeBar();
    removeHint();
}

module.exports = {
    showModeBar, removeModeBar,
    showHint, removeHint,
    showSpeedPopup, removeSpeedPopup,
    showImpactPanel, removeImpactPanel,
    removeAll,
};
