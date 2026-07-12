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

// GPS accuracy handling. A single getCurrentPosition() reading is often a coarse
// Wi-Fi/IP-based fix (tens of miles off on a laptop), which is exactly how a
// report ends up far from where the spotter actually is. So we watch the
// position, keep the *most accurate* fix, and tell the user how tight it is.
const GPS_GOOD_M   = 50;    // <= this: a real GPS fix, settle immediately
const GPS_OK_M     = 300;   // <= this: good enough to place a report
const GPS_COARSE_M = 3000;  // <= this: approximate (warn); above: rough (strong warn)
const GPS_MAX_WAIT_MS = 15000; // keep refining up to this long, then take best

// meters -> friendly "±X m" / "±X mi"
function fmtAccuracy(m) {
    if (m == null || !isFinite(m)) return '';
    if (m < 1000) return `±${Math.round(m)} m`;
    const mi = m / 1609.34;
    return `±${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

function gpsErrorText(err) {
    if (err && err.code === 1) return 'Location access denied — enable location for this site, or pin your exact spot on the map.';
    if (err && err.code === 3) return 'GPS timed out — pin your exact spot on the map.';
    return 'Could not get your location — pin your exact spot on the map.';
}

// Styles for the location tip, primary button, draggable pin and confirm bar.
let _wrExtraStyles = false;
function injectExtraStyles() {
    if (_wrExtraStyles) return;
    _wrExtraStyles = true;
    const s = document.createElement('style');
    s.textContent = `
    .wr-loc-tip { font-size: 12px; color: var(--text-muted, #9ca3af); margin: 8px 0 0; line-height: 1.45; }
    .wr-loc-tip b { color: #e7eef7; }
    .wr-btn-primary { background: #ff2121 !important; border-color: #ff2121 !important; color: #fff !important; }
    .wr-btn-primary:hover { background: #e01818 !important; }
    .wr-drag-pin { color: #ff2121; font-size: 40px; line-height: 1; cursor: grab;
        filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6)); -webkit-user-select: none; user-select: none; }
    .wr-drag-pin:active { cursor: grabbing; }
    .wr-pin-bar {
        position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
        z-index: 100001; width: min(560px, 94vw);
        background: rgba(11, 18, 32, 0.98); border: 1px solid rgba(255,255,255,0.14);
        border-radius: 14px; box-shadow: 0 16px 48px rgba(0,0,0,0.55);
        color: #e7eef7; font-family: 'Onest', system-ui, sans-serif;
        padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
        flex-wrap: wrap;
    }
    .wr-pin-bar-text { font-size: 13px; display: flex; align-items: center; gap: 6px; flex: 1; min-width: 200px; }
    .wr-pin-bar-text .ti { color: #ff2121; }
    .wr-pin-coords { color: var(--text-muted, #9ca3af); font-variant-numeric: tabular-nums; margin-left: 6px; }
    .wr-pin-bar-btns { display: flex; gap: 8px; flex-shrink: 0; }
    .wr-pin-bar .wr-btn { white-space: nowrap; }`;
    document.head.appendChild(s);
}

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
        const acc = (report.accuracy != null) ? ` · GPS ${fmtAccuracy(report.accuracy)}` : '';
        const popupHtml = `
            <div class="wr-popup">
                <div class="wr-pop-head" style="color:${hz.color};">
                    <i class="ti ti-${hz.icon}"></i> ${escapeHtml(hz.label)}
                </div>
                ${detail}
                ${notes}
                <div class="wr-pop-time">${formatTime(report.time)}${acc}</div>
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

    const state = { type: null, lat: null, lng: null, accuracy: null, submitting: false };

    // Live GPS watcher handles for this dialog (cleared on settle / close).
    let gpsWatchId = null, gpsTimer = null, gpsBest = null;
    function stopWatch() {
        if (gpsWatchId != null && navigator.geolocation) { navigator.geolocation.clearWatch(gpsWatchId); }
        gpsWatchId = null;
        if (gpsTimer) { clearTimeout(gpsTimer); gpsTimer = null; }
    }

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
                <button type="button" class="wr-btn wr-btn-primary" id="wr-pin"><i class="ti ti-pin"></i> Pin exact spot on map</button>
                <button type="button" class="wr-btn" id="wr-gps"><i class="ti ti-current-location"></i> Use my GPS</button>
                <button type="button" class="wr-btn" id="wr-center"><i class="ti ti-map-pin"></i> Use map center</button>
            </div>
            <p class="wr-loc-tip">On a hotspot or laptop, GPS can be miles off. Tap <b>Pin exact spot</b> to drop a marker and drag it to exactly where you are.</p>

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

    injectExtraStyles();
    const dialog = new Dialog('Report Weather', 'flag-3', content, {}, true);
    // Release the GPS watcher and any active pin-placement when the dialog goes away.
    const _origClose = dialog.close.bind(dialog);
    dialog.close = () => { stopWatch(); if (_pinCleanup) _pinCleanup(); _origClose(); };

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

    // label: e.g. 'GPS' or 'map center'. accuracy: meters (null when unknown, e.g.
    // map center). refining: still waiting on a tighter GPS fix.
    function setLocation(lat, lng, label, accuracy = null, refining = false) {
        state.lat = lat;
        state.lng = lng;
        state.accuracy = (accuracy != null && isFinite(accuracy)) ? accuracy : null;
        locationEl.classList.remove('wr-error');
        const accTxt = state.accuracy != null ? ` (${fmtAccuracy(state.accuracy)})` : '';
        const icon = refining ? 'ti-loader-2 wr-spin' : 'ti-map-pin-filled';
        const src = refining ? `· refining ${label}…` : `· ${label}`;
        locationEl.innerHTML = `<i class="ti ${icon}"></i> ${lat.toFixed(4)}, ${lng.toFixed(4)}${accTxt} <span class="wr-loc-src">${src}</span>`;
        refreshSubmitState();
    }

    function locationError(text) {
        state.lat = state.lng = state.accuracy = null;
        locationEl.classList.add('wr-error');
        locationEl.innerHTML = `<i class="ti ti-alert-circle"></i> ${escapeHtml(text)}`;
        refreshSubmitState();
    }

    function fallbackToCenter(reason) {
        if (_mlMap) {
            const c = _mlMap.getCenter();
            setLocation(c.lat, c.lng, 'map center', null, false);
            msgEl.textContent = reason + ' Using map center — drag the map to your exact spot and tap "Use map center".';
            msgEl.className = 'wr-msg wr-msg-warn';
        } else {
            locationError(reason);
        }
    }

    // Once we settle on the best GPS fix, decide how much to trust it.
    function applyGpsFix(fix) {
        setLocation(fix.lat, fix.lng, 'GPS', fix.accuracy, false);
        if (fix.accuracy != null && fix.accuracy > GPS_COARSE_M) {
            msgEl.textContent = `Your device only returned a rough location (${fmtAccuracy(fix.accuracy)}) — common on laptops/desktops without GPS. Please drag the map to your exact spot and tap "Use map center" before submitting.`;
            msgEl.className = 'wr-msg wr-msg-warn';
        } else if (fix.accuracy != null && fix.accuracy > GPS_OK_M) {
            msgEl.textContent = `Approximate location (${fmtAccuracy(fix.accuracy)}). If the pin looks off, drag the map and tap "Use map center".`;
            msgEl.className = 'wr-msg wr-msg-warn';
        } else {
            msgEl.textContent = '';
            msgEl.className = 'wr-msg';
        }
    }

    function useGPS() {
        if (!navigator.geolocation) {
            fallbackToCenter('Geolocation isn\'t supported on this device.');
            return;
        }
        stopWatch();
        gpsBest = null;
        let settled = false;
        locationEl.classList.remove('wr-error');
        locationEl.innerHTML = '<i class="ti ti-loader-2 wr-spin"></i> Acquiring GPS…';

        const settle = () => {
            if (settled) return;
            settled = true;
            stopWatch();
            if (gpsBest) applyGpsFix(gpsBest);
            else fallbackToCenter('Could not get a GPS fix.');
        };

        gpsWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                const acc = pos.coords.accuracy; // meters (95% confidence radius)
                if (!gpsBest || acc < gpsBest.accuracy) {
                    gpsBest = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: acc };
                }
                // Live preview so the user watches the fix tighten from ±miles to ±m.
                if (!settled) setLocation(gpsBest.lat, gpsBest.lng, 'GPS', gpsBest.accuracy, true);
                // A tight fix is as good as it gets — stop early.
                if (gpsBest.accuracy <= GPS_GOOD_M) settle();
            },
            (err) => {
                // Keep any fix we already have; otherwise fall back to map center.
                if (gpsBest) settle();
                else if (!settled) { settled = true; stopWatch(); fallbackToCenter(gpsErrorText(err)); }
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_MAX_WAIT_MS }
        );

        // Stop refining after the max wait and take the best fix so far.
        gpsTimer = setTimeout(settle, GPS_MAX_WAIT_MS);
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
        stopWatch(); // user chose the map center explicitly; stop overriding it
        if (!_mlMap) { locationError('Map not ready.'); return; }
        const c = _mlMap.getCenter();
        setLocation(c.lat, c.lng, 'map center', null, false);
        msgEl.textContent = '';
        msgEl.className = 'wr-msg';
    });
    $('wr-pin').addEventListener('click', startPinPlacement);

    // ── Pin-on-map placement ──────────────────────────────────────────────────
    // The only location method that doesn't depend on GPS quality: temporarily
    // step out of the dialog, drop a draggable marker on the real map, and let the
    // spotter drag it (or tap the map) to their exact spot. Hotspot-proof.
    let _pinActive = false;
    let _pinCleanup = null;
    function startPinPlacement() {
        if (_pinActive) return;
        if (!_mlMap || typeof maplibregl === 'undefined') { locationError('Map not ready.'); return; }
        _pinActive = true;
        stopWatch();
        injectExtraStyles();

        const start = (state.lat != null && state.lng != null)
            ? { lng: state.lng, lat: state.lat }
            : _mlMap.getCenter();
        let picked = { lat: start.lat, lng: start.lng };

        // Hide the dialog so the map underneath is interactive.
        dialog.overlay.style.display = 'none';
        _mlMap.easeTo({ center: [start.lng, start.lat], zoom: Math.max(_mlMap.getZoom(), 11), duration: 350 });

        const pinEl = document.createElement('div');
        pinEl.className = 'wr-drag-pin';
        pinEl.innerHTML = '<i class="ti ti-map-pin-filled"></i>';
        const marker = new maplibregl.Marker({ element: pinEl, draggable: true, anchor: 'bottom' })
            .setLngLat([start.lng, start.lat])
            .addTo(_mlMap);

        const bar = document.createElement('div');
        bar.className = 'wr-pin-bar';
        bar.innerHTML = `
            <div class="wr-pin-bar-text"><i class="ti ti-pin"></i> Drag the pin (or tap the map) to your exact location
                <span class="wr-pin-coords" id="wr-pin-coords"></span></div>
            <div class="wr-pin-bar-btns">
                <button type="button" class="wr-btn" id="wr-pin-cancel">Cancel</button>
                <button type="button" class="wr-btn wr-btn-primary" id="wr-pin-confirm"><i class="ti ti-check"></i> Confirm location</button>
            </div>`;
        document.body.appendChild(bar);

        const coordsEl = bar.querySelector('#wr-pin-coords');
        const updateCoords = () => { coordsEl.textContent = `${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}`; };
        updateCoords();

        marker.on('drag', () => { const p = marker.getLngLat(); picked = { lat: p.lat, lng: p.lng }; updateCoords(); });
        const onMapClick = (e) => { marker.setLngLat(e.lngLat); picked = { lat: e.lngLat.lat, lng: e.lngLat.lng }; updateCoords(); };
        _mlMap.on('click', onMapClick);

        function finish(restoreDialog = true) {
            _mlMap.off('click', onMapClick);
            try { marker.remove(); } catch { /* ignore */ }
            bar.remove();
            if (restoreDialog) dialog.overlay.style.display = '';
            _pinActive = false;
            _pinCleanup = null;
        }
        // Exposed so closing the dialog mid-placement tears the map UI down too.
        _pinCleanup = () => finish(false);

        bar.querySelector('#wr-pin-confirm').addEventListener('click', () => {
            setLocation(picked.lat, picked.lng, 'pinned on map', null, false);
            msgEl.textContent = '';
            msgEl.className = 'wr-msg';
            finish();
        });
        bar.querySelector('#wr-pin-cancel').addEventListener('click', () => finish());
    }

    submitBtn.addEventListener('click', async () => {
        if (submitBtn.disabled) return;
        const hz = hazardById(state.type);
        const payload = {
            type: state.type,
            lat: state.lat,
            lng: state.lng,
            accuracy: state.accuracy,
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
                        <span class="wr-item-sub">${formatTime(r.time)} · ${Number(r.lat).toFixed(3)}, ${Number(r.lng).toFixed(3)}${r.accuracy != null ? ' · ' + fmtAccuracy(r.accuracy) : ''}</span>
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
