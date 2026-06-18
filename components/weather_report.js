/*
 * components/weather_report.js
 * Field Weather Report tool - lets spotters log what they're seeing in the
 * field (hazard type, location, notes). Reports are submitted to the server and
 * shown on EVERY signed-in user's radar, so a report filed in the app shows up
 * live on the shared map. Each spotter can manage (delete) their own reports.
 *
 * (c) David Wallis, Twistcaster Live Media LLC 2026
 */

import Dialog from "../js/ui/dialog.js";

const API = '/api/reports';
const POLL_MS = 60000; // refresh the shared reports once a minute

const HAZARDS = [
    { id: 'tornado',    label: 'Tornado',       icon: 'tornado',         color: '#e02424' },
    { id: 'funnel',     label: 'Funnel Cloud',  icon: 'tornado',         color: '#f59e0b' },
    { id: 'wall-cloud', label: 'Wall Cloud',    icon: 'cloud',           color: '#a855f7' },
    { id: 'hail',       label: 'Hail',          icon: 'cloud-storm',     color: '#38bdf8', measure: { label: 'Hail size (in)', placeholder: 'e.g. 1.5', unit: 'in' } },
    { id: 'wind',       label: 'Damaging Wind', icon: 'wind',            color: '#2dd4bf', measure: { label: 'Est. gust (mph)', placeholder: 'e.g. 60', unit: 'mph' } },
    { id: 'flood',      label: 'Flooding',      icon: 'droplet',         color: '#3b82f6' },
    { id: 'heavy-rain', label: 'Heavy Rain',    icon: 'cloud-rain',      color: '#60a5fa' },
    { id: 'lightning',  label: 'Lightning',     icon: 'bolt',            color: '#facc15' },
    { id: 'snow',       label: 'Snow / Ice',    icon: 'snowflake',       color: '#bae6fd' },
    { id: 'other',      label: 'Other',         icon: 'alert-triangle',  color: '#94a3b8' },
];

const hazardById = (id) => HAZARDS.find((h) => h.id === id) || HAZARDS[HAZARDS.length - 1];

let _reports = [];
let _pollTimer = null;
let _lastSig = '';
let _enabled = false;

async function fetchReports() {
    try {
        const res = await fetch(API, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        _reports = Array.isArray(data.reports) ? data.reports : [];
    } catch (err) {
        console.warn('[WeatherReport] Failed to load reports:', err);
    }
    return _reports;
}

async function postReport(payload) {
    const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data.report;
}

async function deleteReport(id) {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || ('HTTP ' + res.status));
    }
}

async function clearMyReports() {
    const res = await fetch(API, { method: 'DELETE' });
    if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || ('HTTP ' + res.status));
    }
}

let _markers = [];
let _mlMap = null;

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function clearMarkers() {
    for (const m of _markers) m.remove();
    _markers = [];
}

function signatureOf(reports) {
    return reports.length + '|' + reports.map((r) => r.id).join(',');
}

function renderMarkers() {
    if (!_mlMap || typeof maplibregl === 'undefined') return;
    clearMarkers();

    for (const report of _reports) {
        const hz = hazardById(report.type);

        const el = document.createElement('div');
        el.className = 'weather-report-marker';
        el.style.setProperty('--wr-color', hz.color);
        el.innerHTML = `<i class="ti ti-${hz.icon}"></i>`;

        const detail = report.measure ? `<div class="wr-pop-detail">${escapeHtml(report.measure)} ${escapeHtml(report.measureUnit || '')}</div>` : '';
        const notes = report.notes ? `<div class="wr-pop-notes">${escapeHtml(report.notes)}</div>` : '';
        const popupHtml = `
            <div class="wr-popup">
                <div class="wr-pop-head" style="color:${hz.color};">
                    <i class="ti ti-${hz.icon}"></i> ${escapeHtml(hz.label)}
                </div>
                ${detail}
                ${notes}
                <div class="wr-pop-time">${formatTime(report.time)}</div>
            </div>`;

        const popup = new maplibregl.Popup({ offset: 18, closeButton: true })
            .setHTML(popupHtml);

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([report.lng, report.lat])
            .setPopup(popup)
            .addTo(_mlMap);

        _markers.push(marker);
    }
}

async function refreshMarkers({ force = false } = {}) {
    if (!_enabled) return;
    await fetchReports();
    const sig = signatureOf(_reports);
    if (!force && sig === _lastSig) return;
    _lastSig = sig;
    renderMarkers();
}

export async function addWeatherReportMarkers(mapInstance) {
    _mlMap = mapInstance?.map || mapInstance;
    _enabled = true;
    await refreshMarkers({ force: true });
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => refreshMarkers(), POLL_MS);
}

export function removeWeatherReportMarkers() {
    _enabled = false;
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    clearMarkers();
}

