/*
 * components/field_tracking.js — Field Tracking
 * ────────────────────────────────────────────────────────────────────────────
 * Two different screens behind one menu row, because two different people open
 * it. A chaser opens it to decide whether to be tracked. The owner opens it to
 * see who is out there. Neither should have to read past the other's half, so
 * the dialog shows the consent panel to everyone and the chaser list only to
 * the one account the server will answer for.
 *
 * ── THE PROMISE, as the chaser must be able to read it: their location goes
 *    to one named person and nobody else. So the consent screen NAMES that
 *    person, from the server rather than from a string typed in here — if the
 *    owner ever changes, the screen that asks for consent changes with it. A
 *    promise the user cannot check is not worth making.
 *
 * ── THE HARD PART IS NOT PERMISSION, IT IS STAYING ALIVE. A browser is a bad
 *    place to run a tracker: watchPosition is throttled when the tab is
 *    backgrounded and stops when the screen locks, and nothing tells the
 *    server that happened — the pings simply stop, which from the owner's side
 *    is indistinguishable from a chaser parked in a field. There is no web API
 *    that fixes this. So instead of pretending:
 *
 *      · a screen Wake Lock is held while sharing, so a mounted phone with the
 *        app in front keeps reporting, which is the actual use case;
 *      · the chaser is told plainly when reporting has paused, and why,
 *        rather than being shown a green light that means nothing;
 *      · reporting resumes by itself on returning to the app, and a position
 *        is sent immediately rather than at the next interval;
 *      · the server ages a chaser out on its own (see field_tracking.js), so
 *        the owner sees "last heard 6 min ago", not a stale dot.
 *
 * ── RESUMING. Sharing lives on the server, not in this tab, so a chaser who
 *    reloads or reopens the app is still sharing and the watch restarts by
 *    itself. The alternative — sharing that silently lapses on reload — is the
 *    worse failure: they would believe they were visible while not being.
 */

const API = '/api/tracking';
const PING_MS = 8000;            // how often a position is sent at most
const REFRESH_MS = 20000;        // owner's list refresh, as SSE backup
const $ = (id) => document.getElementById(id);

function mapObj() { return window.vortexMap && window.vortexMap.map; }
function GL() { return window.mapboxgl || window.maplibregl; }

async function api(method, endpoint, body) {
    const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(API + endpoint, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
}

/* ── state ─────────────────────────────────────────────────────────────────── */
let me = null;                   // last /me response
let watchId = null;
let wakeLock = null;
let lastSentAt = 0;
let lastFix = null;              // the most recent position, sent or not
let gpsError = '';               // why reporting is not happening, if it is not
let pingTimer = null;

let chasers = [];                // owner's view
let sse = null;
let listTimer = null;
let followId = null;             // chaser the map is following, if any
const markers = new Map();       // userId -> marker

/* ── how long ago, in words ────────────────────────────────────────────────── */
function ago(ms) {
    if (ms == null) return 'never';
    const s = Math.round(ms / 1000);
    if (s < 15) return 'just now';
    if (s < 90) return s + 's ago';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    return h + 'h ' + (m % 60) + 'm ago';
}

/* Metres per second is what the GPS gives; nobody chases in metres per second. */
const mph = (ms) => (ms == null ? null : Math.round(ms * 2.23694));

const compass = (deg) => {
    if (deg == null) return '';
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
};

/* ── reporting from the field ──────────────────────────────────────────────── */

/*
 * Keep the screen awake while sharing.
 *
 * Not a nicety: a locked screen stops the GPS watch, so without this a chaser
 * who pockets their phone stops existing as far as the map is concerned. The
 * lock is dropped the moment sharing stops, because holding a phone awake for
 * no reason is a flat battery three hours later.
 */
async function acquireWakeLock() {
    try {
        if (!('wakeLock' in navigator) || wakeLock) return;
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; /* refused or unsupported; not fatal */ }
}

function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* already gone */ }
    wakeLock = null;
}

/* Battery level, when the browser will say — it is the thing a chaser runs out
   of first, and it is useful to the person deciding whether to call them. */
