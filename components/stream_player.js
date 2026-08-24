/*
 * components/stream_player.js
 * The in-app stream player: a small, draggable "picture-in-picture" card that
 * floats over the map instead of a full-screen modal, so the radar stays
 * visible and interactive while you watch.
 *
 * It also follows the streamer. When a stream is opened with a `track` source,
 * the player polls that person's live GPS position and pans the map to keep
 * them centered, dropping a labelled marker on them:
 *
 *   { kind: 'spotter', callsign }  → Spotter Network position (/api/spotters/positions)
 *   { kind: 'hub',     id }        → Chase Stream Hub live ping (/api/stream/live)
 *
 * Following turns itself off the moment you pan/zoom the map by hand, and the
 * Follow button turns it back on. Card position/size persist in localStorage.
 *
 * Shared by components/featured_streams.js and components/stream_hub.js.
 * ES module, no bundling.
 */

// Spotter Network app id — same registration used by components/spotters.js.
const SPOTTER_APP_ID = '55f78b6ed31f5';
const SPOTTER_POLL_MS = 60000;   // Spotter Network positions only move every ~2 min
const HUB_POLL_MS = 15000;       // Stream Hub chasers ping every 15 s
const SPOTTER_CACHE_MS = 45000;  // don't refetch the whole position list faster than this
const GEOM_KEY = 'vortexStreamPlayer:geom';
const MIN_W = 260;

let cur = null; // the open player: { el, track, timer, marker, following, ... }

