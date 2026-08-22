/*
 * components/scanner_player.js — Global PTT live audio player
 * ────────────────────────────────────────────────────────────────────────────
 * A reusable, embeddable player for the Global PTT live feed served by
 * scanner.js (GET /scanner/stream, GET /scanner/status).
 *
 * Usage:
 *   • Drop <div id="global-ptt-player"></div> (or any element with
 *     [data-global-ptt-player]) anywhere in the app — it auto-mounts.
 *   • Or call window.VortexPTT.mount(element, { channel: 'global-ptt' }).
 *   • A bottom-toolbar button (#vortexScannerBtn) also opens it in a panel.
 *
 * Features: LIVE indicator, play/pause, volume, listener count, connection
 * status, automatic reconnection with backoff, and mobile support.
 */

const API = '/scanner';
const STATUS_POLL_MS = 5000;
const VOL_KEY = 'vortexPttVolume';

function injectStyles() {
  if (document.getElementById('gptt-styles')) return;
  const s = document.createElement('style');
  s.id = 'gptt-styles';
  s.textContent = `
  .gptt{font-family:'Onest',system-ui,sans-serif;background:#0b1220;border:1px solid #1e2a44;
    border-radius:14px;padding:12px 14px;color:#e7eef7;min-width:240px;max-width:420px}
  .gptt-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
  .gptt-name{font-weight:800;font-size:14px;letter-spacing:.02em;color:#eaf2fb;flex:1;min-width:0;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gptt-live{display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:11px;
    letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:20px;
    background:rgba(255,255,255,.06);color:#8ea4bd;border:1px solid rgba(255,255,255,.1)}
  .gptt-live .dot{width:8px;height:8px;border-radius:50%;background:#6b7a8d}
  .gptt-live.on{background:rgba(255,59,48,.16);color:#ff6a60;border-color:rgba(255,59,48,.4)}
  .gptt-live.on .dot{background:#ff3b30;box-shadow:0 0 0 0 rgba(255,59,48,.6);animation:gpttPulse 1.6s infinite}
  @keyframes gpttPulse{0%{box-shadow:0 0 0 0 rgba(255,59,48,.6)}70%{box-shadow:0 0 0 7px rgba(255,59,48,0)}100%{box-shadow:0 0 0 0 rgba(255,59,48,0)}}
  .gptt-controls{display:flex;align-items:center;gap:12px}
  .gptt-play{flex:0 0 auto;width:42px;height:42px;border-radius:50%;border:none;cursor:pointer;
    background:#27beff;color:#04121e;font-size:16px;display:flex;align-items:center;justify-content:center;
    transition:background .12s}
  .gptt-play:hover{background:#4fcbff}
  .gptt-play:disabled{background:#33425f;color:#7c8aa5;cursor:not-allowed}
  .gptt-vol{flex:1;display:flex;align-items:center;gap:7px;color:#8ea4bd;min-width:0}
  .gptt-vol input{flex:1;min-width:40px;accent-color:#27beff}
  .gptt-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;
    font-size:11.5px;color:#8ea4bd}
  .gptt-listeners{display:inline-flex;align-items:center;gap:5px}
  .gptt-status{font-size:11.5px}
  .gptt-status.err{color:#ff8f88}
  /* floating panel wrapper — top-right (where the radar info card used to sit) */
  #gpttPanel{position:fixed;top:12px;right:12px;left:auto;bottom:auto;z-index:100060}
  /* footer button uses the shared .mapFooterMenuItem styling from index.css */
  `;
  document.head.appendChild(s);
}

function icon(kind) {
  // small inline SVGs so no icon font is required
  if (kind === 'play') return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  if (kind === 'pause') return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  if (kind === 'spin') return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg>';
  return '';
}