export default function openWeatherReport(mapInstance) {
    _mlMap = mapInstance?.map || mapInstance;

    const state = { type: null, lat: null, lng: null, submitting: false };

    const chips = HAZARDS.map((h) => `
        <button type="button" class="wr-chip" data-hazard="${h.id}" style="--wr-color:${h.color};">
            <i class="ti ti-${h.icon}"></i>
            <span>${h.label}</span>
        </button>`).join('');

    const content = `
        <div class="wr-form">
            <p class="wr-intro">Log what you're seeing in the field. Your report is shared live on the map for every Vortex spotter.</p>

            <div class="wr-section-label">Hazard type</div>
            <div class="wr-chip-grid" id="wr-chip-grid">${chips}</div>

            <div class="wr-measure-row" id="wr-measure-row" style="display:none;">
                <label id="wr-measure-label" for="wr-measure">Measurement</label>
                <input type="number" id="wr-measure" step="0.01" min="0" inputmode="decimal" placeholder="">
            </div>

            <div class="wr-section-label">Location</div>
            <div class="wr-location" id="wr-location">Acquiring your location...</div>
            <div class="wr-location-actions">
                <button type="button" class="wr-btn" id="wr-gps"><i class="ti ti-current-location"></i> Use my GPS</button>
                <button type="button" class="wr-btn" id="wr-center"><i class="ti ti-map-pin"></i> Use map center</button>
            </div>

            <div class="wr-section-label">Notes <span class="wr-optional">(optional)</span></div>
            <textarea id="wr-notes" class="wr-notes" rows="3" maxlength="500" placeholder="Anything else worth noting - direction of movement, damage, conditions..."></textarea>

            <button type="button" class="wr-submit" id="wr-submit" disabled>
                <i class="ti ti-send"></i> Submit Report
            </button>
            <div class="wr-msg" id="wr-msg"></div>

            <div class="wr-myreports-head">
                <span>My Reports</span>
                <button type="button" class="wr-clear" id="wr-clear" title="Delete all of my reports">Clear all</button>
            </div>
            <div class="wr-myreports" id="wr-myreports"></div>
        </div>`;

    const dialog = new Dialog('Report Weather', 'flag-3', content, {}, true);

    const $ = (id) => document.getElementById(id);
    const chipGrid   = $('wr-chip-grid');
    const measureRow = $('wr-measure-row');
    const measureLbl = $('wr-measure-label');
    const measureInp = $('wr-measure');
    const locationEl = $('wr-location');
    const notesEl    = $('wr-notes');
    const submitBtn  = $('wr-submit');
    const msgEl      = $('wr-msg');
    const listEl     = $('wr-myreports');

    function refreshSubmitState() {
        submitBtn.disabled = state.submitting || !(state.type && state.lat != null && state.lng != null);
    }

    function setLocation(lat, lng, label) {
        state.lat = lat;
        state.lng = lng;
        locationEl.classList.remove('wr-error');
        locationEl.innerHTML = `<i class="ti ti-map-pin-filled"></i> ${lat.toFixed(4)}, ${lng.toFixed(4)} <span class="wr-loc-src">· ${label}</span>`;
        refreshSubmitState();
    }

    function locationError(text) {
        state.lat = state.lng = null;
        locationEl.classList.add('wr-error');
        locationEl.innerHTML = `<i class="ti ti-alert-circle"></i> ${escapeHtml(text)}`;
        refreshSubmitState();
    }

    function useGPS() {
        if (!navigator.geolocation) {
            locationError('Geolocation not supported - use map center instead.');
            return;
        }
        locationEl.classList.remove('wr-error');
        locationEl.innerHTML = '<i class="ti ti-loader-2 wr-spin"></i> Acquiring your location...';
        navigator.geolocation.getCurrentPosition(
            (pos) => setLocation(pos.coords.latitude, pos.coords.longitude, 'GPS'),
            ()    => {
                if (_mlMap) {
                    const c = _mlMap.getCenter();
                    setLocation(c.lat, c.lng, 'map center');
                    msgEl.textContent = 'Location access denied - using map center. Drag the map and tap "Use map center" to adjust.';
                    msgEl.className = 'wr-msg wr-msg-warn';
                } else {
                    locationError('Could not get your location.');
                }
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    chipGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('.wr-chip');
        if (!btn) return;
        chipGrid.querySelectorAll('.wr-chip').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        state.type = btn.dataset.hazard;

        const hz = hazardById(state.type);
        if (hz.measure) {
            measureRow.style.display = '';
            measureLbl.textContent = hz.measure.label;
            measureInp.placeholder = hz.measure.placeholder;
            measureInp.dataset.unit = hz.measure.unit;
        } else {
            measureRow.style.display = 'none';
            measureInp.value = '';
            delete measureInp.dataset.unit;
        }
        refreshSubmitState();
    });

    $('wr-gps').addEventListener('click', useGPS);
    $('wr-center').addEventListener('click', () => {
        if (!_mlMap) { locationError('Map not ready.'); return; }
        const c = _mlMap.getCenter();
        setLocation(c.lat, c.lng, 'map center');
    });

    submitBtn.addEventListener('click', async () => {
        if (submitBtn.disabled) return;
        const hz = hazardById(state.type);
        const payload = {
            type: state.type,
            lat: state.lat,
            lng: state.lng,
            notes: notesEl.value.trim(),
        };
        if (hz.measure && measureInp.value !== '') {
            payload.measure = measureInp.value;
            payload.measureUnit = measureInp.dataset.unit || '';
        }

        state.submitting = true;
        refreshSubmitState();
        msgEl.textContent = 'Submitting...';
        msgEl.className = 'wr-msg';

        try {
            const report = await postReport(payload);

            const layerCb = document.getElementById('toggle-community-reports-layer');
            if (layerCb) layerCb.checked = true;
            localStorage.setItem('communityReportsEnabled', 'true');
            await addWeatherReportMarkers(_mlMap);

            if (_mlMap && report) {
                _mlMap.flyTo({ center: [report.lng, report.lat], zoom: Math.max(_mlMap.getZoom(), 8) });
            }

            msgEl.textContent = `${hz.label} report shared to the live map.`;
            msgEl.className = 'wr-msg wr-msg-ok';

            chipGrid.querySelectorAll('.wr-chip').forEach((c) => c.classList.remove('active'));
            state.type = null;
            measureRow.style.display = 'none';
            measureInp.value = '';
            notesEl.value = '';
            renderList();
        } catch (err) {
            msgEl.textContent = 'Could not submit: ' + err.message;
            msgEl.className = 'wr-msg wr-msg-warn';
        } finally {
            state.submitting = false;
            refreshSubmitState();
        }
    });

    $('wr-clear').addEventListener('click', async () => {
        const mine = _reports.filter((r) => r.mine);
        if (!mine.length) return;
        if (!confirm('Delete all of your weather reports from the shared map?')) return;
        try {
            await clearMyReports();
            await fetchReports();
            if (_enabled) { _lastSig = ''; renderMarkers(); }
            renderList();
            msgEl.textContent = 'Your reports were removed.';
            msgEl.className = 'wr-msg';
        } catch (err) {
            msgEl.textContent = 'Could not clear: ' + err.message;
            msgEl.className = 'wr-msg wr-msg-warn';
        }
    });

    function renderList() {
        const mine = _reports.filter((r) => r.mine);
        if (!mine.length) {
            listEl.innerHTML = '<div class="wr-empty">You haven\'t filed any reports yet.</div>';
            return;
        }
        listEl.innerHTML = mine.map((r) => {
            const hz = hazardById(r.type);
            const meas = r.measure ? ` · ${escapeHtml(r.measure)} ${escapeHtml(r.measureUnit || '')}` : '';
            return `
                <div class="wr-item" data-id="${r.id}">
                    <span class="wr-item-icon" style="color:${hz.color};"><i class="ti ti-${hz.icon}"></i></span>
                    <span class="wr-item-body">
                        <span class="wr-item-title">${escapeHtml(hz.label)}${meas}</span>
                        <span class="wr-item-sub">${formatTime(r.time)} · ${Number(r.lat).toFixed(3)}, ${Number(r.lng).toFixed(3)}</span>
                    </span>
                    <button type="button" class="wr-item-go" data-go="${r.id}" title="Show on map"><i class="ti ti-map-pin"></i></button>
                    <button type="button" class="wr-item-del" data-del="${r.id}" title="Delete report"><i class="ti ti-trash"></i></button>
                </div>`;
        }).join('');
    }

    listEl.addEventListener('click', async (e) => {
        const del = e.target.closest('[data-del]');
        const go = e.target.closest('[data-go]');
        if (del) {
            try {
                await deleteReport(del.dataset.del);
                await fetchReports();
                if (_enabled) { _lastSig = ''; renderMarkers(); }
                renderList();
            } catch (err) {
                msgEl.textContent = 'Could not delete: ' + err.message;
                msgEl.className = 'wr-msg wr-msg-warn';
            }
        } else if (go) {
            const r = _reports.find((x) => x.id === go.dataset.go);
            if (r && _mlMap) {
                _mlMap.flyTo({ center: [r.lng, r.lat], zoom: Math.max(_mlMap.getZoom(), 9) });
                dialog.close();
            }
        }
    });

    useGPS();
    listEl.innerHTML = '<div class="wr-empty">Loading...</div>';
    fetchReports().then(renderList);

    return dialog;
}
