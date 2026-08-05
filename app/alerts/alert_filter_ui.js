/*
 * alert_filter_ui.js
 * The "Alert Filters" picker — a dialog where users check which alert types they
 * want to see. Saves to alert_prefs and re-plots the alerts immediately so the
 * map and the Active Alerts list update. Opened from the ALERTS menu.
 */
const display_attic_dialog = require('../core/menu/attic_dialog');
const prefs = require('./alert_prefs');
const filter_alerts = require('./filter_alerts');
const plot_alerts = require('./plot_alerts');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Re-filter + re-plot with the current preferences (mirrors menu_item's handler).
function replot() {
    if (window.atticData && window.atticData.alerts_data) {
        try { plot_alerts(filter_alerts(JSON.parse(JSON.stringify(window.atticData.alerts_data)))); }
        catch (e) { console.warn('[alert filters] replot failed:', e); }
    }
}

function groupHtml(title, cat) {
    const items = prefs.TYPES.filter((t) => t.category === cat);
    const btn = 'font:inherit;font-size:11px;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.1);color:#e6edf6;border-radius:6px;padding:4px 10px;margin-left:6px;';
    const rows = items.map((t) => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid rgba(255,255,255,.1);cursor:pointer;color:#e6edf6;">
            <input type="checkbox" class="vaf-cb" data-name="${esc(t.name)}" ${prefs.isEnabled(t.name) ? 'checked' : ''}
                style="width:18px;height:18px;flex-shrink:0;accent-color:#27beff;cursor:pointer;" />
            <span style="font-size:14px;">${esc(t.name)}</span>
        </label>`).join('');
    return `
        <div style="margin-bottom:18px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin:2px 0 8px;">
                <div style="font-weight:800;letter-spacing:.06em;text-transform:uppercase;font-size:12.5px;color:#6cb6ff;">${esc(title)}</div>
                <div>
                    <button class="vaf-all" data-cat="${cat}" data-on="1" style="${btn}">All</button>
                    <button class="vaf-all" data-cat="${cat}" data-on="0" style="${btn}">None</button>
                </div>
            </div>
            ${rows}
        </div>`;
}

function openAlertFilters() {
    const body = `
        <div style="text-align:left;padding:4px 18px 18px;color:#e6edf6;">
            <p style="color:#9fb0c8;font-size:13px;margin:6px 0 14px;">Choose which alert types show on the map and in the Active Alerts list. Changes save automatically to this device.</p>
            ${groupHtml('Warnings', 'warning')}
            ${groupHtml('Watches', 'watch')}
            ${groupHtml('Statements & Advisories', 'statement')}
            <p style="color:#8aa0bd;font-size:11.5px;margin-top:4px;">Tip: the category switches in the menu (Warnings / Watches / Statements) turn a whole group on or off; these checkboxes fine-tune what shows within them.</p>
        </div>`;

    display_attic_dialog({ title: 'Alert Filters', body, color: 'rgb(19, 19, 19)', textColor: 'white' });

    const root = document.getElementById('atcDlgBody');
    if (!root) return;

    root.querySelectorAll('.vaf-cb').forEach((cb) => {
        cb.addEventListener('change', () => { prefs.setEnabled(cb.dataset.name, cb.checked); replot(); });
    });
    root.querySelectorAll('.vaf-all').forEach((b) => {
        b.addEventListener('click', () => {
            const on = b.dataset.on === '1';
            prefs.TYPES.filter((t) => t.category === b.dataset.cat).forEach((t) => {
                prefs.setEnabled(t.name, on);
                const cb = root.querySelector(`.vaf-cb[data-name="${t.name.replace(/"/g, '\\"')}"]`);
                if (cb) cb.checked = on;
            });
            replot();
        });
    });
}

$('#armrAlertFiltersBtn').on('click', openAlertFilters);

module.exports = { openAlertFilters };