function mount(target, opts = {}) {
  injectStyles();
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return null;
  if (el._gptt) return el._gptt; // already mounted

  let channel = opts.channel || null;      // null → server default channel
  let wantPlay = false;
  let retry = 0;
  let statusTimer = null;
  let reconnectTimer = null;
  let destroyed = false;

  el.classList.add('gptt-host');
  el.innerHTML = `
    <div class="gptt">
      <div class="gptt-top">
        <span class="gptt-name">${opts.name || 'Global PTT'}</span>
        <span class="gptt-live"><span class="dot"></span><span class="txt">Offline</span></span>
      </div>
      <div class="gptt-controls">
        <button class="gptt-play" type="button" aria-label="Play">${icon('play')}</button>
        <span class="gptt-vol">🔊 <input type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume"></span>
      </div>
      <div class="gptt-meta">
        <span class="gptt-listeners">👥 <b class="n">0</b>&nbsp;listening</span>
        <span class="gptt-status">Idle</span>
      </div>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const liveEl = $('.gptt-live'), liveTxt = $('.gptt-live .txt');
  const playBtn = $('.gptt-play'), volEl = $('.gptt-vol input');
  const listenersEl = $('.gptt-listeners .n'), statusEl = $('.gptt-status');

  const audio = new Audio();
  audio.preload = 'none';
  audio.setAttribute('playsinline', '');   // iOS: don't force fullscreen
  const savedVol = parseFloat(localStorage.getItem(VOL_KEY));
  audio.volume = Number.isFinite(savedVol) ? savedVol : 1;
  volEl.value = audio.volume;

  function setStatus(txt, isErr) { statusEl.textContent = txt; statusEl.classList.toggle('err', !!isErr); }
  function setPlayIcon(kind) { playBtn.innerHTML = icon(kind); }

  function streamUrl() {
    const c = channel ? '/' + encodeURIComponent(channel) : '';
    return `${API}/stream${c}?_=${Date.now()}`;   // cache-bust → fresh connection
  }
  function connect() {
    if (destroyed) return;
    setStatus('Connecting…');
    setPlayIcon('spin');
    audio.src = streamUrl();
    audio.play().then(() => { retry = 0; }).catch(() => { if (wantPlay) scheduleReconnect(); });
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (!wantPlay || destroyed) return;
    const delay = Math.min(1000 * Math.pow(1.7, retry), 15000);
    retry++;
    setStatus(`Reconnecting…`, true);
    reconnectTimer = setTimeout(connect, delay);
  }
  function play() {
    wantPlay = true;
    playBtn.setAttribute('aria-label', 'Pause');
    connect();
  }
  function pause() {
    wantPlay = false;
    clearTimeout(reconnectTimer);
    playBtn.setAttribute('aria-label', 'Play');
    setPlayIcon('play');
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {}  // drop the listener connection
    setStatus('Stopped');
  }

  audio.addEventListener('playing', () => { if (wantPlay) { setPlayIcon('pause'); setStatus('Live'); retry = 0; } });
  audio.addEventListener('waiting', () => { if (wantPlay) setStatus('Buffering…'); });
  audio.addEventListener('stalled', () => { if (wantPlay) scheduleReconnect(); });
  audio.addEventListener('ended', () => { if (wantPlay) scheduleReconnect(); });
  audio.addEventListener('error', () => { if (wantPlay) scheduleReconnect(); });

  playBtn.addEventListener('click', () => { wantPlay ? pause() : play(); });
  volEl.addEventListener('input', () => { audio.volume = parseFloat(volEl.value); localStorage.setItem(VOL_KEY, volEl.value); });

  async function poll() {
    if (destroyed) return;
    try {
      const c = channel ? '/' + encodeURIComponent(channel) : '';
      const r = await fetch(`${API}/status${c}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (r.ok) {
        const d = await r.json();
        if (!channel && d.channel) channel = d.channel;      // lock onto the default channel id
        $('.gptt-name').textContent = d.name || 'Global PTT';
        const online = !!d.online;
        liveEl.classList.toggle('on', online);
        liveTxt.textContent = online ? 'Live' : 'Offline';
        listenersEl.textContent = d.listeners != null ? d.listeners : 0;
        playBtn.disabled = !online && !wantPlay;
        if (!wantPlay) setStatus(online ? 'Ready — press play' : 'Feed offline');
      }
    } catch (e) { /* leave last-known state */ }
    statusTimer = setTimeout(poll, STATUS_POLL_MS);
  }
  poll();

  const controller = {
    el,
    play, pause,
    destroy() {
      destroyed = true;
      clearTimeout(statusTimer); clearTimeout(reconnectTimer);
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {}
      delete el._gptt;
    },
  };
  el._gptt = controller;
  return controller;
}

// ── auto-mount any embedded targets ──────────────────────────────────────────
function autoMount() {
  document.querySelectorAll('#global-ptt-player, [data-global-ptt-player]').forEach((el) => {
    const channel = el.getAttribute('data-channel') || null;
    mount(el, { channel });
  });
}

// ── bottom-toolbar button → floating panel ───────────────────────────────────
let panelCtl = null;
function togglePanel() {
  const existing = document.getElementById('gpttPanel');
  if (existing) { if (panelCtl) panelCtl.destroy(); existing.remove(); panelCtl = null; return; }
  injectStyles();
  const wrap = document.createElement('div');
  wrap.id = 'gpttPanel';
  document.body.appendChild(wrap);
  panelCtl = mount(wrap, {});
}

function init() {
  injectStyles();
  autoMount();
  const btn = document.getElementById('vortexScannerBtn');
  if (btn) btn.addEventListener('click', togglePanel);
  window.VortexPTT = { mount, autoMount, togglePanel };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
