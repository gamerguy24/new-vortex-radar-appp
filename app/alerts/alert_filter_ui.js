/*
 * alert_filter_ui.js
 * The "Alert Filters" picker — a polished modal where users choose which alert
 * types appear (on the map and in the Active Alerts list). Saves to alert_prefs
 * and re-plots immediately. Opened from the ALERTS menu.
 */
const prefs = require('./alert_prefs');
const filter_alerts = require('./filter_alerts');
const plot_alerts = require('./plot_alerts');
let get_polygon_colors = null;
try { get_polygon_colors = require('./colors/polygon_colors'); } catch (e) { /* optional */ }

const CAT_LABEL = { warning: 'Warnings', watch: 'Watches', statement: 'Statements & Advisories' };
const CAT_ORDER = ['warning', 'watch', 'statement'];
const CAT_FALLBACK = { warning: '#e0483a', watch: '#f2c744', statement: '#8fd0ff' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function chipColor(name, cat) {
    try { const c = get_polygon_colors && get_polygon_colors(name); if (c && c.color) return c.color; } catch (e) { /* ignore */ }
    return CAT_FALLBACK[cat] || 'var(--vx-text-2)';
}

// Re-filter + re-plot with current preferences (mirrors menu_item's handler).
function replot() {
    if (window.vortexData && window.vortexData.alerts_data) {
        try { plot_alerts(filter_alerts(JSON.parse(JSON.stringify(window.vortexData.alerts_data)))); }
        catch (e) { console.warn('[alert filters] replot failed:', e); }
    }
}

function injectStyles() {
    if (document.getElementById('vaf-styles')) return;
    const s = document.createElement('style');
    s.id = 'vaf-styles';
    s.textContent = `
    .vaf-bg{position:fixed;inset:0;z-index:100065;background:rgba(4,8,16,.72);
        display:flex;align-items:center;justify-content:center;padding:24px;font-family:var(--vx-font);}
    .vaf-modal{width:min(560px,96vw);max-height:88vh;display:flex;flex-direction:column;background:var(--vx-surface);
        border:1px solid rgba(255,255,255,.12);border-radius:var(--vx-r-3);box-shadow:var(--vx-shadow-lg);color:var(--vx-text);overflow:hidden;}
    .vaf-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.09);}
    .vaf-title{font-size:1.2em;font-weight:800;display:flex;align-items:center;gap:10px;line-height:1;}
    .vaf-title .fa{color:var(--vx-accent);}
    .vaf-sub{color:var(--vx-text-2);font-size:12.5px;margin-top:6px;line-height:1.4;}
    .vaf-x{cursor:pointer;opacity:.65;font-size:20px;line-height:1;background:rgba(255,255,255,.06);border:none;color:#fff;
        width:32px;height:32px;border-radius:var(--vx-r-2);flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;}
    .vaf-x:hover{opacity:1;background:rgba(255,255,255,.14);}
    .vaf-tools{padding:14px 20px 0;}
    .vaf-search{width:100%;box-sizing:border-box;padding:10px 13px;border-radius:var(--vx-r-3);background:rgba(0,0,0,.35);
        border:1px solid rgba(255,255,255,.14);color:var(--vx-text);font-family:inherit;font-size:14px;}
    .vaf-search::placeholder{color:#6f8199;}
    .vaf-search:focus{outline:none;border-color:var(--vx-accent);box-shadow:0 0 0 3px var(--vx-accent-soft);}
    .vaf-body{padding:14px 20px 4px;overflow:auto;}
    .vaf-group{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.09);border-radius:var(--vx-r-3);padding:6px 14px 10px;margin-bottom:14px;}
    .vaf-group-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 0 7px;}
    .vaf-group-name{font-weight:800;letter-spacing:.07em;text-transform:uppercase;font-size:12px;color:#7fc0ff;display:flex;align-items:center;gap:8px;}
    .vaf-count{font-size:11px;color:var(--vx-text-2);font-weight:700;background:rgba(255,255,255,.07);padding:2px 8px;border-radius:var(--vx-r-3);}
    .vaf-mini{font:inherit;font-size:11px;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,.16);
        background:rgba(255,255,255,.06);color:#cdd9f0;border-radius:var(--vx-r-2);padding:4px 11px;margin-left:6px;transition:background .12s;}
    .vaf-mini:hover{background:rgba(255,255,255,.15);color:#fff;}
    .vaf-row{display:flex;align-items:center;gap:12px;padding:9px 2px;border-top:1px solid rgba(255,255,255,.06);}
    .vaf-chip{width:12px;height:12px;border-radius:var(--vx-r-1);flex-shrink:0;box-shadow:0 0 0 1px rgba(0,0,0,.45), 0 0 6px rgba(0,0,0,.3);}
    .vaf-name{flex:1;min-width:0;font-size:14px;color:var(--vx-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .vaf-toggle{position:relative;display:inline-block;width:42px;height:24px;flex-shrink:0;}
    .vaf-toggle input{opacity:0;width:0;height:0;position:absolute;margin:0;}
    .vaf-slider{position:absolute;inset:0;background:rgba(255,255,255,.16);border-radius:var(--vx-r-3);transition:background .15s;cursor:pointer;}
    .vaf-slider::before{content:"";position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .15s;box-shadow:var(--vx-shadow);}
    .vaf-toggle input:checked + .vaf-slider{background:var(--vx-accent);}
    .vaf-toggle input:checked + .vaf-slider::before{transform:translateX(18px);}
    .vaf-empty{color:var(--vx-text-2);font-size:13px;text-align:center;padding:22px;}
    .vaf-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:13px 20px;border-top:1px solid rgba(255,255,255,.09);}
    .vaf-tip{color:var(--vx-text-2);font-size:11.5px;line-height:1.4;flex:1;}
    .vaf-btn{padding:9px 18px;border-radius:var(--vx-r-3);border:none;font-weight:800;font-size:13.5px;cursor:pointer;font-family:inherit;flex-shrink:0;}
    .vaf-btn.primary{background:var(--vx-accent);color:var(--vx-accent-ink);}.vaf-btn.primary:hover{background:#4ad0ff;}
    .vaf-btn.ghost{background:rgba(255,255,255,.08);color:var(--vx-text);}.vaf-btn.ghost:hover{background:rgba(255,255,255,.16);}`;
    document.head.appendChild(s);
}

function rowHtml(t) {
    return `
        <div class="vaf-row" data-name="${esc(t.name)}" data-cat="${t.category}">
            <span class="vaf-chip" style="background:${chipColor(t.name, t.category)};"></span>
            <span class="vaf-name">${esc(t.name)}</span>
            <label class="vaf-toggle">
                <input type="checkbox" class="vaf-cb" data-name="${esc(t.name)}" ${prefs.isEnabled(t.name) ? 'checked' : ''} />
                <span class="vaf-slider"></span>
            </label>
        </div>`;
}

function groupHtml(cat) {
    const items = prefs.TYPES.filter((t) => t.category === cat);
    return `
        <div class="vaf-group" data-group="${cat}">
            <div class="vaf-group-head">
                <div class="vaf-group-name">${esc(CAT_LABEL[cat])} <span class="vaf-count">${items.length}</span></div>
                <div>
                    <button class="vaf-mini" data-cat="${cat}" data-on="1">All</button>
                    <button class="vaf-mini" data-cat="${cat}" data-on="0">None</button>
                </div>
            </div>
            ${items.map(rowHtml).join('')}
        </div>`;
}

function openAlertFilters() {
    injectStyles();
    const old = document.getElementById('vaf-bg');
    if (old) old.remove();

    const bg = document.createElement('div');
    bg.id = 'vaf-bg';
    bg.className = 'vaf-bg';
    bg.innerHTML = `
        <div class="vaf-modal" role="dialog" aria-modal="true">
            <div class="vaf-head">
                <div>
                    <div class="vaf-title"><i class="fa fa-filter"></i> Alert Filters</div>
                    <div class="vaf-sub">Pick which alert types show on the map and in the Active Alerts list. Saved to this device.</div>
                </div>
                <button class="vaf-x" id="vaf-close" title="Close">&times;</button>
            </div>
            <div class="vaf-tools">
                <input type="search" class="vaf-search" id="vaf-search" placeholder="Search alert types…" autocomplete="off" />
            </div>
            <div class="vaf-body" id="vaf-body">
                ${CAT_ORDER.map(groupHtml).join('')}
                <div class="vaf-empty" id="vaf-empty" style="display:none;">No alert types match your search.</div>
            </div>
            <div class="vaf-foot">
                <div class="vaf-tip">Category switches in the menu turn a whole group on/off; these fine-tune within them.</div>
                <button class="vaf-btn ghost" id="vaf-reset">Reset</button>
                <button class="vaf-btn primary" id="vaf-done">Done</button>
            </div>
        </div>`;
    document.body.appendChild(bg);

    const bodyEl = bg.querySelector('#vaf-body');
    const close = () => bg.remove();
    bg.querySelector('#vaf-close').onclick = close;
    bg.querySelector('#vaf-done').onclick = close;
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });

    // Toggle a single type.
    bodyEl.addEventListener('change', (e) => {
        const cb = e.target.closest('.vaf-cb');
        if (!cb) return;
        prefs.setEnabled(cb.dataset.name, cb.checked);
        replot();
    });

    // All / None per group.
    bodyEl.addEventListener('click', (e) => {
        const mini = e.target.closest('.vaf-mini');
        if (!mini) return;
        const on = mini.dataset.on === '1';
        prefs.TYPES.filter((t) => t.category === mini.dataset.cat).forEach((t) => {
            prefs.setEnabled(t.name, on);
            const cb = bodyEl.querySelector(`.vaf-cb[data-name="${t.name.replace(/"/g, '\\"')}"]`);
            if (cb) cb.checked = on;
        });
        replot();
    });

    // Reset to defaults.
    bg.querySelector('#vaf-reset').onclick = () => {
        prefs.TYPES.forEach((t) => {
            prefs.setEnabled(t.name, t.def);
            const cb = bodyEl.querySelector(`.vaf-cb[data-name="${t.name.replace(/"/g, '\\"')}"]`);
            if (cb) cb.checked = t.def;
        });
        replot();
    };

    // Search filter.
    const searchEl = bg.querySelector('#vaf-search');
    const emptyEl = bg.querySelector('#vaf-empty');
    searchEl.addEventListener('input', () => {
        const q = searchEl.value.trim().toLowerCase();
        let anyVisible = false;
        bodyEl.querySelectorAll('.vaf-group').forEach((g) => {
            let groupVisible = false;
            g.querySelectorAll('.vaf-row').forEach((row) => {
                const match = !q || row.dataset.name.toLowerCase().includes(q);
                row.style.display = match ? '' : 'none';
                if (match) groupVisible = true;
            });
            g.style.display = groupVisible ? '' : 'none';
            if (groupVisible) anyVisible = true;
        });
        emptyEl.style.display = anyVisible ? 'none' : 'block';
    });
    setTimeout(() => searchEl.focus(), 0);
}

$('#armrAlertFiltersBtn').on('click', openAlertFilters);

module.exports = { openAlertFilters };
