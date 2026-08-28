/*
 * backend/ptt/index.js
 * VORTEX PTT — a self-hosted push-to-talk radio inside Vortex Radar.
 *
 * REPLACES nothing that already works: scanner.js stays exactly as it is. That
 * module is a ONE-WAY broadcast relay (a gateway pushes audio in, listeners
 * pull it out). This is a many-to-many radio with floor control, which is a
 * different thing entirely, so the two live side by side rather than one being
 * bent into the other.
 *
 * WHAT RUNS WHERE
 *   this file            REST API, admin controls, event log, WS upgrade
 *   signaling.js         presence, floor control, WebRTC relay
 *   channels.js          channel definitions + per-user grants (JSON on disk)
 *   permissions.js       who may do what, evaluated server-side only
 *
 * Voice never passes through this process. The WebSocket carries control
 * messages; audio goes browser-to-browser over WebRTC, negotiated through the
 * offer/answer/ICE messages signaling.js relays.
 *
 * No Docker, no third-party voice service, no second user system. `ws` was
 * already a declared dependency of this project (scanner.js uses it), so this
 * adds no new infrastructure.
 */

const { createStore } = require('./channels');
const { createRadio } = require('./signaling');
const perms = require('./permissions');

const EVENTS_FILE = 'ptt_events.json';
const MAX_EVENTS = 2000;