async function batteryLevel() {
    try {
        if (!navigator.getBattery) return null;
        const b = await navigator.getBattery();
        return typeof b.level === 'number' ? b.level : null;
    } catch (e) { return null; }
}

async function sendFix(force) {
    if (!lastFix || !me || !me.sharing) return;
    const now = Date.now();
    if (!force && now - lastSentAt < PING_MS) return;
    lastSentAt = now;
    try {
        await api('POST', '/ping', {
            lat: lastFix.lat, lng: lastFix.lng,
            accuracy: lastFix.accuracy, speed: lastFix.speed,
            heading: lastFix.heading, altitude: lastFix.altitude,
            battery: await batteryLevel(),
        });
        gpsError = '';
        me.lastAt = now;
    } catch (e) {
        /*
         * A 409 means the server says sharing is off — which is the truth, and
         * this tab is the one that is wrong (revoked on another device, or the
         * account was removed). Stop rather than retry forever.
         */
        if (/sharing is off/i.test(e.message)) { me.sharing = false; stopReporting(); }
        gpsError = e.message;
    }
    paintSelf();
}

function onPosition(pos) {
    lastFix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
        altitude: pos.coords.altitude,
    };
    gpsError = '';
    sendFix(false);
}

function onPositionError(err) {
    gpsError = err.code === 1
        ? 'Location permission is denied — this has to be changed in your browser settings for this site.'
        : (err.code === 3 ? 'No GPS fix yet.' : 'Could not read GPS.');
    paintSelf();
}

function startReporting() {
    if (!navigator.geolocation) { gpsError = 'This device has no GPS.'; paintSelf(); return; }
    if (watchId == null) {
        watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
            enableHighAccuracy: true, maximumAge: 5000, timeout: 25000,
        });
    }
    /*
     * A timer as well as the watch. watchPosition only fires when the position
     * CHANGES, so a chaser stopped at a gas station would stop reporting and
     * age out of the owner's list as though they had lost signal. The timer
     * resends the last fix so "parked" and "gone" stay distinguishable.
     */
    if (!pingTimer) pingTimer = setInterval(() => sendFix(false), PING_MS);
    acquireWakeLock();
}

function stopReporting() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    releaseWakeLock();
}

/*
 * Returning to the app: reacquire the lock the system took away, and send a
 * position at once. Without the immediate send, a chaser who looks at their
 * phone after ten minutes would still read as ten minutes stale for another
 * eight seconds, which is exactly when somebody is checking.
 */
function onVisible() {
    if (!me || !me.sharing) return;
    if (document.visibilityState === 'visible') {
        acquireWakeLock();
        startReporting();
        sendFix(true);
    }
    paintSelf();
}

/* ── the owner's map ───────────────────────────────────────────────────────── */

const TRAIL_SRC = 'vr-track-trail';
const TRAIL_LAYER = 'vr-track-trail-line';

function markerEl(c) {
    const el = document.createElement('div');
    el.className = 'vr-track-dot' + (c.stale ? ' stale' : '') + (c.id === followId ? ' sel' : '');
    /*
     * A heading arrow rather than a label: on a four-chaser screen the names
     * collide and the thing worth seeing at a glance is which way they are
     * pointing.
     */
    const rot = c.heading == null ? null : c.heading;
    el.innerHTML = '<i></i>' + (rot == null ? '' : `<b style="transform:rotate(${rot}deg)"></b>`);
    el.title = `${c.name} — ${ago(c.ageMs)}${c.speed != null ? ', ' + mph(c.speed) + ' mph' : ''}`;
    el.addEventListener('click', (e) => { e.stopPropagation(); follow(c.id); });
    return el;
}

