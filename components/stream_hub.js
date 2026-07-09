/*
 * components/stream_hub.js
 * The Chase Stream Hub — one place for a storm chaser to go live and manage the
 * whole broadcast without leaving Vortex Radar.
 *
 * What it does (Phase 1):
 *   - Go Live / Stop from one button, with a LIVE badge shown in the app.
 *   - Remote-controls OBS on the field laptop over obs-websocket (start/stop the
 *     stream, and push a live overlay line into a Text source).
 *   - Reads GPS, reverse-geocodes it to town / county / state, and keeps it live
 *     as you drive.
 *   - Auto-builds the stream title from a template + your current location.
 *   - Drops a live "you" marker on the map and shows other live chasers' markers.
 *   - Auto-posts a go-live announcement to Discord (Facebook is wired for once
 *     the account is connected — see notes in the panel).
 *
 * Video is produced by OBS; this module is the control panel + overlay + auto-
 * post. Settings persist per-account on the server (/api/stream/config).
 *
 * ES module, loaded via a <script type="module"> tag on the main page.
 */

import OBSClient from './obs_websocket.js';

const API = '/api/stream';
const LIVE_PING_MS = 15000;   // how often we push our moving position while live
const OTHERS_POLL_MS = 30000; // how often we refresh other chasers' markers
const GEOCODE_MIN_MS = 20000; // don't reverse-geocode more often than this

let cfg = null;               // public config from the server
let obs = null;               // OBSClient instance while connected
let live = false;
let watchId = null;
let livePingTimer = null;
let othersTimer = null;
let lastGeocodeAt = 0;
let lastPos = null;           // { lat, lng }
let place = { town: '', county: '', state: '', label: '' };
let myMarker = null;
let obsWasUsed = false;        // true once a live session connected to OBS
let isAdmin = false;           // operator (can control other chasers)
let agentSSE = null;           // chaser agent: SSE link that receives commands
let agentObs = null;           // chaser agent: persistent OBS connection
let agentStatusTimer = null;
let agentsPollTimer = null;     // operator: polls the connected-chasers list
const otherMarkers = new Map(); // userId -> mapbox Marker

// ─── small helpers ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function mapObj() { return window.vortexMap && window.vortexMap.map; }
function GL() { return window.mapboxgl || window.maplibregl; }

async function api(method, endpoint, body) {
    const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(API + endpoint, opts);
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
}

