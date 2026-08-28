/*
 * components/ptt_panel.js
 * VORTEX PTT — the radio panel, mounted inside Vortex Radar.
 *
 * Drop <div id="vortex-ptt"></div> anywhere (or load this module on a page that
 * has one) and the panel mounts itself. On the radar page it floats over the
 * map and can be minimised to a widget; it is the same component either way.
 *
 * HOW THE AUDIO WORKS, AND WHY
 * Voice is WebRTC, peer to peer, in a mesh: every member of a channel holds one
 * RTCPeerConnection with every other member. The server never carries speech —
 * it only relays offers, answers and ICE, and decides who is allowed to talk.
 *
 * JOINING NEVER ASKS FOR THE MICROPHONE. Receiving audio needs no microphone at
 * all, so joining a channel connects you for listening and nothing more. The
 * mic is requested on the FIRST PRESS of the talk button — a call stack that
 * starts at a real click, tap or key press, which is the context browsers
 * actually grant. An earlier version asked while handling the join message,
 * with no gesture anywhere in the stack, and on failure disabled the button
 * permanently; that combination is what "nobody can talk" looked like.
 *
 * Once acquired, the track is added to every peer connection and left DISABLED.
 * Pressing PTT flips `track.enabled = true`. The alternative — adding the track
 * on key-down and removing it on key-up — forces an SDP renegotiation on every
 * single press, which costs a few hundred milliseconds at exactly the moment
 * someone is trying to say something urgent. A disabled track transmits
 * nothing, so nothing leaves the machine until the floor is granted.
 *
 * THE SERVER DECIDES, NOT THIS FILE. Pressing the button sends ptt:request and
 * waits. The microphone is not un-muted until ptt:granted comes back. That is
 * what makes half duplex actually hold: a modified client can flip its own
 * track on, but no one else's connection will be listening for it, and the
 * server will have told everyone somebody else holds the floor.
 */

const WS_PATH = '/ptt/socket';