// ─── small helpers ────────────────────────────────────────────────────────────
function mapObj() { return window.vortexMap && window.vortexMap.map; }
function GL() { return window.mapboxgl || window.maplibregl; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// ─── position sources ─────────────────────────────────────────────────────────
let _spotCache = { at: 0, list: null, inflight: null };

async function spotterPositions() {
    const now = Date.now();
    if (_spotCache.list && now - _spotCache.at < SPOTTER_CACHE_MS) return _spotCache.list;
    if (_spotCache.inflight) return _spotCache.inflight;
    _spotCache.inflight = (async () => {
        try {
            const r = await fetch('/api/spotters/positions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: SPOTTER_APP_ID }),
                cache: 'no-store',
                credentials: 'same-origin',
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const d = await r.json();
            _spotCache.list = (d && d.positions) || [];
            _spotCache.at = Date.now();
        } catch (e) {
            console.warn('[stream-player] spotter positions failed:', e);
            if (!_spotCache.list) _spotCache.list = [];
        } finally {
            _spotCache.inflight = null;
        }
        return _spotCache.list;
    })();
    return _spotCache.inflight;
}

// Match a Spotter Network row by numeric spotter id, callsign, ham call, or
// real name — whichever identifier the FEATURED entry was configured with.
function spotterMatches(p, key) {
    if (!key) return false;
    const full = norm(String(p.first || '') + String(p.last || ''));
    return norm(p.id) === key
        || norm(p.spotter_id) === key
        || norm(p.callsign) === key
        || norm(p.ham) === key
        || (!!full && full === key);
}

/**
 * Look up one person's current position.
 * @returns {Promise<{lat:number,lng:number,place:string,at:number}|null>}
 */
export async function trackedPosition(track) {
    if (!track) return null;
    if (track.kind === 'spotter') {
        const key = norm(track.callsign);
        if (!key) return null;
        const list = await spotterPositions();
        const hit = list.find((p) => spotterMatches(p, key));
        if (!hit) return null;
        const lat = parseFloat(hit.lat), lng = parseFloat(hit.lon);
        if (isNaN(lat) || isNaN(lng)) return null;
        let at = 0;
        if (hit.report_at) { const t = Date.parse(hit.report_at); if (!isNaN(t)) at = t; }
        return { lat, lng, place: hit.note || '', at: at || Date.now() };
    }
    if (track.kind === 'hub') {
        try {
            const r = await fetch('/api/stream/live', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
            if (!r.ok) return null;
            const d = await r.json();
            const hit = (d.live || []).find((s) => String(s.id) === String(track.id));
            if (!hit || hit.lat == null || hit.lng == null) return null;
            return { lat: +hit.lat, lng: +hit.lng, place: hit.place || '', at: Date.now() };
        } catch { return null; }
    }
    return null;
}

/** True if this person currently has a findable live position. */
export async function hasLivePosition(track) { return !!(await trackedPosition(track)); }

/**
 * Find the callsign to put in a FEATURED entry's `spotter` field: fuzzy-searches
 * the live Spotter Network roster by callsign, ham call, or name. Meant for the
 * browser console —  VortexStreamPlayer.findSpotter('country boy')
 * @returns {Promise<Array<{callsign:string,name:string,ham:string,lat:number,lon:number}>>}
 */
export async function findSpotter(query) {
    const key = norm(query);
    const list = await spotterPositions();
    const hits = list.filter((p) => {
        const hay = norm(String(p.id || '') + String(p.spotter_id || '') + String(p.callsign || '')
            + String(p.first || '') + String(p.last || '') + String(p.ham || ''));
        return key && hay.includes(key);
    }).map((p) => ({
        id: p.id || p.spotter_id || '',
        callsign: p.callsign || '',
        name: `${p.first || ''} ${p.last || ''}`.trim(),
        ham: p.ham || '',
        lat: parseFloat(p.lat), lon: parseFloat(p.lon),
    }));
    console.table(hits);
    return hits;
}

// Reverse-geocode for the status line (Mapbox token comes from the map lib).
let _geoCache = { lat: 999, lng: 999, label: '' };
async function placeLabel(lat, lng) {
    const moved = Math.abs(lat - _geoCache.lat) > 0.02 || Math.abs(lng - _geoCache.lng) > 0.02;
    if (_geoCache.label && !moved) return _geoCache.label;
    const token = (GL() && GL().accessToken) || '';
    if (!token) return '';
    try {
        const r = await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/' + lng + ',' + lat + '.json'
            + '?types=place,locality,region&limit=3&access_token=' + token);
        if (!r.ok) return _geoCache.label;
        const j = await r.json();
        let town = '', state = '';
        for (const f of (j.features || [])) {
            const t = (f.place_type || [])[0];
            if ((t === 'place' || t === 'locality') && !town) town = f.text;
            else if (t === 'region' && !state) state = (f.properties && f.properties.short_code)
                ? f.properties.short_code.replace(/^US-/, '') : f.text;
        }
        _geoCache = { lat, lng, label: [town, state].filter(Boolean).join(', ') };
    } catch {}
    return _geoCache.label;
}

// ─── embeds ───────────────────────────────────────────────────────────────────
function iframe(src) {
    const f = document.createElement('iframe');
    f.src = src;
    f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'origin');
    return f;
}

function youtubeId(u) {
    if (u.hostname.replace(/^www\./, '') === 'youtu.be') return u.pathname.slice(1).split('/')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(?:live|embed|shorts)\/([\w-]{6,})/);
    return m ? m[1] : '';
}

// A /@handle/live URL carries no video id — pull the current live id out of the
// channel page through the app's proxy (youtube.com is allow-listed there).
async function resolveYouTubeLiveId(url) {
    try {
        const r = await fetch('/api/proxy?url=' + url, { credentials: 'same-origin' });
        if (!r.ok) return '';
        const html = await r.text();
        const m = html.match(/"videoId":"([\w-]{11})"/);
        return m ? m[1] : '';
    } catch { return ''; }
}

/**
 * Build the embed node for a stream URL. Async because a YouTube channel-live
 * link needs one proxy round-trip to find the current video id.
 * @returns {Promise<HTMLElement|null>} null → this URL can't be embedded.
 */
