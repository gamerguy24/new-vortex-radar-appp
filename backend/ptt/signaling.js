/*
 * backend/ptt/signaling.js
 * The radio itself: presence, floor control, and WebRTC signalling.
 *
 * WHY THE FLOOR IS HELD HERE AND NOWHERE ELSE
 * Half duplex means exactly one person transmits on a channel at a time. That
 * rule is enforced in this file, on the server, because it is the only place
 * that can be. A browser can be modified, a message can be forged, and two
 * clients that each believe they hold the floor produce the one failure a radio
 * must never have: two people talking over each other during a warning. The
 * client asks for the floor and waits to be told yes; it never assumes.
 *
 * TRANSPORT
 * A single WebSocket per connected user carries control messages. Voice does
 * NOT travel over it — audio is a WebRTC peer connection negotiated through the
 * offer/answer/ICE messages relayed here, so speech goes directly between
 * browsers and never touches this process.
 *
 * Mounted at /ptt/socket, alongside scanner.js's own upgrade handler. Both
 * check the path and ignore anything that is not theirs, so they coexist.
 */

const crypto = require('crypto');
const perms = require('./permissions');

// A transmission that never gets released — a wedged tab, a phone that slept
// mid-press — would hold a channel silent forever. The floor is therefore a
// lease, renewed by the client while the button is down.
const FLOOR_MAX_MS = 120 * 1000;        // hard ceiling on one transmission
const FLOOR_IDLE_MS = 6 * 1000;         // no keepalive for this long -> revoked

// Crude but effective anti-spam: keying up repeatedly to deny others the floor.
const KEYUP_WINDOW_MS = 10 * 1000;
const KEYUP_MAX = 12;

function nowIso() { return new Date().toISOString(); }

