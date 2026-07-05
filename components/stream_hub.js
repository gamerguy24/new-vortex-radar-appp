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
 *   - Auto-posts a go-live announcement to Discord (YouTube/Facebook are wired
 *     for once their accounts are connected — see notes in the panel).
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
let ytBroadcastId = null;      // set when we auto-create a YouTube broadcast
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
    const wantYouTube = !!(cfg && cfg.autoPost && cfg.autoPost.youtube && cfg.youtubeConfigured);

    // Manual RTMP destination (e.g. a persistent YouTube key). Read live from
    // the form if the panel is open, else from saved config. When present it
    // takes priority over the OAuth auto-broadcast.
    const rtmpEnabled = ($('vrsh-rtmp-enable') ? $('vrsh-rtmp-enable').checked : (cfg && cfg.rtmp && cfg.rtmp.enabled));
    const rtmpUrl = (($('vrsh-rtmp-url') && $('vrsh-rtmp-url').value.trim()) || (cfg && cfg.rtmp && cfg.rtmp.url) || '');
    const rtmpKey = (($('vrsh-rtmp-key') && $('vrsh-rtmp-key').value.trim()) || (cfg && cfg.rtmp && cfg.rtmp.key) || '');
    const manualIngest = (rtmpEnabled && rtmpUrl && rtmpKey) ? { server: rtmpUrl, key: rtmpKey } : null;
    const useYouTube = wantYouTube && !manualIngest;
    try {
        // 1) Get an initial GPS fix first so the broadcast title, marker and
        //    announcement all carry the current location.
        await new Promise((resolve) => {
            if (!navigator.geolocation) return resolve();
            navigator.geolocation.getCurrentPosition(async (p) => { await onPosition(p); resolve(); }, () => resolve(),
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 });
        });

        // 2) If YouTube is connected (and no manual key overrides it), create the
        //    broadcast now and grab the RTMP ingest URL + key + watch link.
        let yt = null;
        if (useYouTube) {
            try {
                const privacy = (cfg && cfg.ytPrivacy) || ($('vrsh-yt-privacy') && $('vrsh-yt-privacy').value) || 'unlisted';
                yt = await api('POST', '/youtube/golive', { title: buildTitle(), privacy });
                ytBroadcastId = yt.broadcastId;
                if ($('vrsh-stream-url')) $('vrsh-stream-url').value = yt.watchUrl; // announce this link
                toast('YouTube broadcast created.', 'ok');
            } catch (e) {
                toast('YouTube: ' + e.message, 'error');
                // Non-fatal: fall through so OBS/Discord can still go if the user wants.
            }
        }

        // 3) Connect + start OBS. If we have a YouTube ingest, point OBS at it first.
        if (wantObs) {
            obs = new OBSClient();
            obs.onStatus((s) => setObsStatus(s));
            obs.on('StreamStateChanged', (d) => { if (d && d.outputActive === false && live) toast('OBS stopped streaming.', 'warn'); });
            await obs.connect(cfg.obs.host, cfg.obs.port, ($('vrsh-obs-pass') && $('vrsh-obs-pass').value) || undefined);
            if (manualIngest) {
                await obs.setStreamService(manualIngest.server, manualIngest.key);
                toast('OBS pointed at your RTMP destination.', 'ok');
            } else if (yt && yt.ingestionAddress && yt.streamName) {
                await obs.setStreamService(yt.ingestionAddress, yt.streamName);
            }
            if (!(await obs.isStreaming())) await obs.startStream();
        } else if (manualIngest) {
            toast('Turn on "Control OBS" so Vortex can push your RTMP key into OBS.', 'warn');
        } else if (yt) {
            toast('Broadcast created — point your encoder at the YouTube stream key (OBS control is off).', 'warn');
        }

        live = true;
        startGpsWatch();
        setLiveUI(true);
        showBadge(true);
        await pushOverlay();
        await pingLive();

        // 4) Announce to auto-post destinations (Discord gets the watch link).
        try {
            const r = await api('POST', '/announce', { title: buildTitle(), url: currentStreamUrl(), place: place.label });
            reportAnnounce(r.results || {});
        } catch (e) { toast('Announce failed: ' + e.message, 'warn'); }

        // 5) Keep pushing our position.
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
    if (ytBroadcastId) {
        try { await api('POST', '/youtube/end', { broadcastId: ytBroadcastId }); } catch {}
        ytBroadcastId = null;
    }
    if (obs) {
        try { if (await obs.isStreaming()) await obs.stopStream(); } catch {}
        try { obs.disconnect(); } catch {}
        obs = null;
        setObsStatus('disconnected');
    }
    if (!silent) toast('Stream stopped.', 'info');
    setBusy(false);
}