function paintMarkers() {
    const m = mapObj(), g = GL();
    if (!m || !g) return;
    const seen = new Set();
    for (const c of chasers) {
        if (c.lat == null || c.lng == null) continue;
        seen.add(c.id);
        const existing = markers.get(c.id);
        if (existing) {
            existing.setLngLat([c.lng, c.lat]);
            // Rebuild the element's look in place; replacing the marker would
            // make it blink on every refresh.
            const el = existing.getElement();
            el.className = 'vr-track-dot' + (c.stale ? ' stale' : '') + (c.id === followId ? ' sel' : '');
            const b = el.querySelector('b');
            if (b && c.heading != null) b.style.transform = `rotate(${c.heading}deg)`;
            el.title = `${c.name} — ${ago(c.ageMs)}${c.speed != null ? ', ' + mph(c.speed) + ' mph' : ''}`;
        } else {
            const mk = new g.Marker({ element: markerEl(c) }).setLngLat([c.lng, c.lat]).addTo(m);
            markers.set(c.id, mk);
        }
    }
    for (const [id, mk] of markers) {
        if (!seen.has(id)) { mk.remove(); markers.delete(id); }
    }
}

function clearMarkers() {
    for (const [, mk] of markers) mk.remove();
    markers.clear();
    const m = mapObj();
    if (!m) return;
    try {
        if (m.getLayer(TRAIL_LAYER)) m.removeLayer(TRAIL_LAYER);
        if (m.getSource(TRAIL_SRC)) m.removeSource(TRAIL_SRC);
    } catch (e) { /* the style went first */ }
}

function drawTrail(coords) {
    const m = mapObj();
    if (!m) return;
    /*
     * A style still loading cannot take a layer. Waiting for one 'idle' is
     * better than returning: the trail is drawn in answer to a tap, and
     * silently doing nothing reads as a broken button.
     */
    if (!m.isStyleLoaded()) { m.once('idle', () => drawTrail(coords)); return; }
    const data = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords || [] } };
    try {
        if (m.getSource(TRAIL_SRC)) { m.getSource(TRAIL_SRC).setData(data); return; }
        m.addSource(TRAIL_SRC, { type: 'geojson', data });
        m.addLayer({
            id: TRAIL_LAYER,
            type: 'line',
            source: TRAIL_SRC,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#37c3ff', 'line-width': 2.5, 'line-opacity': 0.75 },
        });
    } catch (e) { /* style reloading; the next refresh redraws it */ }
}

/* Follow one chaser: fly there, draw their trail, and keep the camera on them. */
async function follow(id) {
    const m = mapObj();
    followId = followId === id ? null : id;
    if (!followId) { drawTrail([]); paintList(); paintMarkers(); return; }
    try {
        const { chaser } = await api('GET', '/chasers/' + encodeURIComponent(followId));
        drawTrail(chaser.trail || []);
        if (m && chaser.lat != null) m.flyTo({ center: [chaser.lng, chaser.lat], zoom: Math.max(m.getZoom(), 8.5), speed: 0.9 });
    } catch (e) { /* they stopped sharing between the click and the fetch */ }
    paintList();
    paintMarkers();
}

async function refreshChasers() {
    if (!me || !me.isOwner) return;
    try {
        const d = await api('GET', '/chasers');
        chasers = d.chasers || [];
    } catch (e) {
        chasers = [];
    }
    paintMarkers();
    paintList();
    if (followId) {
        const c = chasers.find((x) => x.id === followId);
        const m = mapObj();
        if (c && m && !m.isMoving()) m.easeTo({ center: [c.lng, c.lat], duration: 900 });
    }
}

/*
 * Live updates. The list is also polled, slowly, because an SSE link that dies
 * quietly would leave the owner looking at a map that stopped updating without
 * saying so — and this is the screen where that matters most.
 */
function openStream() {
    if (sse || !me || !me.isOwner) return;
    try {
        sse = new EventSource(API + '/stream', { withCredentials: true });
    } catch (e) { sse = null; return; }

    sse.addEventListener('tracking-move', (ev) => {
        try {
            const { chaser } = JSON.parse(ev.data);
            const i = chasers.findIndex((c) => c.id === chaser.id);
            if (i >= 0) chasers[i] = { ...chasers[i], ...chaser };
            else chasers.push(chaser);
            chasers.sort((a, b) => (b.at || 0) - (a.at || 0));
            paintMarkers();
            paintList();
            if (followId === chaser.id) {
                const m = mapObj();
                if (m && !m.isMoving()) m.easeTo({ center: [chaser.lng, chaser.lat], duration: 900 });
            }
        } catch (e) { /* malformed frame */ }
    });

    const drop = (ev) => {
        try {
            const { id } = JSON.parse(ev.data);
            chasers = chasers.filter((c) => c.id !== id);
            if (followId === id) { followId = null; drawTrail([]); }
            paintMarkers();
            paintList();
        } catch (e) { /* malformed frame */ }
    };
    sse.addEventListener('tracking-off', drop);
    sse.addEventListener('tracking-trail-cleared', () => { if (followId) follow(followId); });
    sse.onerror = () => { /* EventSource retries on its own; the poll covers the gap */ };
}

