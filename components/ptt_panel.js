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
 * The microphone track is added to those connections ONCE, when you join, and
 * left DISABLED. Pressing PTT flips `track.enabled = true`. The alternative —
 * adding the track on key-down and removing it on key-up — forces an SDP
 * renegotiation on every single press, which costs a few hundred milliseconds
 * at exactly the moment someone is trying to say something urgent. A disabled
 * track transmits nothing, so nothing leaves the machine until the floor is
 * granted.
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
    if (root.hasAttribute('data-start-collapsed')) root.classList.add('vptt-collapsed');
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
        <button class="vptt-min" data-role="min" title="Minimise">–</button>
      </div>
      <div class="vptt-body" data-role="body">
        <select class="vptt-channels" data-role="channels"></select>
        <div class="vptt-now" data-role="now">Not connected</div>
        <button class="vptt-talk" data-role="talk" disabled>HOLD TO TALK 🎙️</button>
        <div class="vptt-hint" data-role="hint"></div>
        <div class="vptt-users" data-role="users"></div>
        <details class="vptt-settings">
          <summary>Audio &amp; settings</summary>
          <label>Microphone<select data-role="mics"></select></label>
          <label>Speaker<select data-role="spks"></select></label>
          <label>Volume<input type="range" min="0" max="100" data-role="vol"></label>
          <label>PTT key<input type="text" maxlength="12" data-role="key" readonly></label>
          <label class="vptt-check"><input type="checkbox" data-role="loc"> Share my location on this channel</label>
        </details>
      </div>`;

    const q = (r) => this.root.querySelector(`[data-role="${r}"]`);
    this.ui = {
      dot: q('dot'), quality: q('quality'), body: q('body'), min: q('min'),
      channels: q('channels'), now: q('now'), talk: q('talk'), hint: q('hint'),
      users: q('users'), mics: q('mics'), spks: q('spks'), vol: q('vol'),
      key: q('key'), loc: q('loc'),
    };

    this.ui.min.onclick = () => this.root.classList.toggle('vptt-collapsed');
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
        this.startAudio().then(() => {
          for (const p of (m.peers || [])) this.openPeer(p.connId, true);
        });
        this.sendLocation();
        break;

      case 'ptt:presence':
        if (!this.channel || m.channelId !== this.channel.id) break;
        this.users = m.users || [];
        this.transmitting = m.transmitting;
        this.renderNow();
        this.renderUsers();
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
    if (!this.channel || !this.caps.speak) { this.buzz(); return; }
    this.pressed = true;
    this.root.classList.add('vptt-pressed');
    // Ask. Do not open the microphone yet — the server decides.
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

  async startAudio() {
    if (this.micStream) return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          deviceId: localStorage.getItem('vortexPttMic') || undefined,
        },
      });
      this.micTrack = this.micStream.getAudioTracks()[0];
      // Captured, but silent until the server grants the floor.
      this.micTrack.enabled = false;
      this.enumerateDevices();
    } catch (e) {
      this.ui.hint.textContent = 'Microphone unavailable — you can still listen.';
      this.caps.speak = false;
      this.ui.talk.disabled = true;
    }
  }

  peerConn(connId) {
    let p = this.peers.get(connId);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    p = { pc, pending: [] };
    this.peers.set(connId, p);

    if (this.micTrack) pc.addTrack(this.micTrack, this.micStream);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.send('webrtc:ice', { to: connId, payload: e.candidate });
    };
    pc.ontrack = (e) => this.playRemote(connId, e.streams[0]);
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
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      this.send('webrtc:offer', { to: connId, payload: offer });
    } catch (e) { /* the other side may still offer us */ }
  }

  async onOffer(m) {
    await this.startAudio();
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
      this.ui.quality.title =
        `${word}${rtt != null ? ` · ${rtt}ms` : ''}${loss != null ? ` · ${loss}% loss` : ''}${jitter != null ? ` · ${jitter}ms jitter` : ''}`;
    } catch (e) { /* stats are advisory */ }
  }

  /* ── misc ─────────────────────────────────────────────────────────────── */

  setDot(k) { this.ui.dot.className = 'vptt-dot vptt-' + k; }

  renderNow() {
    if (!this.channel) { this.ui.now.textContent = 'Select a channel'; return; }
    const t = this.transmitting;
    this.ui.now.innerHTML = t
      ? `<span class="vptt-live">${t.priority ? '🚨 PRIORITY' : '🎙️'} ${esc(t.name)}</span> — TRANSMITTING`
      : `<span class="vptt-idle">${esc(this.channel.emoji)} ${esc(this.channel.name)}</span> — clear`;
  }

  renderUsers() {
    this.ui.users.innerHTML = this.users.map((u) => {
      const icon = u.state === 'TRANSMITTING' ? '🎙️' : (u.state === 'IDLE' ? '🟡' : '🟢');
      return `<div class="vptt-user"><span>${icon} ${esc(u.name)}</span><span class="vptt-state">${u.state}</span></div>`;
    }).join('') || '<div class="vptt-empty">No one here yet</div>';
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
          if (kind === 'audioinput') { this.micStream = null; this.startAudio(); }
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