function reportAnnounce(results) {
    const map = {
        discord: { posted: 'Posted to Discord ✓', 'no-webhook': 'Discord on, but no webhook saved', error: 'Discord post failed' },
    };
    if (results.discord) toast((map.discord[results.discord]) || ('Discord: ' + results.discord), results.discord === 'posted' ? 'ok' : 'warn');
    if (results.youtube === 'not-connected') toast('YouTube not connected yet — connect it in the Hub.', 'warn');
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
    if (p) { p.style.display = 'flex'; syncForm(); updateLocationUI(); return; }
    p = document.createElement('div');
    p.id = 'vrsh-panel';
    p.innerHTML = panelHTML();
    document.body.appendChild(p);

    $('vrsh-close').onclick = () => { p.style.display = 'none'; };
    $('vrsh-golive').onclick = () => { live ? stopLive() : goLive(); };
    $('vrsh-save').onclick = saveConfig;
    $('vrsh-yt-connect').onclick = connectYouTube;
    $('vrsh-yt-disconnect').onclick = disconnectYouTube;
    p.addEventListener('click', (e) => { if (e.target === p) p.style.display = 'none'; });
    syncForm();
    updateLocationUI();
}

function connectYouTube() {
    // Google blocks OAuth inside plain WebViews, so open it in a real browser /
    // Custom Tab (native_adapt turns window.open into a Custom Tab on mobile).
    // When you come back, the panel refreshes its connection state on focus.
    toast('Opening Google sign-in… finish there, then return to the app.', 'info');
    window.open('/api/stream/connect/youtube', '_blank', 'noopener');
}
async function disconnectYouTube() {
    try {
        await api('POST', '/youtube/disconnect');
        cfg = (await api('GET', '/config')).config;
        syncForm();
        toast('YouTube disconnected.', 'info');
    } catch (e) { toast('Could not disconnect: ' + e.message, 'error'); }
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
        <input id="vrsh-stream-url" type="url" placeholder="https://youtube.com/live/… or your channel URL" />
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
        <div class="vrsh-field"><label>RTMP URL</label><input id="vrsh-rtmp-url" type="text" placeholder="rtmp://a.rtmp.youtube.com/live2" /></div>
        <div class="vrsh-field"><label>Stream key</label><input id="vrsh-rtmp-key" type="password" placeholder="paste your stream key" /></div>
      </div>
      <div class="vrsh-hint">Vortex sets these in OBS for you at Go Live — no need to paste them into OBS yourself. Requires <b>Control OBS</b> above to be on. Takes priority over the YouTube auto-broadcast below. Tip: reset this key in YouTube Studio if it has ever been shared.</div>

      <div class="vrsh-section">Auto-post</div>
      <label class="vrsh-check"><input id="vrsh-ap-discord" type="checkbox" /> Discord <span id="vrsh-discord-state" class="vrsh-status">—</span></label>
      <div class="vrsh-field"><label>Discord webhook URL</label><input id="vrsh-discord" type="url" placeholder="https://discord.com/api/webhooks/… (leave blank to keep saved)" /></div>
      <div class="vrsh-yt-row">
        <label class="vrsh-check"><input id="vrsh-ap-youtube" type="checkbox" /> YouTube Live <span id="vrsh-yt-state" class="vrsh-status">—</span></label>
        <button id="vrsh-yt-connect" class="vrsh-mini">Connect</button>
        <button id="vrsh-yt-disconnect" class="vrsh-mini vrsh-mini-danger" style="display:none">Disconnect</button>
      </div>
      <div class="vrsh-hint">Connect creates the broadcast for you and points OBS at YouTube's stream key automatically when you go live. Your channel must be verified &amp; live-enabled.</div>
      <div class="vrsh-field" style="max-width:240px">
        <label>YouTube privacy</label>
        <select id="vrsh-yt-privacy">
          <option value="unlisted">Unlisted (link only)</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </div>
      <label class="vrsh-check"><input id="vrsh-ap-facebook" type="checkbox" /> Facebook Live <span class="vrsh-status vrsh-soon">connect account (coming soon)</span></label>

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
    set('vrsh-yt-privacy', cfg.ytPrivacy || 'unlisted');
    set('vrsh-obs-host', cfg.obs.host || 'localhost');
    set('vrsh-obs-port', cfg.obs.port || 4455);
    set('vrsh-obs-overlay', cfg.obs.overlaySource || '');
    set('vrsh-rtmp-url', (cfg.rtmp && cfg.rtmp.url) || '');
    set('vrsh-rtmp-key', (cfg.rtmp && cfg.rtmp.key) || '');
    chk('vrsh-rtmp-enable', cfg.rtmp && cfg.rtmp.enabled);
    $('vrsh-obs-pass').placeholder = cfg.obs.hasPassword ? '•••••• (saved — blank keeps it)' : '(none)';
    $('vrsh-discord').placeholder = cfg.discordConfigured ? 'saved — blank keeps it' : 'https://discord.com/api/webhooks/…';
    chk('vrsh-ap-discord', cfg.autoPost.discord);
    chk('vrsh-ap-youtube', cfg.autoPost.youtube);
    chk('vrsh-ap-facebook', cfg.autoPost.facebook);
    const ds = $('vrsh-discord-state'); if (ds) { ds.textContent = cfg.discordConfigured ? 'webhook saved' : 'no webhook yet'; ds.style.color = cfg.discordConfigured ? '#34d399' : '#94a3b8'; }
    // YouTube connection state
    const ys = $('vrsh-yt-state');
    if (ys) { ys.textContent = cfg.youtubeConfigured ? 'channel connected ✓' : 'not connected'; ys.style.color = cfg.youtubeConfigured ? '#34d399' : '#94a3b8'; }
    if ($('vrsh-yt-connect')) $('vrsh-yt-connect').style.display = cfg.youtubeConfigured ? 'none' : '';
    if ($('vrsh-yt-disconnect')) $('vrsh-yt-disconnect').style.display = cfg.youtubeConfigured ? '' : 'none';
    const ytChk = $('vrsh-ap-youtube');
    if (ytChk) { ytChk.disabled = !cfg.youtubeConfigured; if (!cfg.youtubeConfigured) ytChk.checked = false; }
    // live title preview reacts to typing
    $('vrsh-title').oninput = () => { cfg.titleTemplate = $('vrsh-title').value; updateLocationUI(); };
}