function closeStream() {
    if (sse) { try { sse.close(); } catch (e) { /* already closed */ } sse = null; }
}

/* ── styles, shipped with the code that needs them ─────────────────────────── */
function injectStyles() {
    if (document.getElementById('vr-track-styles')) return;
    const el = document.createElement('style');
    el.id = 'vr-track-styles';
    el.textContent = [
        '.vr-track-backdrop{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;',
        '  justify-content:center;padding:18px;background:rgba(0,0,0,.55)}',
        '.vr-track-panel{width:min(580px,100%);max-height:88vh;overflow:auto;',
        '  background:var(--vx-surface,#11151c);border:1px solid rgba(255,255,255,.12);',
        '  border-radius:var(--vx-r-3,10px);box-shadow:var(--vx-shadow-lg,0 18px 44px rgba(0,0,0,.55));',
        '  color:var(--vx-text,#eef4fb);font-family:var(--vx-font,system-ui,sans-serif)}',
        '.vr-track-head{display:flex;align-items:center;gap:10px;padding:14px 16px;font-size:16px;',
        '  border-bottom:1px solid rgba(255,255,255,.09)}',
        '.vr-track-head b{flex:1 1 auto}',
        '.vr-track-x{background:rgba(255,255,255,.07);color:inherit;cursor:pointer;width:28px;height:28px;',
        '  border:1px solid rgba(255,255,255,.14);border-radius:var(--vx-r-2,6px);font-size:16px;',
        '  line-height:1;font-family:inherit}',
        '.vr-track-body{padding:14px 16px 18px}',
        '.vr-track-blurb{margin:0 0 12px;font-size:13px;line-height:1.55;color:#a8bace}',
        '.vr-track-who{display:block;margin:10px 0 12px;padding:10px 12px;font-size:13px;line-height:1.5;',
        '  background:rgba(55,195,255,.08);border:1px solid rgba(55,195,255,.3);',
        '  border-radius:var(--vx-r-2,6px)}',
        '.vr-track-who b{color:#9bdcff}',
        '.vr-track-state{font-size:13px;line-height:1.7;padding:10px 12px;background:rgba(0,0,0,.28);',
        '  border:1px solid rgba(255,255,255,.08);border-radius:var(--vx-r-2,6px)}',
        '.vr-track-state i{font-style:normal;color:#8fa6bd}',
        '.vr-track-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}',
        '.vr-track-actions button{padding:9px 13px;border-radius:var(--vx-r-2,6px);cursor:pointer;',
        '  font-family:inherit;font-size:13px;font-weight:700;color:var(--vx-text,#eef4fb);',
        '  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14)}',
        '.vr-track-actions button:disabled{opacity:.45;cursor:default}',
        '.vr-track-primary:not(:disabled){background:var(--vx-accent,#e8862b);',
        '  border-color:var(--vx-accent,#e8862b);color:#0b0f14}',
        '.vr-track-danger{color:#ff9183 !important;background:rgba(209,64,47,.14) !important;',
        '  border-color:rgba(209,64,47,.4) !important}',
        '.vr-track-sub{margin:18px 0 8px;font-size:11px;font-weight:800;letter-spacing:.12em;',
        '  text-transform:uppercase;color:#8fa6bd}',
        '.vr-track-name{display:flex;gap:8px;margin:10px 0 2px;flex-wrap:wrap}',
        '.vr-track-name input{flex:1 1 160px;min-width:0;padding:9px 11px;font-family:inherit;',
        '  font-size:13px;color:var(--vx-text,#eef4fb);background:rgba(0,0,0,.3);',
        '  border:1px solid rgba(255,255,255,.14);border-radius:var(--vx-r-2,6px)}',
        '.vr-track-list{display:flex;flex-direction:column;gap:7px}',
        '.vr-track-row{display:flex;align-items:center;gap:10px;padding:9px 11px;cursor:pointer;',
        '  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);',
        '  border-radius:var(--vx-r-2,6px)}',
        '.vr-track-row.sel{border-color:rgba(55,195,255,.55);background:rgba(55,195,255,.08)}',
        '.vr-track-row.stale{opacity:.62}',
        '.vr-track-row-main{flex:1 1 auto;display:flex;flex-direction:column;gap:2px;min-width:0}',
        '.vr-track-row-main b{font-size:13.5px}',
        '.vr-track-row-main span{font-size:12px;color:#a8bace}',
        '.vr-track-row-main i{font-style:normal;font-size:11px;color:#7f93a8}',
        '.vr-track-pip{flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:#37c3ff;',
        '  box-shadow:0 0 6px 2px rgba(55,195,255,.45)}',
        '.vr-track-row.stale .vr-track-pip{background:#7f93a8;box-shadow:none}',
        '.vr-track-empty{font-size:13px;color:#8fa6bd;padding:6px 2px;line-height:1.5}',
        '.vr-track-msg{margin-top:10px;font-size:12.5px;min-height:17px;color:#a8bace}',
        '.vr-track-msg.ok{color:#7ce8a8}',
        '.vr-track-msg.warn{color:var(--vx-accent,#e8862b)}',
        /* the map markers */
        '.vr-track-dot{position:relative;width:16px;height:16px;cursor:pointer}',
        '.vr-track-dot i{position:absolute;inset:0;border-radius:50%;background:#37c3ff;',
        '  border:2px solid #0b0f14;box-shadow:0 0 7px 2px rgba(55,195,255,.55)}',
        '.vr-track-dot b{position:absolute;left:50%;top:50%;width:0;height:0;margin:-15px 0 0 -5px;',
        '  border-left:5px solid transparent;border-right:5px solid transparent;',
        '  border-bottom:9px solid #37c3ff;transform-origin:50% 15px}',
        '.vr-track-dot.stale i{background:#8aa0b5;box-shadow:none}',
        '.vr-track-dot.stale b{border-bottom-color:#8aa0b5}',
        '.vr-track-dot.sel i{background:#fff;box-shadow:0 0 10px 3px rgba(55,195,255,.8)}',
    ].join('');
    document.head.appendChild(el);
}

