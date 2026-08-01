/*
 * components/alerts_panel.js
 * Active-alerts overlay. Lists every active NWS alert currently loaded
 * (window.atticData.alerts_data), color-matched to the map polygons, with
 * search, severity sorting, expandable details, and zoom-to-alert.
 *
 * Opened via window.openVortexAlerts() (wired to the top-left alert pill).
 */

import Dialog from "../js/ui/dialog.js";

const SEVERITY_ORDER = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function eventColor(event) {
    try {
        const c = window.vortexAlertColors && window.vortexAlertColors(event);
        if (c && c.color) return c.color;
    } catch { /* ignore */ }
    return 'rgb(120,130,145)';
}

function expiresInfo(props) {
    const iso = props.ends || props.expires;
    if (!iso) return { text: '', expired: false };
    const ms = new Date(iso).getTime() - Date.now();
    const expired = ms <= 0;
    let a = Math.abs(ms);
    const d = Math.floor(a / 86400000); a -= d * 86400000;
    const h = Math.floor(a / 3600000); a -= h * 3600000;
    const m = Math.floor(a / 60000);
    let dur;
    if (d) dur = `${d}d ${h}h`;
    else if (h) dur = `${h}h ${m}m`;
    else dur = `${m}m`;
    return { text: expired ? `Expired ${dur} ago` : `Expires in ${dur}`, expired };
}

/** Bounding box [minLng, minLat, maxLng, maxLat] from a GeoJSON geometry. */
function bboxOf(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = (a) => {
        if (typeof a[0] === 'number') {
            if (a[0] < minX) minX = a[0]; if (a[0] > maxX) maxX = a[0];
            if (a[1] < minY) minY = a[1]; if (a[1] > maxY) maxY = a[1];
        } else { a.forEach(walk); }
    };
    walk(geometry.coordinates);
    return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

function getFeatures() {
    const data = window.atticData && window.atticData.alerts_data;
    let feats = (data && Array.isArray(data.features)) ? data.features : [];
    // Respect the same warnings/watches/statements filter the map uses, so the
    // list only shows the alerts the user has chosen to see (no scrolling past
    // types they've filtered out).
    if (typeof window.vortexAlertFilter === 'function') {
        feats = feats.filter((f) => { try { return window.vortexAlertFilter(f); } catch { return true; } });
    }
    // newest / most severe first
    return [...feats].sort((a, b) => {
        const sa = SEVERITY_ORDER[a.properties?.severity] ?? 5;
        const sb = SEVERITY_ORDER[b.properties?.severity] ?? 5;
        if (sa !== sb) return sa - sb;
        return new Date(b.properties?.sent || 0) - new Date(a.properties?.sent || 0);
    });
}

let _dialog = null;

export default function openAlerts() {
    const content = `
        <div class="vr-alerts">
            <div class="vr-alerts-toolbar">
                <input type="search" id="vr-alerts-search" placeholder="Search alerts by type or area..." autocomplete="off" />
                <span id="vr-alerts-count" class="vr-alerts-count"></span>
            </div>
            <div id="vr-alerts-list" class="vr-alerts-list"></div>
        </div>`;

    _dialog = new Dialog('Active Alerts', 'alert-triangle', content, {}, true);

    const listEl = document.getElementById('vr-alerts-list');
    const countEl = document.getElementById('vr-alerts-count');
    const searchEl = document.getElementById('vr-alerts-search');

    const all = getFeatures();

    function render(filter) {
        const q = (filter || '').trim().toLowerCase();
        const shown = q
            ? all.filter((f) => {
                const p = f.properties || {};
                return (`${p.event} ${p.areaDesc} ${p.headline || ''}`).toLowerCase().includes(q);
            })
            : all;

        countEl.textContent = `${shown.length} alert${shown.length === 1 ? '' : 's'}`;

        if (!shown.length) {
            listEl.innerHTML = `<div class="vr-alerts-empty">${all.length ? 'No alerts match your search.' : 'No active alerts are currently loaded.'}</div>`;
            return;
        }

        listEl.innerHTML = shown.map((f, i) => {
            const p = f.properties || {};
            const color = eventColor(p.event);
            const exp = expiresInfo(p);
            const idx = all.indexOf(f);
            return `
                <div class="vr-alert-row" data-idx="${idx}" style="border-left-color:${color};">
                    <div class="vr-alert-main">
                        <div class="vr-alert-event">${escapeHtml(p.event || 'Alert')}</div>
                        <div class="vr-alert-area">${escapeHtml(p.areaDesc || '')}</div>
                        <div class="vr-alert-meta">
                            <span class="vr-alert-sev" style="color:${color};">${escapeHtml(p.severity || 'Unknown')}</span>
                            <span class="vr-alert-exp ${exp.expired ? 'expired' : ''}">${escapeHtml(exp.text)}</span>
                        </div>
                    </div>
                    <button class="vr-alert-zoom" data-zoom="${idx}" title="Zoom to alert"><i class="ti ti-map-pin"></i></button>
                    <div class="vr-alert-details" id="vr-alert-details-${idx}" style="display:none;"></div>
                </div>`;
        }).join('');
    }

    function detailsHtml(p) {
        const row = (label, val) => val ? `<div class="vr-alert-d-row"><b>${label}</b><br>${escapeHtml(val)}</div>` : '';
        return `
            ${row('Headline', p.headline)}
            ${row('Description', p.description)}
            ${row('Instructions', p.instruction)}
            ${row('Areas affected', p.areaDesc)}
            ${row('Sender', p.senderName)}`;
    }

    listEl.addEventListener('click', (e) => {
        const zoomBtn = e.target.closest('[data-zoom]');
        if (zoomBtn) {
            e.stopPropagation();
            const f = all[+zoomBtn.dataset.zoom];
            const bbox = bboxOf(f && f.geometry);
            const w = window.vortexMap;
            if (bbox && w && w.map) {
                w.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, duration: 800, maxZoom: 10 });
                _dialog.close();
            } else if (!bbox) {
                alert('This alert has no mapped polygon (zone-based).');
            }
            return;
        }
        const row = e.target.closest('.vr-alert-row');
        if (!row) return;
        const idx = row.dataset.idx;
        const det = document.getElementById(`vr-alert-details-${idx}`);
        if (!det) return;
        if (det.style.display === 'none') {
            if (!det.dataset.filled) { det.innerHTML = detailsHtml(all[+idx].properties || {}); det.dataset.filled = '1'; }
            det.style.display = 'block';
        } else {
            det.style.display = 'none';
        }
    });

    searchEl.addEventListener('input', () => render(searchEl.value));
    render('');
}

window.openVortexAlerts = openAlerts;