async function saveConfig() {
    const body = {
        titleTemplate: $('vrsh-title').value,
        ytPrivacy: $('vrsh-yt-privacy') ? $('vrsh-yt-privacy').value : 'unlisted',
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
            youtube: $('vrsh-ap-youtube').checked,
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

// ─── boot ──────────────────────────────────────────────────────────────────────
async function init() {
    injectStyles();
    launchButton();
    try { cfg = (await api('GET', '/config')).config; } catch { cfg = null; }
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

    // When the user returns from the Google OAuth tab/Custom Tab, refresh the
    // connection state if the Hub panel is open.
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
    .vrsh-yt-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0}
    .vrsh-yt-row .vrsh-check{margin:0;flex:1;min-width:180px}
    .vrsh-mini{border:1px solid #26324c;background:#0f1830;color:#7fdcff;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
    .vrsh-mini:hover{background:#16223c}
    .vrsh-mini-danger{color:#f7a4a4;border-color:#4a2630}
    .vrsh-mini:disabled{opacity:.5;cursor:default}
    .vrsh-actions{display:flex;justify-content:flex-end;margin-top:16px}
    .vrsh-save{background:#27beff;color:#04121f;border:none;border-radius:10px;font-weight:800;padding:10px 20px;cursor:pointer;font-size:14px}
    .vrsh-save:hover{background:#59cfff}`;
    document.head.appendChild(s);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