/* ── the dialog ────────────────────────────────────────────────────────────── */
function closeDialog() {
    const el = $('vr-track-dialog');
    if (el) el.remove();
    closeStream();
    if (listTimer) { clearInterval(listTimer); listTimer = null; }
    /*
     * Markers and the trail are deliberately left on the map: the owner closes
     * this dialog in order to SEE the map, and taking the chasers away at that
     * moment would be the opposite of the point. Reporting is likewise left
     * running — closing a panel is not revoking consent.
     */
}

function msg(text, kind) {
    const el = $('vr-track-msg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'vr-track-msg' + (kind ? ' ' + kind : '');
}

/* The chaser's own half: what is happening, in words they can act on. */
function paintSelf() {
    const el = $('vr-track-self');
    if (!el || !me) return;

    const sharing = !!me.sharing;
    const paused = sharing && document.visibilityState !== 'visible';
    const lines = [];

    if (!sharing) {
        lines.push('<b>Not sharing.</b> Nobody can see your location.');
    } else if (gpsError) {
        lines.push(`<b style="color:var(--vx-accent,#e8862b)">Sharing is on, but not reporting.</b> ${gpsError}`);
    } else if (paused) {
        lines.push('<b style="color:var(--vx-accent,#e8862b)">Paused.</b> '
            + 'Reporting stops while this app is in the background or the screen is off. '
            + 'It resumes the moment you come back.');
    } else if (!lastFix) {
        lines.push('<b>Sharing is on.</b> Waiting for a GPS fix…');
    } else {
        lines.push('<b style="color:#7ce8a8">Reporting.</b>');
    }

    if (sharing) {
        lines.push(`<i>Last sent: ${ago(me.lastAt ? Date.now() - me.lastAt : null)}</i>`);
        if (lastFix) {
            const bits = [`${lastFix.lat.toFixed(4)}, ${lastFix.lng.toFixed(4)}`];
            if (lastFix.accuracy != null) bits.push(`±${Math.round(lastFix.accuracy)} m`);
            if (lastFix.speed != null && lastFix.speed >= 0) bits.push(`${mph(lastFix.speed)} mph`);
            lines.push(`<i>${bits.join(' · ')}</i>`);
        }
        if (!('wakeLock' in navigator)) {
            lines.push('<i>This browser cannot keep the screen awake, so locking the phone will stop reporting.</i>');
        }
        lines.push(`<i>Your track is kept for ${me.retentionHours} hours, then deleted automatically.</i>`);
    }

    el.innerHTML = lines.join('<br>');

    const btn = $('vr-track-toggle');
    if (btn) {
        btn.textContent = sharing ? 'Stop sharing my location' : 'Share my location';
        btn.className = sharing ? 'vr-track-danger' : 'vr-track-primary';
    }
    const wipe = $('vr-track-wipe');
    if (wipe) wipe.style.display = sharing ? '' : 'none';
}

/* The owner's half. */
function paintList() {
    const el = $('vr-track-list');
    if (!el) return;
    if (!chasers.length) {
        el.innerHTML = '<div class="vr-track-empty">Nobody is sharing their location right now. '
            + 'A chaser turns this on themselves, from this same screen on their own device.</div>';
        return;
    }
    el.innerHTML = chasers.map((c) => {
        const bits = [];
        if (c.speed != null && c.speed > 0.5) bits.push(`${mph(c.speed)} mph ${compass(c.heading)}`.trim());
        if (c.accuracy != null) bits.push(`±${c.accuracy} m`);
        if (c.battery != null) bits.push(`${c.battery}% battery`);
        return `<div class="vr-track-row${c.id === followId ? ' sel' : ''}${c.stale ? ' stale' : ''}" data-id="${c.id}">
            <span class="vr-track-pip"></span>
            <span class="vr-track-row-main">
              <b>${c.name}</b>
              <span>${c.stale ? 'Last heard ' + ago(c.ageMs) : ago(c.ageMs)}${bits.length ? ' · ' + bits.join(' · ') : ''}</span>
              <i>${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}</i>
            </span>
          </div>`;
    }).join('');
    for (const row of el.querySelectorAll('.vr-track-row')) {
        row.addEventListener('click', () => follow(row.getAttribute('data-id')));
    }
}

function openDialog() {
    injectStyles();
    if ($('vr-track-dialog')) return;

    const wrap = document.createElement('div');
    wrap.id = 'vr-track-dialog';
    wrap.className = 'vr-track-backdrop';
    wrap.innerHTML = `
      <div class="vr-track-panel" role="dialog" aria-label="Field Tracking">
        <div class="vr-track-head">
          <i class="fa-solid fa-location-crosshairs" style="color:#37c3ff"></i>
          <b>Field Tracking</b>
          <button class="vr-track-x" id="vr-track-close" aria-label="Close">&times;</button>
        </div>
        <div class="vr-track-body">
          <div id="vr-track-owner"></div>

          <div class="vr-track-sub">Sharing my own location</div>
          <p class="vr-track-blurb">
            If you are out in the field, you can let your position be followed on the map while you chase.
            It is off until you turn it on, and you can stop at any time.
          </p>
          <div class="vr-track-who" id="vr-track-who"></div>
          <div class="vr-track-state" id="vr-track-self">Loading…</div>
          <div class="vr-track-name">
            <input id="vr-track-label" type="text" maxlength="60" placeholder="Name shown on the map (optional)">
          </div>
          <div class="vr-track-actions">
            <button id="vr-track-toggle" class="vr-track-primary">Share my location</button>
            <button id="vr-track-wipe" class="vr-track-danger" style="display:none">Delete my track</button>
          </div>
          <div class="vr-track-msg" id="vr-track-msg"></div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeDialog(); });
    $('vr-track-close').onclick = closeDialog;

    $('vr-track-toggle').onclick = async () => {
        const btn = $('vr-track-toggle');
        btn.disabled = true;
        try {
            const want = !(me && me.sharing);
            const label = ($('vr-track-label') && $('vr-track-label').value.trim()) || '';
            const d = await api('POST', '/consent', { sharing: want, label });
            me.sharing = !!d.sharing;
            me.consentAt = d.consentAt;
            if (me.sharing) {
                startReporting();
                msg('Sharing is on. ' + (me.sharedWith ? me.sharedWith + ' can see where you are.' : ''), 'ok');
                /*
                 * Ask for the fix here, inside the click, rather than waiting
                 * for the watch: the permission prompt should appear as a
                 * result of the button they just pressed, not seconds later
                 * with no obvious cause.
                 */
                navigator.geolocation.getCurrentPosition(
                    (p) => { onPosition(p); sendFix(true); }, onPositionError,
                    { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 },
                );
            } else {
                stopReporting();
                lastFix = null;
                msg('Sharing is off, and your track has been deleted.', 'ok');
            }
        } catch (e) {
            msg(e.message, 'warn');
        }
        btn.disabled = false;
        paintSelf();
    };

    $('vr-track-wipe').onclick = async () => {
        try {
            await api('DELETE', '/me/trail');
            msg('Your track has been deleted. Sharing is still on.', 'ok');
        } catch (e) { msg(e.message, 'warn'); }
    };

    refreshSelf();
}

async function refreshSelf() {
    try {
        me = await api('GET', '/me');
    } catch (e) {
        msg('Could not reach the server.', 'warn');
        return;
    }

    const who = $('vr-track-who');
    if (who) {
        who.innerHTML = me.sharedWith
            ? `Your location is shared with <b>${me.sharedWith}</b> and nobody else — not other chasers, `
              + 'and not other administrators. It is not shown on the public map.'
            : 'No viewer is configured on this server, so nothing is being shared with anybody.';
    }
    const label = $('vr-track-label');
    if (label && me.label && !label.value) label.value = me.label;

    paintSelf();

    /* The owner's half only exists for the owner. */
    if (me.isOwner) {
        const host = $('vr-track-owner');
        if (host && !$('vr-track-list')) {
            host.innerHTML = `
              <div class="vr-track-sub">Chasers in the field</div>
              <p class="vr-track-blurb">
                Everyone who has turned sharing on. Tap one to centre the map on them, draw their track
                and follow them as they move; tap again to stop following.
                A chaser is marked stale after ${me.staleAfterMinutes} minutes without word — usually a
                phone that locked or lost signal.
              </p>
              <div class="vr-track-list" id="vr-track-list"></div>`;
        }
        refreshChasers();
        openStream();
        if (!listTimer) listTimer = setInterval(refreshChasers, REFRESH_MS);
    }
}

/* ── boot ──────────────────────────────────────────────────────────────────── */
function init() {
    const btn = document.getElementById('armrFieldTrackBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            const m = document.getElementById('vortexRadarMenu');
            if (m) m.style.display = 'none';
            openDialog();
        });
    }

    document.addEventListener('visibilitychange', onVisible);

    /*
     * Resume on load without anybody opening the dialog. Sharing is a server
     * fact, so a reload, a crash or reopening the app should not quietly end
     * it — a chaser who believes they are visible and is not, is the one
     * failure this feature cannot have.
     */
    (async () => {
        try {
            me = await api('GET', '/me');
        } catch (e) { return; }           // signed out: nothing to resume
        if (me.sharing) startReporting();
        if (me.isOwner) {
            /*
             * The owner's markers run whether or not the panel is open, so
             * chasers are on the map as soon as the app loads. This is the one
             * account that can see them, and it is their own map.
             */
            refreshChasers();
            openStream();
            if (!listTimer) listTimer = setInterval(refreshChasers, REFRESH_MS);
        }
    })();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

/* Opening it from elsewhere (a toolbar button, the console) without a menu row. */
window.vortexFieldTracking = { open: openDialog, clearMarkers };
