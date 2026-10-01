/*
 * components/layers_menu.js
 * A Layers dropdown in the search strip: Radar, Satellite, Models, Outlooks.
 *
 * It does NOT reimplement any of them. Each row forwards to the control that
 * already owns the behaviour — the switches in the menu, the footer buttons —
 * so there is one implementation of "turn the radar off", not two that drift
 * apart. The two real layers show their live state, read back from those same
 * switches every time the panel opens, so the dropdown can never disagree with
 * the menu.
 *
 * It mounts itself into the search strip's top row (components/warning_search.js
 * builds .vws-top) rather than positioning itself against the strip, so the two
 * cannot drift apart at different widths.
 */

const ROWS = [
    {
        id: 'radar', label: 'Radar', icon: 'ti-radar-2',
        // The radar visibility switch in the menu.
        toggle: '#armrRadarVisBtnSwitchElem',
    },
    {
        id: 'satellite', label: 'Satellite', icon: 'ti-satellite',
        // GOES infrared imagery.
        toggle: '#armrGoesIRBtnSwitchElem',
    },
    {
        id: 'models', label: 'Models', icon: 'ti-chart-line',
        // Opens the Models & Forecast panel (a window, not a layer).
        open: () => click('#vortexModelsBtn'),
    },
    {
        id: 'outlooks', label: 'Outlooks', icon: 'ti-alert-triangle',
        /*
         * SPC outlooks live on their own screen INSIDE the menu, so the menu has
         * to be open before that row exists to be clicked. Opening the menu is
         * the settings icon's job; a frame later the screen can be chosen.
         */
        open: () => { click('#settingsItemClass'); setTimeout(() => click('#armrSevereBtn'), 60); },
    },
];

function click(sel) {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
}

function checkbox(sel) {
    return document.querySelector(sel) || null;
}

function injectStyles() {
    if (document.getElementById('vxlayers-styles')) return;
    const s = document.createElement('style');
    s.id = 'vxlayers-styles';
    s.textContent = `
  #vxlayers{position:relative;flex:0 0 auto;font-family:var(--vx-font)}
  #vxlayers .vxl-btn{display:flex;align-items:center;gap:7px;height:100%;padding:8px 12px;cursor:pointer;
    background:var(--vx-surface);border:1px solid rgba(255,255,255,.10);border-radius:var(--vx-r-3);
    box-shadow:var(--vx-shadow);color:var(--vx-text);font-size:13.5px;font-weight:600;white-space:nowrap;
    font-family:inherit;transition:border-color .12s ease}
  #vxlayers .vxl-btn:hover{border-color:var(--vx-accent)}
  #vxlayers.open .vxl-btn{border-color:var(--vx-accent)}
  #vxlayers .vxl-caret{font-size:10px;opacity:.7;margin-left:1px}
  #vxlayers .vxl-panel{position:absolute;top:calc(100% + 6px);right:0;min-width:210px;z-index:530;
    background:var(--vx-surface);border:1px solid rgba(255,255,255,.10);border-radius:var(--vx-r-3);
    box-shadow:var(--vx-shadow);padding:6px;display:none}
  #vxlayers.open .vxl-panel{display:block}
  #vxlayers .vxl-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;cursor:pointer;
    background:none;border:none;border-radius:var(--vx-r-2);color:var(--vx-text);font-size:13.5px;
    font-family:inherit;text-align:left}
  #vxlayers .vxl-item:hover{background:rgba(255,255,255,.06)}
  #vxlayers .vxl-item i{font-size:16px;color:var(--vx-text-2);flex:0 0 auto}
  #vxlayers .vxl-name{flex:1;min-width:0}
  /* The pill reads ON/OFF for the two real layers; the other two open a window
     and say so instead of pretending to be a switch. */
  #vxlayers .vxl-state{font-size:10.5px;font-weight:700;letter-spacing:.06em;padding:2px 7px;border-radius:999px;
    background:rgba(255,255,255,.07);color:var(--vx-text-2);flex:0 0 auto}
  #vxlayers .vxl-item.on .vxl-state{background:var(--vx-accent-soft);color:var(--vx-accent)}
  #vxlayers .vxl-item.on i{color:var(--vx-accent)}
  @media (max-width:640px){
    #vxlayers .vxl-btn{padding:8px 10px}
    #vxlayers .vxl-label{display:none}
  }`;
    document.head.appendChild(s);
}

let els = null;

function syncState() {
    if (!els) return;
    for (const row of ROWS) {
        const item = els.items[row.id];
        if (!item) continue;
        if (!row.toggle) continue;
        const cb = checkbox(row.toggle);
        const on = !!(cb && cb.checked);
        item.classList.toggle('on', on);
        item.querySelector('.vxl-state').textContent = on ? 'ON' : 'OFF';
        item.setAttribute('aria-pressed', String(on));
    }
}

function open() { els.root.classList.add('open'); syncState(); }
function close() { els.root.classList.remove('open'); }

function onRow(row) {
    if (row.toggle) {
        /*
         * Click the real switch rather than setting .checked: the app binds its
         * behaviour to the click, so setting the property alone would move the
         * dropdown's pill and change nothing on the map.
         */
        const cb = checkbox(row.toggle);
        if (!cb) return;
        cb.click();
        setTimeout(syncState, 0);
        return;
    }
    close();
    row.open();
}

function mount() {
    const host = document.querySelector('#vwsearch .vws-top');
    if (!host) return false;

    injectStyles();
    const root = document.createElement('div');
    root.id = 'vxlayers';
    root.innerHTML = `
    <button class="vxl-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Layers">
      <i class="ti ti-stack-2"></i><span class="vxl-label">Layers</span><span class="vxl-caret">▾</span>
    </button>
    <div class="vxl-panel" role="menu">
      ${ROWS.map((r) => `
        <button class="vxl-item" type="button" role="menuitem" data-row="${r.id}">
          <i class="ti ${r.icon}"></i>
          <span class="vxl-name">${r.label}</span>
          <span class="vxl-state">${r.toggle ? 'OFF' : 'OPEN'}</span>
        </button>`).join('')}
    </div>`;
    host.appendChild(root);

    els = { root, btn: root.querySelector('.vxl-btn'), items: {} };
    for (const r of ROWS) els.items[r.id] = root.querySelector(`[data-row="${r.id}"]`);

    els.btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !els.root.classList.contains('open');
        willOpen ? open() : close();
        els.btn.setAttribute('aria-expanded', String(willOpen));
    });
    for (const r of ROWS) {
        els.items[r.id].addEventListener('click', (e) => { e.stopPropagation(); onRow(r); });
    }
    // Close on any click elsewhere, including on the map.
    document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    syncState();
    return true;
}

/*
 * The search strip builds itself on DOMContentLoaded too, and module order is
 * not something to rely on — so retry briefly rather than race it.
 */
function init(attempt = 0) {
    if (mount()) return;
    if (attempt > 40) { console.warn('[LayersMenu] search strip never appeared; no layers button.'); return; }
    setTimeout(() => init(attempt + 1), 150);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
else init();