function toast(msg, kind) {
    const colors = { info: '#27beff', ok: '#34d399', warn: '#facc15', error: '#f87171' };
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `position:fixed; bottom:96px; left:50%; transform:translateX(-50%);
        background:rgba(11,18,32,0.97); color:${colors[kind] || colors.info};
        border:1px solid ${colors[kind] || colors.info}; padding:10px 15px; border-radius:10px;
        font-family:'Onest',system-ui,sans-serif; font-size:13px; z-index:100060;
        box-shadow:0 10px 30px rgba(0,0,0,0.5); max-width:82vw; text-align:center;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

// ─── reverse geocoding (Mapbox) ───────────────────────────────────────────────
async function reverseGeocode(lng, lat) {
    const token = (GL() && GL().accessToken) || '';
    if (!token) return null;
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`
        + `?types=place,locality,district,region&limit=5&access_token=${token}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const out = { town: '', county: '', state: '', label: '' };
    for (const f of (j.features || [])) {
        const t = (f.place_type || [])[0];
        if ((t === 'place' || t === 'locality') && !out.town) out.town = f.text;
        else if (t === 'district' && !out.county) out.county = f.text; // US county
        else if (t === 'region' && !out.state) out.state = (f.properties && f.properties.short_code
            ? f.properties.short_code.replace(/^US-/, '') : f.text);
    }
    out.label = [out.town, out.county, out.state].filter(Boolean).join(', ');
    return out;
}

// ─── title template ───────────────────────────────────────────────────────────
function buildTitle() {
    const now = new Date();
    const tmpl = (cfg && cfg.titleTemplate) || '🔴 LIVE — chasing near {place} — {time}';
    return tmpl
        .replace(/\{place\}/g, place.label || 'unknown location')
        .replace(/\{town\}/g, place.town || '')
        .replace(/\{county\}/g, place.county || '')
        .replace(/\{state\}/g, place.state || '')
        .replace(/\{time\}/g, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
        .replace(/\{date\}/g, now.toLocaleDateString())
        .replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim();
}

// ─── live "you" marker + others ───────────────────────────────────────────────
function ensureMyMarker(lng, lat) {
    const m = mapObj(), g = GL();
    if (!m || !g) return;
    if (!myMarker) {
        const el = document.createElement('div');
        el.className = 'vr-live-marker vr-live-marker-me';
        el.innerHTML = '<span class="vr-live-pulse"></span><span class="vr-live-tag">LIVE</span>';
        myMarker = new g.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
    } else {
        myMarker.setLngLat([lng, lat]);
    }
}
function removeMyMarker() { if (myMarker) { myMarker.remove(); myMarker = null; } }

async function refreshOtherChasers() {
    const m = mapObj(), g = GL();
    if (!m || !g) return;
    let list = [];
    try { list = (await api('GET', '/live')).live || []; } catch { return; }
    const seen = new Set();
    for (const s of list) {
        seen.add(s.id);
        let mk = otherMarkers.get(s.id);
        if (!mk) {
            const el = document.createElement('div');
            el.className = 'vr-live-marker vr-live-marker-other';
            el.innerHTML = '<span class="vr-live-pulse"></span><span class="vr-live-tag">LIVE</span>';
            el.title = s.name || 'Live chaser';
            const popup = new g.Popup({ offset: 18, closeButton: false }).setHTML(
                `<div style="font-family:'Onest',sans-serif;color:#fff;font-size:13px;min-width:150px">
                    <div style="font-weight:700;color:#ff3b30">🔴 ${s.name || 'Live chaser'}</div>
                    ${s.place ? `<div style="margin-top:2px">📍 ${s.place}</div>` : ''}
                    ${s.url ? `<div style="margin-top:4px"><a href="${s.url}" target="_blank" style="color:#27beff">Watch stream ↗</a></div>` : ''}
                </div>`);
            mk = new g.Marker({ element: el }).setLngLat([s.lng, s.lat]).setPopup(popup).addTo(m);
            otherMarkers.set(s.id, mk);
        } else {
            mk.setLngLat([s.lng, s.lat]);
        }
    }
    for (const [id, mk] of otherMarkers) { if (!seen.has(id)) { mk.remove(); otherMarkers.delete(id); } }
}

// ─── GPS while live ───────────────────────────────────────────────────────────
function currentStreamUrl() { return ($('vrsh-stream-url') && $('vrsh-stream-url').value.trim()) || ''; }

async function onPosition(pos) {
    lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    ensureMyMarker(lastPos.lng, lastPos.lat);

    // Reverse-geocode, throttled, then refresh title + overlay + status.
    const now = Date.now();
    if (now - lastGeocodeAt > GEOCODE_MIN_MS) {
        lastGeocodeAt = now;
        try {
            const p = await reverseGeocode(lastPos.lng, lastPos.lat);
            if (p) { place = p; updateLocationUI(); pushOverlay(); }
        } catch {}
    }
}

function startGpsWatch() {
    if (!navigator.geolocation) { toast('This device has no GPS/location.', 'warn'); return; }
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(onPosition, (err) => {
        toast(err.code === 1 ? 'Location permission denied — the live marker/title need GPS.' : 'Could not read GPS.', 'warn');
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
}
function stopGpsWatch() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

// push current position + title to the server so other chasers see us
async function pingLive() {
    if (!live || !lastPos) return;
    try {
        await api('POST', '/live', {
            lat: lastPos.lat, lng: lastPos.lng, place: place.label,
            title: buildTitle(), url: currentStreamUrl(),
        });
    } catch {}
}

// push the current title line into OBS's overlay text source
async function pushOverlay() {
    if (live && obs && obs.connected && cfg && cfg.obs && cfg.obs.overlaySource) {
        try { await obs.setOverlayText(cfg.obs.overlaySource, buildTitle()); } catch {}
    }
}

// ─── go live / stop ───────────────────────────────────────────────────────────
async function goLive() {
    setBusy(true);
    const wantObs = !!($('vrsh-obs-enable') && $('vrsh-obs-enable').checked);

    // Manual RTMP destination. Read live from the form if the panel is open,
    // else from saved config. When present, Vortex pushes it into OBS.
    const rtmpEnabled = ($('vrsh-rtmp-enable') ? $('vrsh-rtmp-enable').checked : (cfg && cfg.rtmp && cfg.rtmp.enabled));
    const rtmpUrl = (($('vrsh-rtmp-url') && $('vrsh-rtmp-url').value.trim()) || (cfg && cfg.rtmp && cfg.rtmp.url) || '');
    const rtmpKey = (($('vrsh-rtmp-key') && $('vrsh-rtmp-key').value.trim()) || (cfg && cfg.rtmp && cfg.rtmp.key) || '');
    const manualIngest = (rtmpEnabled && rtmpUrl && rtmpKey) ? { server: rtmpUrl, key: rtmpKey } : null;
    try {
        // 1) Get an initial GPS fix first so the title, marker and announcement
        //    all carry the current location.
        await new Promise((resolve) => {
            if (!navigator.geolocation) return resolve();
            navigator.geolocation.getCurrentPosition(async (p) => { await onPosition(p); resolve(); }, () => resolve(),
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 });
        });

        // 2) Connect + start OBS. If we have a manual RTMP ingest, point OBS at
        //    it first.
        if (wantObs) {
            obsWasUsed = true;
            obs = new OBSClient();
            obs.onStatus((s) => setObsStatus(s));
            obs.on('StreamStateChanged', (d) => { if (d && d.outputActive === false && live) toast('OBS stopped streaming.', 'warn'); });
            const obsPass = ($('vrsh-obs-pass') && $('vrsh-obs-pass').value) || (cfg.obs && cfg.obs.password) || undefined;
            await obs.connect(cfg.obs.host, cfg.obs.port, obsPass);
            if (manualIngest) {
                await obs.setStreamService(manualIngest.server, manualIngest.key);
                toast('OBS pointed at your RTMP destination.', 'ok');
            }
            if (!(await obs.isStreaming())) await obs.startStream();
        } else if (manualIngest) {
            toast('Turn on "Control OBS" so Vortex can push your RTMP key into OBS.', 'warn');
        }

        live = true;
        startGpsWatch();
        setLiveUI(true);
        showBadge(true);
        await pushOverlay();
        await pingLive();

        // 3) Announce to auto-post destinations (Discord gets the stream link).
        try {
            const r = await api('POST', '/announce', { title: buildTitle(), url: currentStreamUrl(), place: place.label });
            reportAnnounce(r.results || {});
        } catch (e) { toast('Announce failed: ' + e.message, 'warn'); }

        // 4) Keep pushing our position.
        clearInterval(livePingTimer);
        livePingTimer = setInterval(pingLive, LIVE_PING_MS);

        toast('You are LIVE 🔴', 'ok');
    } catch (e) {
        toast('Could not go live: ' + e.message, 'error');
        await stopLive(true); // roll back partial state
    } finally {
        setBusy(false);
    }
}

async function stopLive(silent) {
    setBusy(true);
    live = false;
    clearInterval(livePingTimer); livePingTimer = null;
    stopGpsWatch();
    removeMyMarker();
    showBadge(false);
    setLiveUI(false);
    try { await api('POST', '/offline'); } catch {}
    // Actually stop OBS — reconnecting to it if this session's live connection
    // was already gone (e.g. after a refresh), so "End stream" reliably works.
    try { await stopObsStream(); } catch (e) {}
    if (!silent) toast('Stream stopped.', 'info');
    setBusy(false);
}

// Tell OBS to stop streaming. Uses the live connection if we still have it,
// otherwise briefly reconnects with the saved OBS settings just to stop it.
async function stopObsStream() {
    if (obs && obs.connected) {
        try { if (await obs.isStreaming()) await obs.stopStream(); } catch {}
        try { obs.disconnect(); } catch {}
        obs = null;
        setObsStatus('disconnected');
        return;
    }
    const host = cfg && cfg.obs && cfg.obs.host;
    if (!obsWasUsed || !host) return; // OBS wasn't part of this stream
    const pass = ($('vrsh-obs-pass') && $('vrsh-obs-pass').value) || (cfg.obs && cfg.obs.password) || undefined;
    const tmp = new OBSClient();
    try {
        await tmp.connect(host, cfg.obs.port, pass);
        if (await tmp.isStreaming()) await tmp.stopStream();
    } catch (e) { /* OBS unreachable — nothing we can stop */ }
    finally { try { tmp.disconnect(); } catch {} obs = null; setObsStatus('disconnected'); }
}

function reportAnnounce(results) {
    const map = {
        discord: { posted: 'Posted to Discord ✓', 'no-webhook': 'Discord on, but no webhook saved', error: 'Discord post failed' },
    };
    if (results.discord) toast((map.discord[results.discord]) || ('Discord: ' + results.discord), results.discord === 'posted' ? 'ok' : 'warn');
    if (results.facebook === 'not-connected') toast('Facebook not connected yet — connect it in the Hub.', 'warn');
}

// ─── UI: badge, panel, status ─────────────────────────────────────────────────
function showBadge(on) {
    let b = $('vrsh-live-badge');
    if (on) {
        if (!b) {
            b = document.createElement('div');
            b.id = 'vrsh-live-badge';
            b.innerHTML = '<span class="vr-live-pulse"></span>LIVE';
            b.onclick = openPanel;
            document.body.appendChild(b);
        }
        b.style.display = 'flex';
    } else if (b) { b.style.display = 'none'; }
}

function setObsStatus(s) {
    const el = $('vrsh-obs-status');
    if (!el) return;
    const map = { connecting: ['Connecting…', '#facc15'], connected: ['Connected', '#34d399'], disconnected: ['Disconnected', '#94a3b8'], error: ['Error', '#f87171'] };
    const [txt, col] = map[s] || ['—', '#94a3b8'];
    el.textContent = txt; el.style.color = col;
}
function updateLocationUI() {
    if ($('vrsh-loc')) $('vrsh-loc').textContent = place.label || 'Waiting for GPS…';
    if ($('vrsh-title-preview')) $('vrsh-title-preview').textContent = buildTitle();
}
function setBusy(b) {
    const btn = $('vrsh-golive');
    if (btn) { btn.disabled = b; btn.style.opacity = b ? 0.6 : 1; }
}
function setLiveUI(on) {
    const btn = $('vrsh-golive');
    if (btn) { btn.textContent = on ? '■  Stop stream' : '●  Go Live'; btn.classList.toggle('vrsh-golive-active', on); }
    const dot = $('vrsh-live-dot'); if (dot) dot.style.display = on ? 'inline-block' : 'none';
}

function launchButton() {
    if ($('vrsh-launch')) return;
    const btn = document.createElement('button');
    btn.id = 'vrsh-launch';
    btn.title = 'Chase Stream Hub';
    btn.innerHTML = '<i class="fa fa-video"></i>';
    btn.onclick = openPanel;
    document.body.appendChild(btn);
}

function openPanel() {
    let p = $('vrsh-panel');
    if (p) { p.style.display = 'flex'; syncForm(); updateLocationUI(); startOperatorView(); return; }
    p = document.createElement('div');
    p.id = 'vrsh-panel';
    p.innerHTML = panelHTML();
    document.body.appendChild(p);

    const closePanel = () => { p.style.display = 'none'; clearInterval(agentsPollTimer); };
    $('vrsh-close').onclick = closePanel;
    $('vrsh-golive').onclick = () => { live ? stopLive() : goLive(); };
    $('vrsh-save').onclick = saveConfig;
    $('vrsh-agents-refresh').onclick = refreshAgents;
    $('vrsh-remote-enable').onchange = async () => {
        const on = $('vrsh-remote-enable').checked;
        cfg.remoteControl = on;
        try { await api('POST', '/config', { remoteControl: on }); } catch {}
        if (on) startAgent(); else stopAgent();
        toast(on ? 'Remote control enabled — keep this tab open.' : 'Remote control disabled.', 'info');
    };
    p.addEventListener('click', (e) => { if (e.target === p) closePanel(); });
    syncForm();
    updateLocationUI();
    startOperatorView();
}

// Show + poll the operator dashboard while the panel is open (admins only).
function startOperatorView() {
    if (!isAdmin || !$('vrsh-operator')) return;
    $('vrsh-operator').style.display = '';
    refreshAgents();
    clearInterval(agentsPollTimer);
    agentsPollTimer = setInterval(() => {
        const p = $('vrsh-panel');
        if (p && p.style.display !== 'none') refreshAgents(); else clearInterval(agentsPollTimer);
    }, 6000);
}

function panelHTML() {
    return `
    <div class="vrsh-card">
      <div class="vrsh-head">
        <div class="vrsh-title"><span id="vrsh-live-dot" class="vr-live-pulse" style="display:none"></span> Chase Stream Hub</div>
        <button id="vrsh-close" class="vrsh-x">×</button>
      </div>

      <div class="vrsh-live-row">
        <button id="vrsh-golive" class="vrsh-golive">●  Go Live</button>
        <div class="vrsh-loc-box">
          <div class="vrsh-loc-label">Location</div>
          <div id="vrsh-loc" class="vrsh-loc">Waiting for GPS…</div>
        </div>
      </div>

      <div class="vrsh-field">
        <label>Stream link (shown in the announcement)</label>
        <input id="vrsh-stream-url" type="url" placeholder="https://… link to your live stream" />
      </div>

      <div class="vrsh-field">
        <label>Auto title</label>
        <input id="vrsh-title" type="text" placeholder="🔴 LIVE — chasing near {place} — {time}" />
        <div class="vrsh-hint">Placeholders: {place} {town} {county} {state} {time} {date}</div>
        <div class="vrsh-preview">Preview: <span id="vrsh-title-preview">—</span></div>
      </div>

      <div class="vrsh-section">OBS (field laptop)</div>
      <label class="vrsh-check"><input id="vrsh-obs-enable" type="checkbox" /> Control OBS when I go live <span id="vrsh-obs-status" class="vrsh-status">—</span></label>
      <div class="vrsh-grid">
        <div class="vrsh-field"><label>OBS host / IP</label><input id="vrsh-obs-host" type="text" placeholder="localhost" /></div>
        <div class="vrsh-field"><label>Port</label><input id="vrsh-obs-port" type="number" placeholder="4455" /></div>
      </div>
      <div class="vrsh-grid">
        <div class="vrsh-field"><label>OBS password</label><input id="vrsh-obs-pass" type="password" placeholder="(leave blank to keep saved)" /></div>
        <div class="vrsh-field"><label>Overlay text source (optional)</label><input id="vrsh-obs-overlay" type="text" placeholder="e.g. LiveTitle" /></div>
      </div>
      <div class="vrsh-hint">In OBS: Tools ▸ WebSocket Server Settings ▸ enable. Add a Text source and put its name above to show the live title on your stream.</div>

      <div class="vrsh-section">Stream key (RTMP)</div>
      <label class="vrsh-check"><input id="vrsh-rtmp-enable" type="checkbox" /> Push my own RTMP URL + key into OBS when I go live</label>
      <div class="vrsh-grid">
        <div class="vrsh-field"><label>RTMP URL</label><input id="vrsh-rtmp-url" type="text" placeholder="rtmp://your-server/app" /></div>
        <div class="vrsh-field"><label>Stream key</label><input id="vrsh-rtmp-key" type="password" placeholder="paste your stream key" /></div>
      </div>
      <div class="vrsh-hint">Vortex sets these in OBS for you at Go Live — no need to paste them into OBS yourself. Requires <b>Control OBS</b> above to be on. Tip: reset this key with your streaming provider if it has ever been shared.</div>

      <div class="vrsh-section">Auto-post</div>
      <label class="vrsh-check"><input id="vrsh-ap-discord" type="checkbox" /> Discord <span id="vrsh-discord-state" class="vrsh-status">—</span></label>
      <div class="vrsh-field"><label>Discord webhook URL</label><input id="vrsh-discord" type="url" placeholder="https://discord.com/api/webhooks/… (leave blank to keep saved)" /></div>
      <label class="vrsh-check"><input id="vrsh-ap-facebook" type="checkbox" /> Facebook Live <span class="vrsh-status vrsh-soon">connect account (coming soon)</span></label>

      <div class="vrsh-section">Remote control</div>
      <label class="vrsh-check"><input id="vrsh-remote-enable" type="checkbox" /> Allow my team (operators) to start/stop my OBS remotely</label>
      <div class="vrsh-hint">Keep this tab open on your streaming PC with OBS running and <b>Control OBS</b> configured above. Operators can then run your stream from their dashboard — over the internet, no router setup.</div>

      <div id="vrsh-operator" style="display:none">
        <div class="vrsh-section">Operator — team OBS control</div>
        <div id="vrsh-agents"><div class="vrsh-hint">Loading…</div></div>
        <div class="vrsh-actions" style="margin-top:8px"><button id="vrsh-agents-refresh" class="vrsh-mini">Refresh</button></div>
      </div>

      <div class="vrsh-actions">
        <button id="vrsh-save" class="vrsh-save">Save settings</button>
      </div>
    </div>`;
}

function syncForm() {
    if (!cfg) return;
    const set = (id, v) => { const el = $(id); if (el != null) el.value = v; };
    const chk = (id, v) => { const el = $(id); if (el != null) el.checked = !!v; };
    set('vrsh-title', cfg.titleTemplate || '');
    set('vrsh-obs-host', cfg.obs.host || 'localhost');
    set('vrsh-obs-port', cfg.obs.port || 4455);
    set('vrsh-obs-overlay', cfg.obs.overlaySource || '');
    set('vrsh-obs-pass', cfg.obs.password || '');
    set('vrsh-rtmp-url', (cfg.rtmp && cfg.rtmp.url) || '');
    set('vrsh-rtmp-key', (cfg.rtmp && cfg.rtmp.key) || '');
    chk('vrsh-rtmp-enable', cfg.rtmp && cfg.rtmp.enabled);
    $('vrsh-obs-pass').placeholder = cfg.obs.hasPassword ? '•••••• (saved — blank keeps it)' : '(none)';
    $('vrsh-discord').placeholder = cfg.discordConfigured ? 'saved — blank keeps it' : 'https://discord.com/api/webhooks/…';
    chk('vrsh-remote-enable', cfg.remoteControl);
    chk('vrsh-ap-discord', cfg.autoPost.discord);
    chk('vrsh-ap-facebook', cfg.autoPost.facebook);
    const ds = $('vrsh-discord-state'); if (ds) { ds.textContent = cfg.discordConfigured ? 'webhook saved' : 'no webhook yet'; ds.style.color = cfg.discordConfigured ? '#34d399' : '#94a3b8'; }
    // live title preview reacts to typing
    $('vrsh-title').oninput = () => { cfg.titleTemplate = $('vrsh-title').value; updateLocationUI(); };
}

async function saveConfig() {
    const body = {
        titleTemplate: $('vrsh-title').value,
        remoteControl: $('vrsh-remote-enable') ? $('vrsh-remote-enable').checked : false,
        rtmp: {
            enabled: $('vrsh-rtmp-enable') ? $('vrsh-rtmp-enable').checked : false,
            url: $('vrsh-rtmp-url') ? $('vrsh-rtmp-url').value.trim() : '',
            key: $('vrsh-rtmp-key') ? $('vrsh-rtmp-key').value.trim() : '',
        },
        obs: {
            host: $('vrsh-obs-host').value.trim() || 'localhost',
            port: parseInt($('vrsh-obs-port').value, 10) || 4455,
            overlaySource: $('vrsh-obs-overlay').value.trim(),
        },
        autoPost: {
            discord: $('vrsh-ap-discord').checked,
            facebook: $('vrsh-ap-facebook').checked,
        },
    };
    if ($('vrsh-obs-pass').value) body.obs.password = $('vrsh-obs-pass').value;
    if ($('vrsh-discord').value.trim()) body.discordWebhook = $('vrsh-discord').value.trim();
    try {
        const r = await api('POST', '/config', body);
        cfg = r.config;
        $('vrsh-obs-pass').value = '';
        $('vrsh-discord').value = '';
        syncForm();
        toast('Settings saved.', 'ok');
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

// ─── Chaser agent: lets operators control THIS PC's OBS over the internet ─────
// When "allow remote control" is on, this browser holds an SSE link to the
// server and a persistent connection to the local OBS, and runs the commands
// operators send. The browser dials out, so no port-forwarding is needed.
async function ensureAgentObs() {
    if (agentObs && agentObs.connected) return agentObs;
    agentObs = new OBSClient();
    agentObs.onStatus((s) => { if (s === 'disconnected') reportAgentStatus(); });
    const pass = (cfg && cfg.obs && cfg.obs.password) || undefined;
    await agentObs.connect(cfg.obs.host, cfg.obs.port, pass);
    return agentObs;
}
async function runAgentCommand(cmd) {
    try {
        await ensureAgentObs();
        if (cmd.action === 'start') {
            if (cfg.rtmp && cfg.rtmp.enabled && cfg.rtmp.url && cfg.rtmp.key) {
                await agentObs.setStreamService(cfg.rtmp.url, cfg.rtmp.key);
            }
            if (!(await agentObs.isStreaming())) await agentObs.startStream();
            showBadge(true);
        } else if (cmd.action === 'stop') {
            if (await agentObs.isStreaming()) await agentObs.stopStream();
            showBadge(false);
        } else if (cmd.action === 'title' && cfg.obs && cfg.obs.overlaySource) {
            await agentObs.setOverlayText(cfg.obs.overlaySource, (cmd.args && cmd.args.text) || buildTitle());
        } else if (cmd.action === 'scene' && cmd.args && cmd.args.scene) {
            await agentObs.request('SetCurrentProgramScene', { sceneName: cmd.args.scene });
        }
        toast(`Team control: ${cmd.action}${cmd.by ? ' (by ' + cmd.by + ')' : ''}`, 'info');
        reportAgentStatus();
    } catch (e) { toast('Remote command failed: ' + e.message, 'warn'); reportAgentStatus(); }
}
async function reportAgentStatus() {
    let obsConnected = false, streaming = false;
    try { obsConnected = !!(agentObs && agentObs.connected); if (obsConnected) streaming = await agentObs.isStreaming(); } catch {}
    try { await api('POST', '/agent/status', { obsConnected, streaming, place: place.label, title: buildTitle() }); } catch {}
}
async function startAgent() {
    if (agentSSE) return;
    try { await ensureAgentObs(); } catch (e) { toast('Remote control on, but OBS not reachable yet — check "Control OBS" settings.', 'warn'); }
    agentSSE = new EventSource(API + '/agent'); // same-origin: sends the session cookie
    agentSSE.addEventListener('command', (e) => { try { runAgentCommand(JSON.parse(e.data)); } catch (err) {} });
    agentSSE.addEventListener('hello', () => reportAgentStatus());
    agentSSE.onerror = () => {}; // EventSource auto-reconnects
    clearInterval(agentStatusTimer);
    agentStatusTimer = setInterval(reportAgentStatus, 10000);
}
function stopAgent() {
    if (agentSSE) { try { agentSSE.close(); } catch {} agentSSE = null; }
    clearInterval(agentStatusTimer); agentStatusTimer = null;
    if (agentObs && !live) { try { agentObs.disconnect(); } catch {} agentObs = null; }
}

// ─── Operator dashboard: control connected chasers' OBS (admins only) ─────────
function cssId(id) { return String(id).replace(/[^a-zA-Z0-9_-]/g, ''); }
function agentRowHTML(a) {
    const st = a.status || {};
    const dot = st.streaming ? '#ff3b30' : (st.obsConnected ? '#34d399' : '#94a3b8');
    const label = st.streaming ? 'LIVE' : (st.obsConnected ? 'OBS ready' : 'OBS offline');
    return `<div class="vrsh-agent">
      <div class="vrsh-agent-info">
        <div class="vrsh-agent-name"><span class="vrsh-dot" style="background:${dot}"></span>${a.name || 'chaser'}</div>
        <div class="vrsh-agent-sub">${label}${st.place ? ' · ' + st.place : ''}</div>
      </div>
      <div class="vrsh-agent-btns">
        <button id="vrsh-ag-start-${cssId(a.id)}" class="vrsh-mini">Go Live</button>
        <button id="vrsh-ag-stop-${cssId(a.id)}" class="vrsh-mini vrsh-mini-danger">Stop</button>
      </div>
    </div>`;
}
async function refreshAgents() {
    const box = $('vrsh-agents'); if (!box) return;
    let list = [];
    try { list = (await api('GET', '/agents')).agents || []; }
    catch (e) { box.innerHTML = `<div class="vrsh-hint">Could not load chasers: ${e.message}</div>`; return; }
    if (!list.length) { box.innerHTML = `<div class="vrsh-hint">No chasers connected. Each chaser enables “Allow remote control” in their own Hub.</div>`; return; }
    box.innerHTML = list.map(agentRowHTML).join('');
    list.forEach((a) => {
        const s = $(`vrsh-ag-start-${cssId(a.id)}`); if (s) s.onclick = () => sendAgentCmd(a.id, 'start');
        const t = $(`vrsh-ag-stop-${cssId(a.id)}`); if (t) t.onclick = () => sendAgentCmd(a.id, 'stop');
    });
}
async function sendAgentCmd(targetUserId, action) {
    try {
        await api('POST', '/agent/command', { targetUserId, action });
        toast(`Sent “${action}” to chaser.`, 'ok');
        setTimeout(refreshAgents, 1500);
    } catch (e) { toast('Command failed: ' + e.message, 'error'); }
}

// ─── boot ──────────────────────────────────────────────────────────────────────
async function init() {
    injectStyles();
    try { cfg = (await api('GET', '/config')).config; } catch { cfg = null; }

    // Am I an operator (admin)? Controls whether the operator dashboard shows.
    try {
        const r = await fetch('/auth/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (r.ok) { const d = await r.json(); isAdmin = !!(d.user && d.user.isAdmin); }
    } catch {}

    // If this PC opted into remote control, come up as an agent automatically.
    if (cfg && cfg.remoteControl) startAgent();
    // show other live chasers even when we're not streaming
    const startPolling = () => {
        refreshOtherChasers();
        clearInterval(othersTimer);
        othersTimer = setInterval(refreshOtherChasers, OTHERS_POLL_MS);
    };
    const m = mapObj();
    if (m && m.loaded && m.loaded()) startPolling();
    else if (m && m.on) m.on('load', startPolling);
    else setTimeout(startPolling, 4000);

    // Refresh config state when the user returns to the app, if the Hub panel
    // is open (e.g. after editing settings on another device).
    window.addEventListener('focus', async () => {
        const panel = $('vrsh-panel');
        if (!panel || panel.style.display === 'none') return;
        try { cfg = (await api('GET', '/config')).config; syncForm(); } catch {}
    });

    // best-effort clean stop if the app closes mid-stream
    window.addEventListener('pagehide', () => {
        if (live) { try { navigator.sendBeacon(API + '/offline'); } catch {} }
    });
}

function injectStyles() {
    if ($('vrsh-styles')) return;
    const s = document.createElement('style');
    s.id = 'vrsh-styles';
    s.textContent = `
    #vrsh-launch{position:fixed;right:14px;bottom:150px;width:46px;height:46px;border-radius:50%;
      border:1px solid #27324a;background:#0b1220;color:#27beff;font-size:18px;cursor:pointer;z-index:100040;
      box-shadow:0 6px 18px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
    #vrsh-launch:hover{background:#111a2e;color:#7fdcff}
    #vrsh-live-badge{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100055;display:none;
      align-items:center;gap:7px;background:#ff3b30;color:#fff;font:700 13px 'Onest',system-ui,sans-serif;
      padding:6px 12px;border-radius:20px;cursor:pointer;box-shadow:0 6px 18px rgba(255,59,48,.5)}
    .vr-live-pulse{width:9px;height:9px;border-radius:50%;background:#fff;display:inline-block;
      box-shadow:0 0 0 0 rgba(255,255,255,.7);animation:vrshPulse 1.6s infinite}
    #vrsh-live-badge .vr-live-pulse{background:#fff}
    @keyframes vrshPulse{0%{box-shadow:0 0 0 0 rgba(255,59,48,.7)}70%{box-shadow:0 0 0 10px rgba(255,59,48,0)}100%{box-shadow:0 0 0 0 rgba(255,59,48,0)}}
    .vr-live-marker{position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer}
    .vr-live-marker .vr-live-pulse{background:#ff3b30;width:14px;height:14px;border:2px solid #fff}
    .vr-live-marker-other .vr-live-pulse{background:#ff8c00}
    .vr-live-tag{margin-top:2px;font:700 9px 'Onest',sans-serif;color:#fff;background:#ff3b30;padding:1px 5px;border-radius:6px}
    .vr-live-marker-other .vr-live-tag{background:#ff8c00}
    #vrsh-panel{position:fixed;inset:0;background:rgba(4,8,16,.6);z-index:100050;display:flex;
      align-items:center;justify-content:center;font-family:'Onest',system-ui,sans-serif}
    .vrsh-card{width:min(560px,94vw);max-height:90vh;overflow:auto;background:#0b1220;border:1px solid #1e2a44;
      border-radius:16px;padding:18px 20px;color:#e5edff;box-shadow:0 20px 60px rgba(0,0,0,.6)}
    .vrsh-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
    .vrsh-title{font-weight:800;font-size:18px;display:flex;align-items:center;gap:8px}
    .vrsh-x{background:none;border:none;color:#94a3b8;font-size:26px;line-height:1;cursor:pointer}
    .vrsh-x:hover{color:#fff}
    .vrsh-live-row{display:flex;gap:12px;align-items:stretch;margin-bottom:14px}
    .vrsh-golive{flex:0 0 auto;min-width:150px;border:none;border-radius:12px;background:#ff3b30;color:#fff;
      font-weight:800;font-size:15px;padding:14px 18px;cursor:pointer}
    .vrsh-golive:hover{background:#ff5546}
    .vrsh-golive-active{background:#334155}.vrsh-golive-active:hover{background:#475569}
    .vrsh-loc-box{flex:1;background:#0f1830;border:1px solid #1e2a44;border-radius:12px;padding:8px 12px;display:flex;flex-direction:column;justify-content:center}
    .vrsh-loc-label{font-size:11px;color:#7c8aa5;text-transform:uppercase;letter-spacing:.05em}
    .vrsh-loc{font-size:15px;font-weight:700;margin-top:2px}
    .vrsh-field{margin-bottom:12px;display:flex;flex-direction:column}
    .vrsh-field label{font-size:12px;color:#9db0d0;margin-bottom:4px}
    .vrsh-field input,.vrsh-field select{background:#0f1830;border:1px solid #26324c;border-radius:9px;color:#fff;padding:9px 11px;font-size:14px;font-family:inherit}
    .vrsh-field input:focus,.vrsh-field select:focus{outline:none;border-color:#27beff}
    .vrsh-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .vrsh-section{margin:16px 0 8px;font-weight:800;font-size:13px;color:#7fdcff;text-transform:uppercase;letter-spacing:.06em;border-top:1px solid #1a2540;padding-top:12px}
    .vrsh-check{display:flex;align-items:center;gap:8px;font-size:14px;margin:6px 0}
    .vrsh-hint{font-size:11.5px;color:#7c8aa5;margin-top:5px;line-height:1.4}
    .vrsh-preview{font-size:12px;color:#cbd5e1;margin-top:6px}
    .vrsh-preview span{color:#7fdcff}
    .vrsh-status{font-size:11px;font-weight:600}
    .vrsh-soon{color:#facc15}
    .vrsh-mini{border:1px solid #26324c;background:#0f1830;color:#7fdcff;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
    .vrsh-mini:hover{background:#16223c}
    .vrsh-mini-danger{color:#f7a4a4;border-color:#4a2630}
    .vrsh-mini:disabled{opacity:.5;cursor:default}
    .vrsh-agent{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#0f1830;border:1px solid #1e2a44;border-radius:10px;padding:9px 12px;margin:6px 0}
    .vrsh-agent-name{font-weight:700;font-size:14px;display:flex;align-items:center;gap:7px}
    .vrsh-agent-sub{font-size:11.5px;color:#94a3b8;margin-top:2px}
    .vrsh-agent-btns{display:flex;gap:6px}
    .vrsh-dot{width:9px;height:9px;border-radius:50%;display:inline-block}
    .vrsh-actions{display:flex;justify-content:flex-end;margin-top:16px}
    .vrsh-save{background:#27beff;color:#04121f;border:none;border-radius:10px;font-weight:800;padding:10px 20px;cursor:pointer;font-size:14px}
    .vrsh-save:hover{background:#59cfff}`;
    document.head.appendChild(s);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