function attachPtt({ app, requireAuth, requireAdmin, DATA_DIR, readJson, writeJson, userFromRequest }) {
  const store = createStore({ DATA_DIR, readJson, writeJson });

  /* ── event log ──────────────────────────────────────────────────────────
   * A rolling buffer, flushed to disk lazily. Radio events are frequent and
   * individually cheap; writing the file on every key-up would turn a busy
   * channel into a disk-bound one. Nothing here contains audio — this system
   * records that a transmission happened, never what was said.
   */
  let events = readJson(EVENTS_FILE, []) || [];
  let flushTimer = null;
  function log(type, data) {
    events.push({ at: new Date().toISOString(), type, ...data });
    if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        try { writeJson(EVENTS_FILE, events); } catch (e) { /* logging must never break the radio */ }
      }, 5000);
    }
  }

  const radio = createRadio({ store, log });

  /*
   * THE RADIO IS STAFF-ONLY, AND THIS IS WHERE THAT IS ENFORCED.
   *
   * Applied to /ptt, every /api/ptt route below, and the socket upgrade — so a
   * non-admin cannot reach the radio by typing the URL, calling the API
   * directly, or opening a WebSocket by hand. The panel also hides itself for
   * non-admins, but that is only tidiness; this is the actual gate.
   */
  function requireRadio(req, res, next) {
    if (perms.canUsePtt(req.user, store.grants())) return next();
    if ((req.headers.accept || '').includes('text/html')) return res.status(403).send('Not available.');
    return res.status(403).json({ error: 'The radio is available to administrators only.' });
  }
  const gate = [requireAuth, requireRadio];

  // The standalone /ptt page and everything under it. Registered here, before
  // server.js adds its index route and before express.static, so a non-admin
  // gets 403 whether they ask for /ptt, /ptt/, or /ptt/index.html directly.
  app.use('/ptt', gate);

  // Cheap probe so the panel can decide whether to render at all, without
  // pulling the whole channel list first.
  app.get('/api/ptt/access', requireAuth, (req, res) => {
    const allowed = perms.canUsePtt(req.user, store.grants());
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      allowed,
      role: allowed ? perms.roleFor(req.user, store.grants(), null) : null,
    });
  });

  /* ── REST ───────────────────────────────────────────────────────────────
   * The socket is the live surface; these exist so the panel can render before
   * it connects, and so admin tools have somewhere to POST.
   */

  app.get('/api/ptt/channels', gate, (req, res) => {
    const grants = store.grants();
    const list = store.all()
      .filter((c) => {
        // Hide channels this user could never enter, rather than showing a
        // list of doors that will not open.
        if (!c.requiresRole) return true;
        return perms.RANK[perms.roleFor(req.user, grants, c)] >= perms.RANK[c.requiresRole];
      })
      .map((c) => store.publicChannel(c, radio.liveFor(c.id)));
    res.json({
      channels: list,
      you: {
        id: req.user.id,
        name: req.user.username,
        role: perms.roleFor(req.user, grants, null),
        canCreate: perms.can(req.user, 'create_channel', grants, null),
        priority: perms.canPriority(req.user, grants, null),
      },
    });
  });

  app.get('/api/ptt/channels/:id', gate, (req, res) => {
    const c = store.byId(req.params.id);
    if (!c) return res.status(404).json({ error: 'No such channel.' });
    const check = perms.canJoin(req.user, c, store.grants(), null);
    res.json({
      channel: store.publicChannel(c, radio.liveFor(c.id)),
      users: radio.presenceOf(c.id),
      mayJoin: check.ok,
      reason: check.ok ? null : check.reason,
    });
  });

  app.get('/api/ptt/users', gate, (req, res) => {
    res.json({ users: radio.onlineUsers() });
  });

  // Join/leave over REST exist for completeness, but the socket is the real
  // path: membership is a live-connection concept, so a POST can only report
  // whether the door is open, not walk through it.
  app.post('/api/ptt/channels/:id/join', gate, (req, res) => {
    const c = store.byId(req.params.id);
    if (!c) return res.status(404).json({ error: 'No such channel.' });
    const check = perms.canJoin(req.user, c, store.grants(), (req.body || {}).password);
    if (!check.ok) return res.status(403).json({ error: check.reason, needsPassword: !!check.needsPassword });
    res.json({ ok: true, channel: store.publicChannel(c, radio.liveFor(c.id)), connectVia: '/ptt/socket' });
  });

  app.post('/api/ptt/channels/:id/leave', gate, (req, res) => {
    res.json({ ok: true, note: 'Leaving is a socket action; close or send ptt:leave.' });
  });

  /* ── admin ──────────────────────────────────────────────────────────── */

  app.post('/api/ptt/channels', gate, (req, res) => {
    if (!perms.can(req.user, 'create_channel', store.grants(), null)) {
      return res.status(403).json({ error: 'You cannot create channels.' });
    }
    const b = req.body || {};
    const id = String(b.id || b.name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (!id) return res.status(400).json({ error: 'A channel name is required.' });
    const created = store.add({ ...b, id, createdBy: req.user.id });
    if (!created) return res.status(409).json({ error: 'A channel with that id already exists.' });
    log('CHANNEL_CREATE', { channelId: id, userId: req.user.id });
    res.json({ ok: true, channel: store.publicChannel(created, radio.liveFor(id)) });
  });

  app.post('/api/ptt/channels/:id/edit', gate, (req, res) => {
    const c = store.byId(req.params.id);
    if (!c) return res.status(404).json({ error: 'No such channel.' });
    if (!perms.can(req.user, 'edit_channel', store.grants(), c)) {
      return res.status(403).json({ error: 'You cannot edit this channel.' });
    }
    const updated = store.update(req.params.id, req.body || {});
    log('CHANNEL_EDIT', { channelId: c.id, userId: req.user.id });
    res.json({ ok: true, channel: store.publicChannel(updated, radio.liveFor(c.id)) });
  });

  app.delete('/api/ptt/channels/:id', gate, (req, res) => {
    const c = store.byId(req.params.id);
    if (!c) return res.status(404).json({ error: 'No such channel.' });
    if (!perms.can(req.user, 'delete_channel', store.grants(), c)) {
      return res.status(403).json({ error: 'You cannot delete channels.' });
    }
    // Tell anyone standing in it before it disappears underneath them.
    radio.evictChannel(c.id, 'This channel was removed.');
    store.remove(c.id);
    log('CHANNEL_DELETE', { channelId: c.id, userId: req.user.id });
    res.json({ ok: true });
  });

  // Radio-wide grants: role, priority transmit, radio ban, transmit disable.
  app.post('/api/ptt/users/:id/grant', gate, requireAdmin, (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.role !== undefined) {
      if (b.role !== null && !perms.RANK[b.role]) return res.status(400).json({ error: 'Unknown role.' });
      patch.role = b.role;
    }
    if (b.priority !== undefined) patch.priority = !!b.priority;
    if (b.banned !== undefined) patch.banned = !!b.banned;
    if (b.pttDisabled !== undefined) patch.pttDisabled = !!b.pttDisabled;

    const grant = store.setGrant(req.params.id, patch);
    log('USER_GRANT', { userId: req.params.id, by: req.user.id, ...patch });
    res.json({ ok: true, grant });
  });

  app.get('/api/ptt/events', gate, requireAdmin, (req, res) => {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 200));
    res.json({ events: events.slice(-limit).reverse() });
  });

  /* ── WebSocket ──────────────────────────────────────────────────────────
   * Mounted on the existing HTTP server at /ptt/socket. scanner.js installs its
   * own 'upgrade' listener and ignores paths that are not its own; this does
   * the same, so the two coexist on one port without either knowing about the
   * other.
   */
  function attachUpgrade(server) {
    if (!server) return false;
    let WebSocketServer;
    try {
      WebSocketServer = require('ws').WebSocketServer || require('ws').Server;
    } catch (e) {
      console.warn('[PTT] WebSocket unavailable — run "npm install" to enable the radio.');
      return false;
    }

    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

    server.on('upgrade', (req, socket, head) => {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch (e) { return; }
      if (url.pathname !== '/ptt/socket') return;      // not ours — leave it alone

      const reject = (code, why) => {
        try { socket.write(`HTTP/1.1 ${code}\r\nConnection: close\r\n\r\n`); } catch (e) {}
        try { socket.destroy(); } catch (e) {}
        console.warn(`[PTT] socket rejected (${code} ${why})`);
      };

      // THE SAME SESSION THE WEBSITE USES. The upgrade request carries the
      // vr_session cookie like any other request, so the radio identifies
      // people exactly as the rest of Vortex does — no token to mint, no second
      // account system, and nothing the client can claim about itself.
      let user = null;
      try { user = userFromRequest(req); } catch (e) { user = null; }
      if (!user) return reject('401 Unauthorized', 'no session');
      if (user.isLocked) return reject('403 Forbidden', 'account locked');

      // Same staff-only gate as the routes. A hand-rolled WebSocket bypasses
      // Express entirely, so this check has to be repeated here rather than
      // assumed from the page having loaded.
      if (!perms.canUsePtt(user, store.grants())) return reject('403 Forbidden', 'not an administrator');

      wss.handleUpgrade(req, socket, head, (ws) => {
        radio.attachClient(ws, user);
      });
    });

    console.log('[PTT] radio online — ws /ptt/socket, api /api/ptt/*');
    return true;
  }

  return { attachUpgrade, radio, store, log };
}

module.exports = { attachPtt };