// Public STUN only. A TURN relay would be needed for the minority of networks
// that block peer-to-peer entirely (some cellular CGNAT, strict corporate
// firewalls); adding one means running or buying a relay, which this build is
// explicitly not doing. Those users will connect to some peers and not others,
// and the connection indicator will show it rather than failing silently.
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class VortexPTT {
  constructor(root) {
    this.root = root;
    this.ws = null;
    this.connId = null;
    this.me = null;
    this.channels = [];
    this.channel = null;
    this.users = [];
    this.caps = {};
    this.transmitting = null;       // who currently holds the floor
    this.iHaveFloor = false;
    this.pressed = false;           // is the button physically held?
    this.peers = new Map();         // connId -> { pc, stream }
    this.micStream = null;
    this.micTrack = null;
    this.keepalive = null;
    this.reconnectDelay = 1000;
    this.pttKey = localStorage.getItem('vortexPttKey') || ' ';
    this.outputVolume = Number(localStorage.getItem('vortexPttVolume') || 1);
    this.audioEls = new Map();

    this.buildUI();
    // On the radar page the panel starts as a small widget so it never covers
    // the map uninvited; the standalone /ptt page omits this and opens fully.
    if (root.hasAttribute('data-start-collapsed')) {
      root.classList.add('vptt-collapsed');
      this.ui.min.textContent = '+';
    }
    this.connect();
    this.installKeys();
  }

  /* ── UI ───────────────────────────────────────────────────────────────── */

  buildUI() {
    this.root.classList.add('vptt');
    this.root.innerHTML = `
      <div class="vptt-head">
        <span class="vptt-dot" data-role="dot"></span>
        <span class="vptt-title">VORTEX <b>PTT</b></span>
        <span class="vptt-quality" data-role="quality"></span>
        <button class="vptt-min" data-role="min" title="Show or hide the radio">–</button>
      </div>
      <div class="vptt-body" data-role="body">
        <select class="vptt-channels" data-role="channels"></select>
        <div class="vptt-now" data-role="now">Not connected</div>
        <button class="vptt-talk" data-role="talk" disabled>HOLD TO TALK 🎙️</button>
        <div class="vptt-hint" data-role="hint"></div>
        <div class="vptt-users" data-role="users"></div>
        <div class="vptt-net" data-role="net"></div>
        <details class="vptt-settings">
          <summary>Audio &amp; settings</summary>
          <label>Microphone<select data-role="mics"></select></label>
          <label>Speaker<select data-role="spks"></select></label>
          <label>Volume<input type="range" min="0" max="100" data-role="vol"></label>
          <label>PTT key<input type="text" maxlength="12" data-role="key" readonly></label>
          <label class="vptt-check"><input type="checkbox" data-role="loc"> Share my location on this channel</label>
          <button class="vptt-test" data-role="mictest">Test microphone</button>
          <div class="vptt-meter" data-role="meter"><i></i></div>
        </details>
      </div>`;

    const q = (r) => this.root.querySelector(`[data-role="${r}"]`);
    this.ui = {
      dot: q('dot'), quality: q('quality'), body: q('body'), min: q('min'),
      channels: q('channels'), now: q('now'), talk: q('talk'), hint: q('hint'),
      users: q('users'), net: q('net'), mics: q('mics'), spks: q('spks'), vol: q('vol'),
      key: q('key'), loc: q('loc'), mictest: q('mictest'), meter: q('meter'),
    };

    // The whole header toggles, not just the little button: collapsed, the
    // strip IS the only target, and a control labelled 'minimise' on an
    // already-minimised panel reads as broken.
    const toggle = () => {
      const closed = this.root.classList.toggle('vptt-collapsed');
      this.ui.min.textContent = closed ? '+' : '–';
    };
    this.ui.min.onclick = (e) => { e.stopPropagation(); toggle(); };
    this.root.querySelector('.vptt-head').onclick = toggle;
    this.ui.channels.onchange = () => this.join(this.ui.channels.value);
    this.ui.vol.value = String(Math.round(this.outputVolume * 100));
    this.ui.vol.oninput = () => {
      this.outputVolume = Number(this.ui.vol.value) / 100;
      localStorage.setItem('vortexPttVolume', String(this.outputVolume));
      for (const a of this.audioEls.values()) a.volume = this.outputVolume;
    };
    this.ui.key.value = this.pttKey === ' ' ? 'Space' : this.pttKey;
    this.ui.key.onkeydown = (e) => {
      e.preventDefault();
      this.pttKey = e.key;
      localStorage.setItem('vortexPttKey', e.key);
      this.ui.key.value = e.key === ' ' ? 'Space' : e.key;
      this.ui.key.blur();
    };
    this.ui.loc.onchange = () => this.sendLocation();
    this.ui.mictest.onclick = () => this.testMic();

    // Pointer events cover mouse, pen and touch in one path, and give us
    // capture — so sliding a finger off the button still releases properly
    // rather than leaving the channel keyed open.
    const t = this.ui.talk;
    t.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      t.setPointerCapture(e.pointerId);
      this.press();
    });
    const up = (e) => { try { t.releasePointerCapture(e.pointerId); } catch (err) {} this.release(); };
    t.addEventListener('pointerup', up);
    t.addEventListener('pointercancel', up);
    // Stops the long-press menu / text selection on mobile mid-transmission.
    t.addEventListener('contextmenu', (e) => e.preventDefault());

    this.enumerateDevices();
  }

  installKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || this.pressed) return;
      if (e.key !== this.pttKey) return;
      // Never steal the key while someone is typing.
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || document.activeElement.isContentEditable) return;
      e.preventDefault();
      this.press();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === this.pttKey && this.pressed) { e.preventDefault(); this.release(); }
    });
    // A tab switched away mid-press would otherwise hold the channel open.
    window.addEventListener('blur', () => { if (this.pressed) this.release(); });
  }

  /* ── socket ───────────────────────────────────────────────────────────── */

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try { ws = new WebSocket(`${proto}//${location.host}${WS_PATH}`); } catch (e) { return this.retry(); }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.setDot('ok');
      this.loadChannels();
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      this.onMessage(m);
    };
    ws.onclose = () => {
      this.setDot('down');
      this.ui.now.textContent = 'Reconnecting…';
      // A reconnect must never resume a transmission. Whatever was happening
      // before the drop, we come back listening.
      this.forceRelease('connection lost');
      this.teardownPeers();
      this.retry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  retry() {
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
  }

  send(type, data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type, ...data }));
  }

  async loadChannels() {
    try {
      const r = await fetch('/api/ptt/channels', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      this.channels = j.channels || [];
      this.me = j.you;
      this.ui.channels.innerHTML = '<option value="">— select a channel —</option>'
        + this.channels.map((c) => `<option value="${esc(c.id)}">${esc(c.emoji)} ${esc(c.name)} (${c.users})</option>`).join('');
      const last = localStorage.getItem('vortexPttChannel');
      if (last && this.channels.some((c) => c.id === last)) {
        this.ui.channels.value = last;
        this.join(last);
      } else {
        this.ui.now.textContent = 'Select a channel';
      }
    } catch (e) {
      this.ui.now.textContent = 'Channel list unavailable';
    }
  }

  join(channelId) {
    if (!channelId) return;
    this.teardownPeers();
    const ch = this.channels.find((c) => c.id === channelId);
    let password;
    if (ch && ch.hasPassword) {
      password = window.prompt(`Password for ${ch.name}:`) || '';
    }
    this.send('ptt:join', { channelId, password });
  }

  onMessage(m) {
    switch (m.type) {
      case 'ptt:hello':
        this.connId = m.connId;
        this.me = m.user;
        break;

      case 'ptt:joined':
        this.channel = m.channel;
        this.users = m.users || [];
        this.caps = m.capabilities || {};
        this.transmitting = m.transmitting;
        localStorage.setItem('vortexPttChannel', m.channel.id);
        this.ui.channels.value = m.channel.id;
        this.ui.talk.disabled = !this.caps.speak;
        this.ui.hint.textContent = this.caps.speak
          ? `Hold the button or press ${this.pttKey === ' ' ? 'Space' : this.pttKey}`
          : 'You cannot transmit on this channel';
        this.renderNow();
        this.renderUsers();
        this.renderNet();
        // Connect to peers for LISTENING. Receiving audio needs no microphone,
        // so joining never prompts for one — that happens on the first press.
        for (const p of (m.peers || [])) this.openPeer(p.connId, true);
        this.sendLocation();
        break;

      case 'ptt:presence':
        if (!this.channel || m.channelId !== this.channel.id) break;
        this.users = m.users || [];
        this.transmitting = m.transmitting;
        this.renderNow();
        this.renderUsers();
        this.renderNet();
        break;

      case 'ptt:start':
        this.transmitting = { userId: m.userId, name: m.name, priority: m.priority };
        this.renderNow();
        break;

      case 'ptt:stop':
        // If this is our own transmission ending — released, timed out or
        // pre-empted — make sure the microphone actually goes quiet.
        if (m.userId === (this.me && this.me.id) || m.reason === 'pre-empted') this.forceRelease(m.reason);
        this.transmitting = null;
        this.renderNow();
        break;

      case 'ptt:granted':
        this.iHaveFloor = true;
        // The button may already have been let go while we waited for the
        // answer. If so, stand down immediately rather than opening the mic.
        if (!this.pressed) { this.send('ptt:stop'); this.iHaveFloor = false; break; }
        this.setMic(true);
        this.root.classList.add('vptt-tx');
        this.ui.hint.textContent = m.priority ? 'PRIORITY — transmitting' : 'Transmitting…';
        clearInterval(this.keepalive);
        this.keepalive = setInterval(() => this.send('ptt:keepalive'), 2000);
        break;

      case 'ptt:busy':
        this.ui.hint.textContent = `Channel busy — ${m.holder ? m.holder.name : 'someone'} is transmitting`;
        this.buzz();
        break;

      case 'ptt:denied':
        this.ui.hint.textContent = m.reason || 'Denied';
        this.buzz();
        break;

      case 'ptt:kicked':
        this.ui.now.textContent = m.reason || 'Removed from channel';
        this.teardownPeers();
        this.channel = null;
        break;

      case 'ptt:peer-left':
        this.closePeer(m.connId);
        break;

      case 'webrtc:offer': return this.onOffer(m);
      case 'webrtc:answer': return this.onAnswer(m);
      case 'webrtc:ice': return this.onIce(m);
      default: break;
    }
  }

  /* ── PTT ──────────────────────────────────────────────────────────────── */

  press() {
    if (this.pressed) return;
    if (!this.channel) { this.ui.hint.textContent = 'Join a channel first'; this.buzz(); return; }
    if (!this.caps.speak) { this.buzz(); return; }

    this.pressed = true;
    this.root.classList.add('vptt-pressed');
    this.ui.hint.classList.remove('vptt-err');

    // First press also acquires the microphone — this call stack starts at a
    // real click/tap/keypress, which is the context browsers grant it in.
    if (!this.micTrack || this.micTrack.readyState !== 'live') {
      this.ui.hint.textContent = 'Starting microphone…';
      this.ensureMic().then((ok) => {
        // They may have let go while the permission prompt was up. Do not key
        // the radio open behind them.
        if (!ok || !this.pressed) { if (!ok) this.release(); return; }
        this.send('ptt:request', {});
      });
      return;
    }

    // Ask. Do not un-mute yet — the server decides who holds the floor.
    this.send('ptt:request', {});
  }

  release() {
    if (!this.pressed) return;
    this.pressed = false;
    this.root.classList.remove('vptt-pressed');
    if (this.iHaveFloor) this.send('ptt:stop');
    this.forceRelease('released');
  }

  /** Stop transmitting no matter how we got here. */
  forceRelease(why) {
    this.iHaveFloor = false;
    this.pressed = false;
    clearInterval(this.keepalive);
    this.setMic(false);
    this.root.classList.remove('vptt-tx', 'vptt-pressed');
    if (why && why !== 'released') this.ui.hint.textContent = `Transmission ended (${why})`;
    else if (this.channel) this.ui.hint.textContent = 'Listening';
  }

  setMic(on) {
    if (this.micTrack) this.micTrack.enabled = !!on;
  }

  buzz() {
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
    this.root.classList.add('vptt-nope');
    setTimeout(() => this.root.classList.remove('vptt-nope'), 350);
  }

  /* ── audio + WebRTC ───────────────────────────────────────────────────── */

  /*
   * Acquire the microphone.
   *
   * CALLED FROM A USER GESTURE, DELIBERATELY. The first version asked for the
   * mic while handling the ptt:joined WebSocket message — no click, no tap, no
   * key press anywhere in the call stack. Browsers treat that far more harshly
   * than a request made from a real gesture, and when it failed the panel set
   * talk.disabled = true and there was no way back without reloading the page.
   * That is what "nobody can talk" looked like.
   *
   * Now: joining gets you listening (receiving needs no microphone at all), and
   * the mic is requested the first time you actually press the button.
   */
  async ensureMic({ silent } = {}) {
    if (this.micTrack && this.micTrack.readyState === 'live') return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.micError('This browser cannot capture audio.', 'insecure');
      return false;
    }

    const savedId = localStorage.getItem('vortexPttMic');
    /*
     * deviceId is a PREFERENCE, never `exact`.
     *
     * Chrome's device ids are origin-scoped and rotate whenever site data is
     * cleared, so a saved one goes stale routinely. With `exact` that is a hard
     * failure; as a plain value it is an "ideal" hint the browser silently
     * ignores when the device is gone. There is no upside to `exact` here — we
     * would rather have the default microphone than no microphone.
     */
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: savedId ? { ...base, deviceId: savedId } : base,
      });
    } catch (e) {
      // Retry bare, whatever went wrong. Processing constraints and device
      // hints are both things a browser or a virtual audio driver can refuse,
      // and a plain { audio: true } is the request most likely to be honoured.
      // Only if THAT fails is it a real permission or hardware problem.
      try {
        if (savedId) localStorage.removeItem('vortexPttMic');
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.warn('[PTT] microphone opened only after dropping constraints:', e.name);
      } catch (e2) {
        return this.micFailed(e2, silent);
      }
    }

    this.micTrack = this.micStream.getAudioTracks()[0];
    // Captured, but silent until the server grants the floor.
    this.micTrack.enabled = false;
    this.micTrack.onended = () => { this.micTrack = null; this.micStream = null; };
    this.enumerateDevices();

    // Drop the new track into the audio channel every peer connection already
    // has. No renegotiation, no teardown — the m-line was negotiated when the
    // connection was built.
    await this.attachMicToPeers();
    this.ui.hint.textContent = 'Ready — hold to talk';
    return true;
  }

  /** Running inside the Capacitor shell rather than a browser tab? */
  isNativeApp() {
    const C = typeof window !== 'undefined' && window.Capacitor;
    if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) return true;
    // The APK wraps this same site, so if Capacitor has not injected yet, fall
    // back to the user agent Android WebViews advertise.
    return / wv\)|; wv;/.test(navigator.userAgent || '');
  }

  /**
   * Any INSTALLED build — Android shell, packaged Windows app, or an installed
   * PWA — as opposed to an ordinary browser tab.
   *
   * These all wrap this same site, and all of them sit behind a package-level
   * permission the page cannot request for itself. The distinction matters
   * because the advice for each case is completely different, and the advice
   * for a browser tab is useless in an app.
   */
  isPackagedApp() {
    if (this.isNativeApp()) return true;
    try {
      // Installed PWA / MSIX-wrapped web app: launched from the Start menu, not
      // rendered in a tab.
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
      if (navigator.standalone) return true;                    // iOS home-screen
      if (window.Windows || window.MSApp) return true;          // WinRT is present in MSIX
    } catch (e) { /* matchMedia can throw in odd embeddings */ }
    return false;
  }

  micFailed(e, silent) {
    /*
     * A native WebView is a different failure from a browser tab, and needs a
     * different answer. Android will not hand a WebView the microphone unless
     * the APK itself declares android.permission.RECORD_AUDIO — that is a
     * native manifest entry, and no amount of JavaScript on this page can grant
     * it. Saying "allow it in your browser settings" to someone in the app
     * sends them looking for a padlock icon that does not exist.
     */
    if (this.isNativeApp() && /NotAllowedError|PermissionDeniedError|NotFoundError|SecurityError/.test(e && e.name)) {
      this.micError(
        'The app has not been granted microphone access. Check Android Settings → Apps → Vortex Radar → Permissions → Microphone. '
        + 'If Microphone is not listed there at all, the APK needs the RECORD_AUDIO permission added and rebuilt — voice will keep working on the website meanwhile.',
        'native:' + (e && e.name),
      );
      return false;
    }

    // Say WHICH failure. "Microphone unavailable" gives nobody anything to act
    // on; these each have a different fix.
    /*
     * If device LABELS are visible, this origin has already been granted
     * microphone permission at some point — enumerateDevices only reveals them
     * after a grant. A NotAllowedError in that state is almost never the site
     * permission; it is the operating system refusing the browser, which no
     * amount of clicking the padlock will fix. Telling someone to re-allow a
     * permission they have already allowed is how a support loop starts.
     */
    const labelsVisible = this.ui.mics && this.ui.mics.options.length
      && [...this.ui.mics.options].some((o) => o.textContent && !/^audioinput$/i.test(o.textContent));

    /*
     * The installed app is a different story from a browser tab. A packaged
     * Windows (MSIX) or Android build only gets the microphone if the PACKAGE
     * declares that capability; if it does not, Windows shows no Microphone
     * toggle under the app's permissions at all — there is literally nothing
     * for the operator to switch on, and every "allow the microphone"
     * instruction is a dead end. Say that plainly instead.
     */
    const blocked = this.isPackagedApp()
      ? 'The installed app was not built with microphone access, so there is no permission to switch on — Windows will not even list one. It needs the microphone capability added to the app package and a rebuild. Until then, use the browser link below: same account, same channel.'
      : labelsVisible
        ? 'The browser has permission, so something above it is blocking. On Windows: Settings → Privacy & security → Microphone, and switch on both "Microphone access" and "Let desktop apps access your microphone". Also close anything holding the mic exclusively (OBS, Discord, Elgato/voice-changer software), then press again.'
        : 'Microphone blocked. Click the padlock in the address bar, allow the microphone, then press again.';

    const why = {
      NotAllowedError: blocked,
      PermissionDeniedError: blocked,
      NotFoundError: 'No microphone found. Plug one in or choose one under Audio & settings.',
      NotReadableError: 'Your microphone is in use by another app. Close it and press again.',
      OverconstrainedError: 'That microphone is unavailable. Pick another under Audio & settings.',
      SecurityError: 'The browser blocked the microphone on this page.',
      AbortError: 'The microphone could not be started. Press again.',
    }[e && e.name] || `Microphone error: ${(e && (e.message || e.name)) || 'unknown'}`;
    this.micError(why, e && e.name);
    return false;
  }

  /**
   * Open the microphone and show a live level meter for a few seconds.
   *
   * Separate from the talk button on purpose. It answers "is my microphone
   * working at all" without involving channels, the floor, or other people —
   * so when nobody can hear you, you can tell which half of the problem you
   * have before anyone starts guessing.
   */
  async testMic() {
    this.ui.mictest.disabled = true;
    this.ui.mictest.textContent = 'Testing…';
    const ok = await this.ensureMic();
    if (!ok) {
      this.ui.mictest.disabled = false;
      this.ui.mictest.textContent = 'Test microphone';
      return;
    }

    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(this.micStream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const bar = this.ui.meter.querySelector('i');
      const started = Date.now();
      let peak = 0;

      const tick = () => {
        an.getByteTimeDomainData(buf);
        let max = 0;
        for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i] - 128));
        const level = Math.min(100, Math.round((max / 128) * 140));
        peak = Math.max(peak, level);
        bar.style.width = level + '%';
        if (Date.now() - started < 6000) requestAnimationFrame(tick);
        else {
          bar.style.width = '0%';
          try { ctx.close(); } catch (e) {}
          this.ui.mictest.disabled = false;
          this.ui.mictest.textContent = 'Test microphone';
          this.ui.hint.classList.toggle('vptt-err', peak < 4);
          this.ui.hint.textContent = peak < 4
            ? 'No sound reached the microphone. Check it is not muted in hardware, and that the right device is selected above.'
            : 'Microphone works. Hold the button to talk.';
        }
      };
      // The meter needs the track live; PTT mute would show a flat line.
      const wasEnabled = this.micTrack.enabled;
      this.micTrack.enabled = true;
      tick();
      setTimeout(() => { this.micTrack.enabled = wasEnabled; }, 6000);
      this.ui.hint.classList.remove('vptt-err');
      this.ui.hint.textContent = 'Say something…';
    } catch (e) {
      this.ui.mictest.disabled = false;
      this.ui.mictest.textContent = 'Test microphone';
      this.micError('Could not measure the microphone: ' + (e.message || e), 'meter');
    }
  }

  micError(text, code) {
    this.ui.hint.textContent = text;
    this.ui.hint.classList.add('vptt-err');
    // NOT disabled. The button stays live so pressing again retries — a denial
    // is usually recoverable, and a dead button is not.
    this.ui.talk.disabled = false;
    console.warn('[PTT] microphone unavailable', code || '', text);
    this.offerBrowserFallback();
  }

  /*
   * An escape hatch to a plain browser tab.
   *
   * The installed Windows and Android builds are shells around this same site,
   * and a shell can only reach the microphone if its own package declares that
   * capability — something no code on this page can grant, and which takes a
   * rebuild of the package to change. Until that happens the operator is stuck
   * with a radio that can only listen.
   *
   * Their default browser has no such restriction, and it is the same account,
   * same channel and the same people. So rather than explaining that, offer the
   * door: one button, and they are talking in a few seconds.
   */
  offerBrowserFallback() {
    if (this.ui.fallback) return;
    const a = document.createElement('a');
    a.className = 'vptt-fallback';
    a.href = '/ptt';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Open the radio in your browser ↗';
    a.title = 'Same account, same channel — a browser tab is not subject to the app’s permissions.';
    this.ui.hint.insertAdjacentElement('afterend', a);
    this.ui.fallback = a;
  }

  /**
   * Put the microphone into every existing peer connection.
   *
   * replaceTrack on an already-negotiated sender does not touch the SDP, so
   * this is instant and cannot collide with an offer arriving at the same
   * moment. An earlier version tore every connection down and re-offered,
   * which worked but risked glare and dropped audio for a beat.
   */
  async attachMicToPeers() {
    if (!this.micTrack) return;
    for (const p of this.peers.values()) {
      try { await p.tx.sender.replaceTrack(this.micTrack); } catch (e) { /* peer went away */ }
    }
  }

  // Kept for callers that only need to listen.
  async startAudio() { return true; }

  peerConn(connId) {
    let p = this.peers.get(connId);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });

    /*
     * ALWAYS negotiate an audio m-line, microphone or not.
     *
     * This is the bug that stopped anyone being heard, on desktop as well as
     * the app. The old code called addTrack ONLY if a microphone already
     * existed — and since joining no longer asks for one, every connection was
     * built by a listener with no track. It then tried to compensate with
     * createOffer({ offerToReceiveAudio: true }), which is the legacy Plan B
     * constraint that modern browsers ignore entirely. The resulting offer
     * carried NO media sections at all, so the peer connection came up healthy
     * and could never carry audio in either direction. Pressing the button
     * un-muted a track that was not part of any connection: green light,
     * silence.
     *
     * A sendrecv transceiver created up front gives every connection a real
     * audio channel from the first offer. When the microphone arrives later,
     * replaceTrack() drops it into that existing channel with NO renegotiation
     * — which is exactly how "unmute" works in any production WebRTC app, and
     * avoids the offer/answer glare a teardown-and-rebuild would invite.
     */
    const tx = pc.addTransceiver('audio', { direction: 'sendrecv' });
    p = { pc, tx };
    this.peers.set(connId, p);

    if (this.micTrack) tx.sender.replaceTrack(this.micTrack).catch(() => {});

    pc.onicecandidate = (e) => {
      if (e.candidate) this.send('webrtc:ice', { to: connId, payload: e.candidate });
    };
    pc.ontrack = (e) => {
      p.remoteTrack = true;        // proof the audio channel really negotiated
      this.playRemote(connId, e.streams[0]);
      this.renderNet();
    };
    pc.onconnectionstatechange = () => {
      if (/failed|closed/.test(pc.connectionState)) this.closePeer(connId);
      this.reportQuality();
    };
    return p;
  }

  async openPeer(connId, initiator) {
    const { pc } = this.peerConn(connId);
    if (!initiator) return;
    try {
      // No offerToReceiveAudio: that constraint is Plan B and is ignored under
      // Unified Plan. The transceiver created in peerConn() is what puts the
      // audio m-line in this offer.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.send('webrtc:offer', { to: connId, payload: offer });
    } catch (e) { /* the other side may still offer us */ }
  }

  async onOffer(m) {
    const { pc } = this.peerConn(m.from);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(m.payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send('webrtc:answer', { to: m.from, payload: answer });
    } catch (e) { /* ignore a malformed offer */ }
  }

  async onAnswer(m) {
    const p = this.peers.get(m.from);
    if (!p) return;
    try { await p.pc.setRemoteDescription(new RTCSessionDescription(m.payload)); } catch (e) {}
  }

  async onIce(m) {
    const p = this.peers.get(m.from);
    if (!p) return;
    try { await p.pc.addIceCandidate(new RTCIceCandidate(m.payload)); } catch (e) {}
  }

  playRemote(connId, stream) {
    let a = this.audioEls.get(connId);
    if (!a) {
      a = new Audio();
      a.autoplay = true;
      a.volume = this.outputVolume;
      this.audioEls.set(connId, a);
      const spk = localStorage.getItem('vortexPttSpeaker');
      if (spk && a.setSinkId) a.setSinkId(spk).catch(() => {});
    }
    a.srcObject = stream;
    a.play().catch(() => { /* autoplay policy — resolves on first interaction */ });
  }

  closePeer(connId) {
    const p = this.peers.get(connId);
    if (p) { try { p.pc.close(); } catch (e) {} this.peers.delete(connId); }
    const a = this.audioEls.get(connId);
    if (a) { a.srcObject = null; this.audioEls.delete(connId); }
  }

  teardownPeers() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  /* ── connection quality ───────────────────────────────────────────────── */

  async reportQuality() {
    const p = [...this.peers.values()][0];
    if (!p) { this.ui.quality.textContent = ''; return; }
    try {
      const stats = await p.pc.getStats();
      let rtt = null, loss = null, jitter = null;
      stats.forEach((s) => {
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime != null) {
          rtt = Math.round(s.currentRoundTripTime * 1000);
        }
        if (s.type === 'inbound-rtp' && s.kind === 'audio') {
          if (s.jitter != null) jitter = Math.round(s.jitter * 1000);
          if (s.packetsLost != null && s.packetsReceived) {
            loss = Math.round((s.packetsLost / (s.packetsLost + s.packetsReceived)) * 100);
          }
        }
      });
      let grade = '🟢', word = 'Excellent';
      if (rtt > 300 || loss > 8) { grade = '🔴'; word = 'Very poor'; }
      else if (rtt > 180 || loss > 4) { grade = '🟠'; word = 'Poor'; }
      else if (rtt > 90 || loss > 1) { grade = '🟡'; word = 'Good'; }
      this.ui.quality.textContent = grade;
      this.renderNet();
      this.ui.quality.title =
        `${word}${rtt != null ? ` · ${rtt}ms` : ''}${loss != null ? ` · ${loss}% loss` : ''}${jitter != null ? ` · ${jitter}ms jitter` : ''}`;
    } catch (e) { /* stats are advisory */ }
  }

  /* ── misc ─────────────────────────────────────────────────────────────── */

  setDot(k) { this.ui.dot.className = 'vptt-dot vptt-' + k; }

  /*
   * Whether the audio path is actually up, rather than merely connected.
   *
   * A peer connection can reach 'connected' with no media negotiated at all —
   * which is exactly the state that made everyone silent while every indicator
   * on the panel looked healthy. This counts peers that have a real inbound
   * audio track, so "connected but mute" becomes visible instead of invisible.
   */
  renderNet() {
    if (!this.ui.net) return;
    const total = this.peers.size;
    if (!total) {
      this.ui.net.textContent = this.channel ? 'No one else connected' : '';
      this.ui.net.classList.remove('vptt-warn');
      return;
    }
    let live = 0;
    for (const p of this.peers.values()) {
      const st = p.pc.connectionState || p.pc.iceConnectionState || '';
      if (p.remoteTrack && /connected|completed/.test(st)) live++;
    }
    const mic = this.micTrack && this.micTrack.readyState === 'live' ? 'mic ready' : 'mic not started';
    this.ui.net.textContent = 'Audio ' + live + '/' + total + ' · ' + mic;
    this.ui.net.classList.toggle('vptt-warn', live < total);
  }

  renderNow() {
    if (!this.channel) { this.ui.now.textContent = 'Select a channel'; return; }
    const t = this.transmitting;
    this.ui.now.innerHTML = t
      ? `<span class="vptt-live">${t.priority ? '🚨 PRIORITY' : '🎙️'} ${esc(t.name)}</span> — TRANSMITTING`
      : `<span class="vptt-idle">${esc(this.channel.emoji)} ${esc(this.channel.name)}</span> — clear`;
  }

  renderUsers() {
    /*
     * Presence is per CONNECTION, and one person can hold several — the app and
     * the website at once, or a phone and a laptop. Listing every connection
     * separately showed "Nathan Bradley" twice and made a two-person channel
     * look like four, which on a radio is actively misleading.
     *
     * Group by user. The strongest state wins, since someone transmitting from
     * one device is transmitting, whatever their other devices are doing.
     */
    const RANK = { TRANSMITTING: 0, LISTENING: 1, IDLE: 2 };
    const byUser = new Map();
    for (const u of this.users) {
      const prev = byUser.get(u.userId);
      if (!prev) byUser.set(u.userId, { ...u, devices: 1 });
      else {
        prev.devices++;
        if (RANK[u.state] < RANK[prev.state]) prev.state = u.state;
      }
    }
    const list = [...byUser.values()].sort((a, b) => RANK[a.state] - RANK[b.state]);

    // Keep the channel's own count honest. The dropdown label is built from the
    // REST list, which is fetched once on connect and then goes stale — it read
    // "(1)" while four people were plainly listed underneath it.
    this.updateChannelCount(list.length);

    this.ui.users.innerHTML = list.map((u) => {
      const icon = u.state === 'TRANSMITTING' ? '🎙️' : (u.state === 'IDLE' ? '🟡' : '🟢');
      const me = this.me && u.userId === this.me.id ? ' <span class="vptt-you">you</span>' : '';
      const dev = u.devices > 1 ? ` <span class="vptt-dev">×${u.devices}</span>` : '';
      return `<div class="vptt-user"><span>${icon} ${esc(u.name)}${me}${dev}</span><span class="vptt-state">${u.state}</span></div>`;
    }).join('') || '<div class="vptt-empty">No one here yet</div>';
  }

  /** Rewrite the live count on the selected channel's <option>. */
  updateChannelCount(n) {
    if (!this.channel) return;
    const opt = [...this.ui.channels.options].find((o) => o.value === this.channel.id);
    if (!opt) return;
    const ch = this.channels.find((c) => c.id === this.channel.id) || this.channel;
    opt.textContent = `${ch.emoji} ${ch.name} (${n})`;
  }

  sendLocation() {
    const share = this.ui.loc.checked;
    if (!share) return this.send('ptt:location', { share: false });
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => this.send('ptt:location', { share: true, lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { this.ui.loc.checked = false; },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async enumerateDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const fill = (sel, kind, key) => {
        const items = list.filter((d) => d.kind === kind);
        if (!items.length) return;
        sel.innerHTML = items.map((d) => `<option value="${esc(d.deviceId)}">${esc(d.label || kind)}</option>`).join('');
        const saved = localStorage.getItem(key);
        if (saved) sel.value = saved;
        sel.onchange = () => {
          localStorage.setItem(key, sel.value);
          if (kind === 'audioinput') {
            // Drop the old capture before asking for the new one, or the previous
            // device stays open and some browsers refuse the second request.
            if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
            this.micStream = null; this.micTrack = null;
            this.ensureMic();
          }
          else for (const a of this.audioEls.values()) if (a.setSinkId) a.setSinkId(sel.value).catch(() => {});
        };
      };
      fill(this.ui.mics, 'audioinput', 'vortexPttMic');
      fill(this.ui.spks, 'audiooutput', 'vortexPttSpeaker');
    } catch (e) { /* labels need permission; harmless */ }
  }
}

let instance = null;
export function mountPttPanel(target) {
  const root = target || document.getElementById('vortex-ptt') || document.querySelector('[data-vortex-ptt]');
  if (!root || instance) return instance;
  instance = new VortexPTT(root);
  setInterval(() => instance.reportQuality(), 5000);
  return instance;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountPttPanel());
  else mountPttPanel();
}

export default mountPttPanel;