export async function resolveEmbed(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const parent = location.hostname;

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
        let id = youtubeId(u);
        if (!id) id = await resolveYouTubeLiveId(url);
        if (id) return iframe('https://www.youtube.com/embed/' + encodeURIComponent(id) + '?autoplay=1&playsinline=1');
        return null;
    }
    if (host === 'twitch.tv' || host === 'm.twitch.tv') {
        const ch = (u.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
        return ch ? iframe('https://player.twitch.tv/?channel=' + encodeURIComponent(ch)
            + '&parent=' + encodeURIComponent(parent) + '&autoplay=true') : null;
    }
    if (host === 'kick.com') {
        const ch = (u.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
        return ch ? iframe('https://player.kick.com/' + encodeURIComponent(ch) + '?autoplay=true') : null;
    }
    if (/(^|\.)facebook\.com$/.test(host) || host === 'fb.watch') {
        return iframe('https://www.facebook.com/plugins/video.php?href=' + encodeURIComponent(url)
            + '&show_text=false&autoplay=true');
    }
    // TikTok LIVE — TikTok publishes no documented live-embed API and often
    // refuses to be framed. We try the live embed anyway, and the card shows an
    // "Open on TikTok" escape hatch if nothing plays.
    if (/(^|\.)tiktok\.com$/.test(host)) {
        const handle = (u.pathname.match(/@([\w.\-]+)/) || [])[1];
        if (handle && /\/live/i.test(u.pathname)) {
            const f = iframe('https://www.tiktok.com/embed/live/' + encodeURIComponent(handle));
            f.dataset.vspUnverified = '1'; // → show the "nothing playing?" hint
            return f;
        }
        const vid = (u.pathname.match(/\/video\/(\d+)/) || [])[1];
        if (vid) return iframe('https://www.tiktok.com/embed/v2/' + encodeURIComponent(vid));
        return null;
    }
    // Direct HLS / progressive video
    if (/\.m3u8($|\?)/i.test(u.pathname + u.search) || /\.(mp4|webm|mov)($|\?)/i.test(u.pathname + u.search)) {
        const v = document.createElement('video');
        v.controls = true; v.autoplay = true; v.playsInline = true;
        v.style.cssText = 'width:100%;height:100%;background:#000;display:block';
        if (/\.m3u8($|\?)/i.test(u.pathname + u.search) && window.Hls && window.Hls.isSupported && window.Hls.isSupported()) {
            const hls = new window.Hls(); hls.loadSource(url); hls.attachMedia(v);
            v._vspHls = hls;
        } else {
            v.src = url; // Safari/iOS play HLS natively; everything plays mp4/webm
        }
        return v;
    }
    return null; // unknown host — don't frame it, it's probably X-Frame-Options blocked
}

// ─── styles ───────────────────────────────────────────────────────────────────
function injectStyles() {
    if (document.getElementById('vsp-styles')) return;
    const s = document.createElement('style');
    s.id = 'vsp-styles';
    s.textContent = `
    #vsp-mini{position:fixed;z-index:100070;width:360px;background:#0b1220;border:1px solid #1e2a44;
      border-radius:14px;box-shadow:0 22px 60px rgba(0,0,0,.65);font-family:'Onest',system-ui,sans-serif;
      overflow:hidden;touch-action:none}
    #vsp-mini.vsp-dragging{opacity:.94}
    .vsp-head{display:flex;align-items:center;gap:7px;padding:8px 9px 8px 11px;cursor:grab;
      background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,0));border-bottom:1px solid #16213a}
    .vsp-head:active{cursor:grabbing}
    .vsp-dot{width:8px;height:8px;border-radius:50%;background:#ff3b30;flex:0 0 auto;animation:vsp-blink 1.8s ease-in-out infinite}
    @keyframes vsp-blink{0%,100%{opacity:1}50%{opacity:.35}}
    .vsp-name{flex:1;min-width:0;font-size:13px;font-weight:800;color:#eaf1fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .vsp-btn{display:flex;align-items:center;justify-content:center;gap:5px;background:rgba(255,255,255,.07);
      border:1px solid rgba(255,255,255,.10);color:#b7c6da;border-radius:8px;height:26px;min-width:26px;padding:0 7px;
      font-size:11.5px;font-weight:700;cursor:pointer;text-decoration:none;flex:0 0 auto;line-height:1}
    .vsp-btn:hover{background:rgba(255,255,255,.14);color:#fff}
    .vsp-btn svg{width:13px;height:13px;display:block}
    .vsp-btn.on{background:#27beff;border-color:#27beff;color:#04121e}
    .vsp-stage{position:relative;width:100%;aspect-ratio:16/9;background:#000}
    .vsp-stage>iframe,.vsp-stage>video{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
    .vsp-msg{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;
      text-align:center;color:#cbd5e1;font-size:13px;padding:16px}
    .vsp-msg a{background:#27beff;color:#04121e;font-weight:800;text-decoration:none;padding:9px 15px;border-radius:9px}
    .vsp-hint{position:absolute;left:8px;right:8px;bottom:8px;display:flex;align-items:center;gap:8px;
      background:rgba(6,11,22,.92);border:1px solid #24324e;border-radius:9px;padding:7px 9px;color:#cbd5e1;font-size:11.5px}
    .vsp-hint a{color:#27beff;font-weight:700;text-decoration:none;white-space:nowrap}
    .vsp-hint button{margin-left:auto;background:none;border:none;color:#7b8ca3;font-size:15px;cursor:pointer;line-height:1}
    .vsp-foot{display:flex;align-items:center;gap:6px;padding:7px 11px;border-top:1px solid #16213a;
      color:#93a3b8;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .vsp-foot b{color:#cfe0f5;font-weight:700}
    .vsp-grip{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;
      background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,.22) 50%,rgba(255,255,255,.22) 62%,transparent 62%)}
    #vsp-mini.vsp-collapsed .vsp-stage,#vsp-mini.vsp-collapsed .vsp-foot,#vsp-mini.vsp-collapsed .vsp-grip{display:none}
    /* the followed streamer's marker */
    .vsp-track-marker{position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer}
    .vsp-track-ring{width:16px;height:16px;border-radius:50%;background:#ff3b30;border:2px solid #fff;
      box-shadow:0 0 0 0 rgba(255,59,48,.65);animation:vsp-ring 2s infinite}
    @keyframes vsp-ring{0%{box-shadow:0 0 0 0 rgba(255,59,48,.6)}70%{box-shadow:0 0 0 16px rgba(255,59,48,0)}100%{box-shadow:0 0 0 0 rgba(255,59,48,0)}}
    .vsp-track-tag{margin-top:4px;background:rgba(6,11,22,.9);border:1px solid #2a3a58;color:#fff;font-size:10.5px;
      font-weight:800;padding:2px 6px;border-radius:6px;font-family:'Onest',system-ui,sans-serif;white-space:nowrap}
    @media (max-width:640px){#vsp-mini{width:calc(100vw - 16px)!important}}
    `;
    document.head.appendChild(s);
}

const ICON = {
    crosshair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// ─── geometry (drag / resize / persistence) ───────────────────────────────────
function loadGeom() {
    try { return JSON.parse(localStorage.getItem(GEOM_KEY)) || {}; } catch { return {}; }
}
function saveGeom() {
    if (!cur) return;
    const r = cur.el.getBoundingClientRect();
    try {
        localStorage.setItem(GEOM_KEY, JSON.stringify({
            left: Math.round(r.left), top: Math.round(r.top),
            width: Math.round(r.width), collapsed: cur.el.classList.contains('vsp-collapsed'),
        }));
    } catch {}
}
function placeCard(el) {
    const g = loadGeom();
    const mobile = window.innerWidth <= 640;
    const w = mobile ? window.innerWidth - 16 : clamp(g.width || 360, MIN_W, Math.min(900, window.innerWidth - 20));
    el.style.width = w + 'px';
    const h = el.offsetHeight || Math.round(w * 0.5625) + 80;
    const left = (!mobile && g.left != null) ? clamp(g.left, 6, Math.max(6, window.innerWidth - w - 6))
        : Math.max(8, window.innerWidth - w - 14);
    const top = g.top != null ? clamp(g.top, 6, Math.max(6, window.innerHeight - h - 6))
        : Math.max(70, window.innerHeight - h - 90);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    if (g.collapsed) el.classList.add('vsp-collapsed');
}
function clampIntoView() {
    if (!cur) return;
    const el = cur.el, r = el.getBoundingClientRect();
    const w = Math.min(r.width, window.innerWidth - 12);
    el.style.width = w + 'px';
    el.style.left = clamp(r.left, 6, Math.max(6, window.innerWidth - w - 6)) + 'px';
    el.style.top = clamp(r.top, 6, Math.max(6, window.innerHeight - r.height - 6)) + 'px';
}

function wireDrag(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, a')) return;
        on = true;
        const r = el.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        el.classList.add('vsp-dragging');
        try { handle.setPointerCapture(e.pointerId); } catch {}
        e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
        if (!on) return;
        const r = el.getBoundingClientRect();
        el.style.left = clamp(ox + (e.clientX - sx), 6, Math.max(6, window.innerWidth - r.width - 6)) + 'px';
        el.style.top = clamp(oy + (e.clientY - sy), 6, Math.max(6, window.innerHeight - r.height - 6)) + 'px';
    });
    const end = (e) => {
        if (!on) return;
        on = false;
        el.classList.remove('vsp-dragging');
        try { handle.releasePointerCapture(e.pointerId); } catch {}
        saveGeom();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
}

function wireResize(el, grip) {
    let sx = 0, sw = 0, on = false;
    grip.addEventListener('pointerdown', (e) => {
        on = true; sx = e.clientX; sw = el.getBoundingClientRect().width;
        try { grip.setPointerCapture(e.pointerId); } catch {}
        e.preventDefault(); e.stopPropagation();
    });
    grip.addEventListener('pointermove', (e) => {
        if (!on) return;
        const left = el.getBoundingClientRect().left;
        el.style.width = clamp(sw + (e.clientX - sx), MIN_W, Math.min(900, window.innerWidth - left - 8)) + 'px';
    });
    const end = (e) => {
        if (!on) return;
        on = false;
        try { grip.releasePointerCapture(e.pointerId); } catch {}
        clampIntoView(); saveGeom();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
}

// ─── follow ───────────────────────────────────────────────────────────────────
function ensureTrackMarker(lat, lng, name) {
    const m = mapObj(), g = GL();
    if (!m || !g) return;
    if (!cur.marker) {
        const el = document.createElement('div');
        el.className = 'vsp-track-marker';
        el.innerHTML = '<span class="vsp-track-ring"></span><span class="vsp-track-tag">' + esc(name) + '</span>';
        el.title = name + ' — live position';
        el.addEventListener('click', () => setFollow(true));
        cur.marker = new g.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
    } else {
        cur.marker.setLngLat([lng, lat]);
    }
}

function setFollow(on) {
    if (!cur || !cur.track) return;
    cur.following = on;
    const btn = cur.el.querySelector('#vsp-follow');
    if (btn) {
        btn.classList.toggle('on', on);
        btn.title = on ? 'Following this streamer — pan the map to stop' : 'Follow this streamer on the map';
    }
    if (on) {
        if (cur.lastFix) { centerOn(cur.lastFix, !cur.centeredOnce); cur.centeredOnce = true; }
        else tickFollow();
    }
    renderStatus();
}

function centerOn(fix, snapZoom) {
    const m = mapObj();
    if (!m) return;
    cur.suppressAuto = true; // our own move must not read as a user gesture
    m.easeTo({
        center: [fix.lng, fix.lat],
        zoom: snapZoom ? Math.max(m.getZoom(), 9) : m.getZoom(),
        duration: 900,
    });
    clearTimeout(cur.suppressTimer);
    cur.suppressTimer = setTimeout(() => { if (cur) cur.suppressAuto = false; }, 1200);
}

async function tickFollow() {
    if (!cur || !cur.track) return;
    const mine = cur;
    const fix = await trackedPosition(cur.track);
    if (cur !== mine) return; // player was closed/replaced while fetching
    if (!fix) { cur.noFix = true; renderStatus(); return; }
    cur.noFix = false;
    cur.lastFix = fix;
    ensureTrackMarker(fix.lat, fix.lng, cur.name);
    if (cur.following) { centerOn(fix, !cur.centeredOnce); cur.centeredOnce = true; }
    placeLabel(fix.lat, fix.lng).then((label) => {
        if (cur === mine && cur.lastFix === fix) { cur.placeLabel = label || fix.place || ''; renderStatus(); }
    });
    renderStatus();
}

function renderStatus() {
    if (!cur) return;
    const foot = cur.el.querySelector('#vsp-foot');
    if (!foot) return;
    if (!cur.track) { foot.style.display = 'none'; return; }
    if (!cur.lastFix) {
        foot.innerHTML = cur.noFix
            ? '<span>No live position for <b>' + esc(cur.name) + '</b> right now.</span>'
            : '<span>Looking for ' + esc(cur.name) + '’s position…</span>';
        return;
    }
    const mins = Math.max(0, Math.round((Date.now() - cur.lastFix.at) / 60000));
    const when = mins < 1 ? 'just now' : mins + ' min ago';
    foot.innerHTML = '<span>' + (cur.following ? '🎯 Following' : '📍 Tracking')
        + (cur.placeLabel ? ' · <b>' + esc(cur.placeLabel) + '</b>' : '')
        + ' · ' + esc(when)
        + (cur.following ? '' : ' · <a href="#" id="vsp-refollow" style="color:#27beff;text-decoration:none;font-weight:700">follow</a>')
        + '</span>';
    const re = foot.querySelector('#vsp-refollow');
    if (re) re.onclick = (e) => { e.preventDefault(); setFollow(true); };
}

// Any hand-driven map gesture drops follow mode.
function wireUserGestures() {
    const m = mapObj();
    if (!m || !m.on) return;
    const events = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'];
    const handler = (e) => {
        if (!cur || !cur.following || cur.suppressAuto) return;
        if (e && e.originalEvent) setFollow(false);
    };
    events.forEach((ev) => m.on(ev, handler));
    cur.gestureOff = () => events.forEach((ev) => m.off(ev, handler));
}

// ─── open / close ─────────────────────────────────────────────────────────────
/**
 * Open the floating player.
 * @param {{url:string,name?:string,platform?:string,track?:{kind:string,callsign?:string,id?:string}}} opts
 */
export async function openMiniPlayer(opts) {
    const o = opts || {};
    const url = o.url, name = o.name || 'Live stream', platform = o.platform || '', track = o.track || null;
    if (!url) return null;
    injectStyles();
    closeMiniPlayer();

    const el = document.createElement('div');
    el.id = 'vsp-mini';
    el.innerHTML = `
      <div class="vsp-head" id="vsp-head">
        <span class="vsp-dot"></span>
        <span class="vsp-name">${esc(name)}</span>
        ${track ? `<button class="vsp-btn" id="vsp-follow" title="Follow this streamer on the map">${ICON.crosshair}<span>Follow</span></button>` : ''}
        <button class="vsp-btn" id="vsp-collapse" title="Minimise">${ICON.chevron}</button>
        <a class="vsp-btn" id="vsp-ext" href="${esc(url)}" target="_blank" rel="noopener" title="Open on ${esc(platform || 'the site')}">${ICON.ext}</a>
        <button class="vsp-btn" id="vsp-close" title="Close">${ICON.x}</button>
      </div>
      <div class="vsp-stage" id="vsp-stage"><div class="vsp-msg">Loading…</div></div>
      <div class="vsp-foot" id="vsp-foot"></div>
      <div class="vsp-grip" id="vsp-grip"></div>`;
    document.body.appendChild(el);

    cur = {
        el, url, name, platform, track,
        marker: null, timer: null, following: false, centeredOnce: false,
        lastFix: null, placeLabel: '', noFix: false, suppressAuto: false,
        suppressTimer: null, gestureOff: null, onResize: null,
    };
    const mine = cur;

    placeCard(el);
    wireDrag(el, el.querySelector('#vsp-head'));
    wireResize(el, el.querySelector('#vsp-grip'));
    el.querySelector('#vsp-close').onclick = () => closeMiniPlayer();
    const collapseBtn = el.querySelector('#vsp-collapse');
    collapseBtn.onclick = () => {
        const collapsed = el.classList.toggle('vsp-collapsed');
        collapseBtn.style.transform = collapsed ? 'rotate(180deg)' : '';
        collapseBtn.title = collapsed ? 'Restore' : 'Minimise';
        clampIntoView(); saveGeom();
    };
    cur.onResize = clampIntoView;
    window.addEventListener('resize', cur.onResize);

    // video
    const stage = el.querySelector('#vsp-stage');
    const node = await resolveEmbed(url);
    if (cur !== mine) return null; // closed while resolving
    if (node) {
        stage.innerHTML = '';
        stage.appendChild(node);
        if (node.dataset && node.dataset.vspUnverified) showHint(stage, url, platform);
    } else {
        stage.innerHTML = '<div class="vsp-msg">'
            + (String(platform).toLowerCase() === 'youtube'
                ? "This channel isn’t live right now."
                : "This stream can’t play inside the app.")
            + '<a href="' + esc(url) + '" target="_blank" rel="noopener">Open on '
            + esc(platform || 'the site') + ' ↗</a></div>';
    }

    // follow
    if (track) {
        wireUserGestures();
        setFollow(true);
        cur.timer = setInterval(tickFollow, track.kind === 'hub' ? HUB_POLL_MS : SPOTTER_POLL_MS);
    } else {
        renderStatus();
    }
    return cur;
}

// TikTok (and anything else we can't verify) gets a visible escape hatch.
function showHint(stage, url, platform) {
    setTimeout(() => {
        if (!cur || !stage.isConnected) return;
        const hint = document.createElement('div');
        hint.className = 'vsp-hint';
        hint.innerHTML = '<span>Nothing playing?</span>'
            + '<a href="' + esc(url) + '" target="_blank" rel="noopener">Open on '
            + esc(platform || 'TikTok') + ' ↗</a><button title="Dismiss">×</button>';
        hint.querySelector('button').onclick = () => hint.remove();
        stage.appendChild(hint);
    }, 6000);
}

export function closeMiniPlayer() {
    if (!cur) return;
    if (cur.timer) clearInterval(cur.timer);
    if (cur.suppressTimer) clearTimeout(cur.suppressTimer);
    if (cur.gestureOff) { try { cur.gestureOff(); } catch {} }
    if (cur.onResize) window.removeEventListener('resize', cur.onResize);
    if (cur.marker) { try { cur.marker.remove(); } catch {} }
    const v = cur.el.querySelector('video');
    if (v) {
        if (v._vspHls) { try { v._vspHls.destroy(); } catch {} }
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch {}
    }
    saveGeom();
    cur.el.remove();
    cur = null;
}

export function isPlayerOpen() { return !!cur; }

// Non-module callers (marker popups built as HTML strings, console, etc.)
window.VortexStreamPlayer = { open: openMiniPlayer, close: closeMiniPlayer, isOpen: isPlayerOpen, findSpotter };
