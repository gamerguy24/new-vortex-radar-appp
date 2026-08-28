/*
 * backend/ptt/channels.js
 * Channel definitions and their persistence.
 *
 * STORAGE FOLLOWS THE REST OF THE APP: JSON in DATA_DIR through the same
 * readJson/writeJson helpers users, sessions and reports already use. Vortex
 * has no SQL database, so introducing one for seven radio channels would be
 * exactly the "unnecessary infrastructure" this build is meant to avoid.
 *
 * Two files:
 *   ptt_channels.json   channel definitions (edited by admins, survives restart)
 *   ptt_grants.json     per-user radio grants: role, priority, bans, mutes
 *
 * Live state — who is connected, who holds the floor — is deliberately NOT
 * persisted. It is meaningless across a restart, and writing it on every key
 * press would hammer the disk.
 */

const CHANNELS_FILE = 'ptt_channels.json';
const GRANTS_FILE = 'ptt_grants.json';

// Shipped so the radio works the moment it is deployed, rather than presenting
// an empty list an admin has to populate before anyone can talk.
const DEFAULT_CHANNELS = [
  { id: 'storm-chasers', emoji: '🌪️', name: 'Storm Chasers', description: 'Field coordination for active chases.', limit: 50 },
  { id: 'severe-weather', emoji: '🌩️', name: 'Severe Weather', description: 'General severe weather discussion.', limit: 100 },
  { id: 'spotters', emoji: '📡', name: 'Weather Spotters', description: 'Trained spotter reports and nets.', limit: 100 },
  { id: 'emergency', emoji: '🚨', name: 'Emergency Weather', description: 'Life-threatening situations only.', limit: 100, priorityOnly: false },
  { id: 'media', emoji: '🎥', name: 'Media', description: 'Broadcast and media coordination.', limit: 50 },
  { id: 'global', emoji: '🌎', name: 'Global Weather', description: 'Open channel, all welcome.', limit: 200 },
  { id: 'staff', emoji: '🛠️', name: 'Vortex Staff', description: 'Staff only.', limit: 25, requiresRole: 'MODERATOR' },
];

function normalise(c) {
  return {
    id: String(c.id),
    emoji: c.emoji || '📻',
    name: String(c.name || c.id),
    description: String(c.description || ''),
    limit: Number.isFinite(c.limit) ? c.limit : 50,
    // Optional gates.
    password: c.password || null,
    inviteOnly: !!c.inviteOnly,
    invited: Array.isArray(c.invited) ? c.invited : [],
    requiresRole: c.requiresRole || null,
    listenOnly: !!c.listenOnly,
    // Moderation, by user id.
    moderators: Array.isArray(c.moderators) ? c.moderators : [],
    mutedUsers: Array.isArray(c.mutedUsers) ? c.mutedUsers : [],
    bannedUsers: Array.isArray(c.bannedUsers) ? c.bannedUsers : [],
    // Set when a channel is bound to a tracked storm (see storms.js in the
    // rotation engine); null for standing channels.
    stormId: c.stormId || null,
    createdBy: c.createdBy || null,
    createdAt: c.createdAt || new Date().toISOString(),
  };
}

/**
 * A channel as the client is allowed to see it. The password never leaves the
 * server — the client is told only THAT one is required, so it can prompt.
 */
function publicChannel(c, live) {
  return {
    id: c.id,
    emoji: c.emoji,
    name: c.name,
    description: c.description,
    limit: c.limit,
    hasPassword: !!c.password,
    inviteOnly: c.inviteOnly,
    requiresRole: c.requiresRole,
    listenOnly: c.listenOnly,
    stormId: c.stormId,
    users: live ? live.count : 0,
    transmitting: live ? live.transmitting : null,
  };
}

function createStore({ DATA_DIR, readJson, writeJson }) {
  let channels = null;
  let grants = null;

  function loadChannels() {
    if (channels) return channels;
    const raw = readJson(CHANNELS_FILE, null);
    channels = Array.isArray(raw) && raw.length
      ? raw.map(normalise)
      : DEFAULT_CHANNELS.map(normalise);
    if (!Array.isArray(raw) || !raw.length) saveChannels();
    return channels;
  }
  function saveChannels() { writeJson(CHANNELS_FILE, channels); }

  function loadGrants() {
    if (grants) return grants;
    grants = readJson(GRANTS_FILE, null) || { byUser: {} };
    if (!grants.byUser) grants.byUser = {};
    return grants;
  }
  function saveGrants() { writeJson(GRANTS_FILE, grants); }

  return {
    all: () => loadChannels(),
    byId: (id) => loadChannels().find((c) => c.id === id) || null,
    add(def) {
      loadChannels();
      const c = normalise(def);
      if (channels.some((x) => x.id === c.id)) return null;   // ids are the address
      channels.push(c);
      saveChannels();
      return c;
    },
    update(id, patch) {
      loadChannels();
      const c = channels.find((x) => x.id === id);
      if (!c) return null;
      // id is identity; changing it would orphan everyone currently joined.
      const { id: _ignored, ...rest } = patch || {};
      Object.assign(c, normalise({ ...c, ...rest }));
      saveChannels();
      return c;
    },
    remove(id) {
      loadChannels();
      const i = channels.findIndex((x) => x.id === id);
      if (i < 0) return false;
      channels.splice(i, 1);
      saveChannels();
      return true;
    },
    grants: () => loadGrants(),
    setGrant(userId, patch) {
      loadGrants();
      grants.byUser[userId] = { ...(grants.byUser[userId] || {}), ...patch };
      saveGrants();
      return grants.byUser[userId];
    },
    saveChannels,
    saveGrants,
    publicChannel,
    DEFAULT_CHANNELS,
  };
}

module.exports = { createStore, publicChannel, normalise, DEFAULT_CHANNELS };