function createRadio({ store, log }) {
  /*
   * Live state, in memory only.
   *   clients   connectionId -> { ws, user, channelId, lastSeen, keyups[] }
   *   floors    channelId    -> { userId, name, connId, since, expires, priority, timer }
   */
  const clients = new Map();
  const floors = new Map();

  /* ── addressing ───────────────────────────────────────────────────────── */

  function membersOf(channelId) {
    const out = [];
    for (const c of clients.values()) if (c.channelId === channelId) out.push(c);
    return out;
  }

  function send(client, type, data) {
    if (!client || !client.ws || client.ws.readyState !== 1) return;
    try { client.ws.send(JSON.stringify({ type, ...data })); } catch (e) { /* dropped */ }
  }

  function broadcast(channelId, type, data, exceptConnId) {
    for (const c of membersOf(channelId)) {
      if (exceptConnId && c.id === exceptConnId) continue;
      send(c, type, data);
    }
  }

  /* ── presence ─────────────────────────────────────────────────────────── */

  function presenceOf(channelId) {
    const floor = floors.get(channelId);
    return membersOf(channelId).map((c) => ({
      connId: c.id,
      userId: c.user.id,
      name: perms.displayName(c.user),
      role: perms.roleFor(c.user, store.grants(), store.byId(channelId)),
      state: floor && floor.connId === c.id ? 'TRANSMITTING'
        : (Date.now() - c.lastSeen > 90 * 1000 ? 'IDLE' : 'LISTENING'),
      location: c.shareLocation && c.location ? c.location : null,
    }));
  }

  function pushPresence(channelId) {
    const floor = floors.get(channelId);
    broadcast(channelId, 'ptt:presence', {
      channelId,
      users: presenceOf(channelId),
      transmitting: floor ? { userId: floor.userId, name: floor.name, priority: !!floor.priority } : null,
    });
  }

  /** Channel occupancy, for the REST channel list. */
  function liveFor(channelId) {
    const floor = floors.get(channelId);
    return {
      count: membersOf(channelId).length,
      transmitting: floor ? { userId: floor.userId, name: floor.name } : null,
    };
  }

  /* ── floor control ────────────────────────────────────────────────────── */

  function releaseFloor(channelId, why) {
    const floor = floors.get(channelId);
    if (!floor) return;
    clearTimeout(floor.timer);
    floors.delete(channelId);
    broadcast(channelId, 'ptt:stop', { channelId, userId: floor.userId, name: floor.name, reason: why || 'released' });
    log('PTT_STOP', { channelId, userId: floor.userId, reason: why || 'released' });
    pushPresence(channelId);
  }

  function armFloorTimers(channelId) {
    const floor = floors.get(channelId);
    if (!floor) return;
    clearTimeout(floor.timer);
    // Whichever comes first: the hard ceiling, or silence from the client.
    const msLeft = Math.min(floor.expires - Date.now(), FLOOR_IDLE_MS);
    floor.timer = setTimeout(() => {
      const f = floors.get(channelId);
      if (!f) return;
      if (Date.now() >= f.expires) return releaseFloor(channelId, 'time-limit');
      if (Date.now() - f.lastKeepalive > FLOOR_IDLE_MS) return releaseFloor(channelId, 'lost-contact');
      armFloorTimers(channelId);
    }, Math.max(500, msLeft));
  }

  function rateLimited(client) {
    const now = Date.now();
    client.keyups = (client.keyups || []).filter((t) => now - t < KEYUP_WINDOW_MS);
    if (client.keyups.length >= KEYUP_MAX) return true;
    client.keyups.push(now);
    return false;
  }

  /**
   * A user asks for the floor.
   *
   * Answers with ptt:granted or ptt:denied / ptt:busy — never silence, because
   * a PTT button with no response is indistinguishable from a broken one.
   */
  function requestFloor(client, { priority } = {}) {
    const channelId = client.channelId;
    if (!channelId) return send(client, 'ptt:denied', { reason: 'Join a channel first.' });

    const channel = store.byId(channelId);
    const grants = store.grants();

    const allowed = perms.canTransmit(client.user, channel, grants);
    if (!allowed.ok) {
      log('PTT_DENIED', { channelId, userId: client.user.id, reason: allowed.reason });
      return send(client, 'ptt:denied', { channelId, reason: allowed.reason });
    }

    if (rateLimited(client)) {
      log('PTT_DENIED', { channelId, userId: client.user.id, reason: 'rate limited' });
      return send(client, 'ptt:denied', { channelId, reason: 'Too many transmissions — slow down.' });
    }

    const wantsPriority = !!priority && perms.canPriority(client.user, grants, channel);
    if (priority && !wantsPriority) {
      return send(client, 'ptt:denied', { channelId, reason: 'You are not authorised for priority transmit.' });
    }

    const held = floors.get(channelId);
    if (held) {
      if (held.connId === client.id) {
        // Already talking. Treat a repeat as a keepalive rather than an error.
        held.lastKeepalive = Date.now();
        return send(client, 'ptt:granted', { channelId, resumed: true });
      }
      if (!wantsPriority) {
        log('PTT_DENIED', { channelId, userId: client.user.id, reason: 'busy' });
        return send(client, 'ptt:busy', { channelId, holder: { userId: held.userId, name: held.name } });
      }
      // Priority seizes the floor. The person cut off is told why.
      const displaced = clients.get(held.connId);
      if (displaced) send(displaced, 'ptt:stop', { channelId, reason: 'pre-empted', by: perms.displayName(client.user) });
      releaseFloor(channelId, 'pre-empted');
    }

    const floor = {
      userId: client.user.id,
      name: perms.displayName(client.user),
      connId: client.id,
      since: Date.now(),
      expires: Date.now() + FLOOR_MAX_MS,
      lastKeepalive: Date.now(),
      priority: wantsPriority,
      timer: null,
    };
    floors.set(channelId, floor);
    armFloorTimers(channelId);

    send(client, 'ptt:granted', { channelId, priority: wantsPriority, maxMs: FLOOR_MAX_MS });
    broadcast(channelId, 'ptt:start', {
      channelId, userId: floor.userId, name: floor.name, priority: wantsPriority,
    }, client.id);

    log(wantsPriority ? 'PRIORITY_TRANSMISSION' : 'PTT_START',
      { channelId, userId: client.user.id, name: floor.name });
    pushPresence(channelId);
  }

  function stopFloor(client) {
    const channelId = client.channelId;
    const floor = channelId && floors.get(channelId);
    // Only the holder can end a transmission. Anyone else asking is either
    // confused or malicious; either way it must not cut the speaker off.
    if (floor && floor.connId === client.id) releaseFloor(channelId, 'released');
  }

  /* ── channel membership ───────────────────────────────────────────────── */

  function joinChannel(client, channelId, password) {
    const channel = store.byId(channelId);
    if (!channel) return send(client, 'ptt:denied', { reason: 'No such channel.' });

    const check = perms.canJoin(client.user, channel, store.grants(), password);
    if (!check.ok) {
      return send(client, 'ptt:denied', { channelId, reason: check.reason, needsPassword: !!check.needsPassword });
    }
    if (channel.limit && membersOf(channelId).length >= channel.limit
        && !perms.can(client.user, 'mute', store.grants(), channel)) {
      return send(client, 'ptt:denied', { channelId, reason: 'Channel is full.' });
    }

    if (client.channelId) leaveChannel(client, { silent: true });

    client.channelId = channelId;
    log('CHANNEL_JOIN', { channelId, userId: client.user.id });

    const floor = floors.get(channelId);
    send(client, 'ptt:joined', {
      channel: store.publicChannel(channel, liveFor(channelId)),
      users: presenceOf(channelId),
      transmitting: floor ? { userId: floor.userId, name: floor.name } : null,
      // What this user may do here, so the UI can disable rather than mislead.
      capabilities: {
        speak: perms.canTransmit(client.user, channel, store.grants()).ok,
        priority: perms.canPriority(client.user, store.grants(), channel),
        moderate: perms.can(client.user, 'kick', store.grants(), channel),
      },
      // Peers already in the channel, so the newcomer can open connections.
      peers: membersOf(channelId).filter((c) => c.id !== client.id).map((c) => ({
        connId: c.id, userId: c.user.id, name: perms.displayName(c.user),
      })),
    });
    pushPresence(channelId);
  }

  function leaveChannel(client, { silent } = {}) {
    const channelId = client.channelId;
    if (!channelId) return;

    const floor = floors.get(channelId);
    if (floor && floor.connId === client.id) releaseFloor(channelId, 'left');

    client.channelId = null;
    broadcast(channelId, 'ptt:peer-left', { channelId, connId: client.id });
    log('CHANNEL_LEAVE', { channelId, userId: client.user.id });
    if (!silent) send(client, 'ptt:left', { channelId });
    pushPresence(channelId);
  }

  /* ── WebRTC relay ─────────────────────────────────────────────────────── */

  /*
   * Offers, answers and ICE candidates are passed between two peers untouched.
   * The server checks only that both are in the same channel — without that,
   * a crafted `to` would let anyone open a peer connection to any user on the
   * system, which is how a voice system becomes a way to call strangers.
   */
  function relay(client, msg) {
    const target = clients.get(msg.to);
    if (!target) return;
    if (!client.channelId || target.channelId !== client.channelId) return;
    send(target, msg.type, {
      from: client.id,
      fromUserId: client.user.id,
      fromName: perms.displayName(client.user),
      payload: msg.payload,
    });
  }

  /* ── moderation ───────────────────────────────────────────────────────── */

  function moderate(client, msg) {
    const channel = store.byId(client.channelId);
    if (!perms.can(client.user, 'kick', store.grants(), channel)) {
      return send(client, 'ptt:denied', { reason: 'You are not a moderator here.' });
    }
    const target = clients.get(msg.connId);
    if (!target || target.channelId !== client.channelId) return;

    if (msg.action === 'kick') {
      send(target, 'ptt:kicked', { channelId: client.channelId, by: perms.displayName(client.user) });
      leaveChannel(target);
      log('USER_KICK', { channelId: client.channelId, by: client.user.id, userId: target.user.id });
    } else if (msg.action === 'mute') {
      const ch = store.byId(client.channelId);
      if (ch && !ch.mutedUsers.includes(target.user.id)) {
        ch.mutedUsers.push(target.user.id);
        store.saveChannels();
      }
      const floor = floors.get(client.channelId);
      if (floor && floor.connId === target.id) releaseFloor(client.channelId, 'muted');
      send(target, 'ptt:muted', { channelId: client.channelId, by: perms.displayName(client.user) });
      log('USER_MUTE', { channelId: client.channelId, by: client.user.id, userId: target.user.id });
      pushPresence(client.channelId);
    }
  }

  /* ── connection lifecycle ─────────────────────────────────────────────── */

  function attachClient(ws, user) {
    const id = crypto.randomBytes(8).toString('hex');
    const client = {
      id, ws, user, channelId: null, lastSeen: Date.now(),
      keyups: [], shareLocation: false, location: null,
    };
    clients.set(id, client);

    send(client, 'ptt:hello', {
      connId: id,
      user: { id: user.id, name: perms.displayName(user), role: perms.roleFor(user, store.grants(), null) },
      // The client must never assume it may talk after reconnecting — it is
      // told the rules, and still has to ask for the floor.
      floorRules: { maxMs: FLOOR_MAX_MS, keepaliveMs: 2000 },
    });

    ws.on('message', (raw) => {
      client.lastSeen = Date.now();
      let msg;
      try { msg = JSON.parse(String(raw)); } catch (e) { return; }
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'ptt:join': return joinChannel(client, String(msg.channelId || ''), msg.password);
        case 'ptt:leave': return leaveChannel(client);
        case 'ptt:request': return requestFloor(client, { priority: !!msg.priority });
        case 'ptt:keepalive': {
          const f = floors.get(client.channelId);
          if (f && f.connId === client.id) f.lastKeepalive = Date.now();
          return;
        }
        case 'ptt:stop': return stopFloor(client);
        case 'ptt:location': {
          client.shareLocation = !!msg.share;
          client.location = msg.share && msg.lat != null
            ? { lat: Number(msg.lat), lon: Number(msg.lon) } : null;
          return pushPresence(client.channelId);
        }
        case 'ptt:moderate': return moderate(client, msg);
        case 'webrtc:offer':
        case 'webrtc:answer':
        case 'webrtc:ice':
          return relay(client, msg);
        default:
          return;
      }
    });

    const close = () => {
      leaveChannel(client, { silent: true });
      clients.delete(id);
    };
    ws.on('close', close);
    ws.on('error', close);

    return client;
  }

  return {
    attachClient,
    liveFor,
    presenceOf,
    membersOf: (id) => membersOf(id).length,
    channelsLive: () => {
      const out = {};
      for (const c of store.all()) out[c.id] = liveFor(c.id);
      return out;
    },
    onlineUsers: () => [...clients.values()].map((c) => ({
      userId: c.user.id,
      name: perms.displayName(c.user),
      channelId: c.channelId,
    })),
    // Used by the admin API when a channel is deleted out from under people.
    evictChannel: (channelId, reason) => {
      for (const c of membersOf(channelId)) {
        send(c, 'ptt:kicked', { channelId, reason: reason || 'Channel removed.' });
        leaveChannel(c);
      }
    },
  };
}

module.exports = { createRadio, FLOOR_MAX_MS };
