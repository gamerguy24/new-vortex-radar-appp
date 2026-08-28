/*
 * backend/ptt/permissions.js
 * Who may do what on the radio.
 *
 * ROLES COME FROM THE EXISTING ACCOUNT, NOT FROM A SECOND USER SYSTEM.
 * Vortex already knows whether someone is an admin, a super admin, or approved
 * to stream. PTT adds only what Vortex has no concept of — per-channel
 * moderators, priority transmit, and radio bans — and stores those as grants
 * against the existing user id.
 *
 * Everything here is evaluated SERVER-SIDE. The client is told what it may do
 * so it can grey out buttons, but nothing is trusted from it: the signalling
 * layer re-checks every action against these functions before it takes effect.
 */

// Highest wins. A user's effective role is the strongest of: their Vortex
// account flags, and any radio grant recorded against them.
const ROLES = ['USER', 'MODERATOR', 'CHANNEL_ADMIN', 'RADIO_ADMIN', 'SUPER_ADMIN'];
const RANK = Object.fromEntries(ROLES.map((r, i) => [r, i]));

const CAPS = {
  USER: ['join', 'speak'],
  MODERATOR: ['join', 'speak', 'mute', 'kick'],
  CHANNEL_ADMIN: ['join', 'speak', 'mute', 'kick', 'ban', 'edit_channel', 'priority'],
  RADIO_ADMIN: ['join', 'speak', 'mute', 'kick', 'ban', 'edit_channel', 'create_channel',
    'delete_channel', 'priority', 'emergency', 'manage_users', 'manage_radio'],
  SUPER_ADMIN: ['join', 'speak', 'mute', 'kick', 'ban', 'edit_channel', 'create_channel',
    'delete_channel', 'priority', 'emergency', 'manage_users', 'manage_radio'],
};

/**
 * Effective role for a user, optionally within one channel.
 *
 * @param {object} user     the Vortex account (req.user)
 * @param {object} grants   radio grants store: { byUser: { [id]: {...} } }
 * @param {object} channel  optional channel, for per-channel moderators
 */
function roleFor(user, grants, channel) {
  if (!user) return null;
  let role = 'USER';

  // Vortex account flags map onto radio roles.
  if (user.isSuperAdmin) role = 'SUPER_ADMIN';
  else if (user.isAdmin) role = 'RADIO_ADMIN';

  // Explicit radio grants can raise (never lower) that.
  const g = grants && grants.byUser && grants.byUser[user.id];
  if (g && g.role && RANK[g.role] != null && RANK[g.role] > RANK[role]) role = g.role;

  // Per-channel moderator, which does not apply anywhere else.
  if (channel && Array.isArray(channel.moderators) && channel.moderators.includes(user.id)) {
    if (RANK.MODERATOR > RANK[role]) role = 'MODERATOR';
  }
  return role;
}

function can(user, capability, grants, channel) {
  const role = roleFor(user, grants, channel);
  if (!role) return false;
  return CAPS[role].includes(capability);
}

/**
 * May this user transmit on this channel right now?
 *
 * Returns { ok: true } or { ok: false, reason } — a reason string the client
 * can show verbatim, because "denied" with no explanation is the single most
 * frustrating thing a radio can do.
 */
function canTransmit(user, channel, grants) {
  if (!user) return { ok: false, reason: 'Not signed in.' };

  const g = (grants && grants.byUser && grants.byUser[user.id]) || {};
  if (g.banned) return { ok: false, reason: 'You are banned from the radio.' };
  if (g.pttDisabled) return { ok: false, reason: 'Transmit has been disabled on your account.' };
  if (!channel) return { ok: false, reason: 'No channel selected.' };

  if (Array.isArray(channel.bannedUsers) && channel.bannedUsers.includes(user.id)) {
    return { ok: false, reason: 'You are banned from this channel.' };
  }
  if (Array.isArray(channel.mutedUsers) && channel.mutedUsers.includes(user.id)) {
    return { ok: false, reason: 'You are muted on this channel.' };
  }
  if (channel.listenOnly && !can(user, 'mute', grants, channel)) {
    return { ok: false, reason: 'This channel is listen-only.' };
  }
  if (!can(user, 'speak', grants, channel)) {
    return { ok: false, reason: 'You do not have permission to transmit.' };
  }
  return { ok: true };
}

/** May this user even be in this channel? */
function canJoin(user, channel, grants, password) {
  if (!user) return { ok: false, reason: 'Not signed in.' };
  if (!channel) return { ok: false, reason: 'No such channel.' };

  const g = (grants && grants.byUser && grants.byUser[user.id]) || {};
  if (g.banned) return { ok: false, reason: 'You are banned from the radio.' };
  if (Array.isArray(channel.bannedUsers) && channel.bannedUsers.includes(user.id)) {
    return { ok: false, reason: 'You are banned from this channel.' };
  }

  // Staff channels and invite-only channels bypass their own gates for anyone
  // who could administer them anyway.
  const privileged = can(user, 'mute', grants, channel);

  if (channel.requiresRole && RANK[roleFor(user, grants, channel)] < RANK[channel.requiresRole]) {
    return { ok: false, reason: 'This channel is restricted.' };
  }
  if (channel.inviteOnly && !privileged
      && !(Array.isArray(channel.invited) && channel.invited.includes(user.id))) {
    return { ok: false, reason: 'This channel is invite-only.' };
  }
  if (channel.password && !privileged && String(password || '') !== channel.password) {
    return { ok: false, reason: 'Incorrect channel password.', needsPassword: true };
  }
  return { ok: true };
}

/**
 * May this account use the radio AT ALL?
 *
 * PTT is staff-only. This is the outermost gate — the page, every /api/ptt
 * route and the WebSocket upgrade all check it, so a non-admin cannot reach the
 * radio by any path, not merely fail to see the button. Hiding the panel is
 * cosmetic; this is the part that matters.
 *
 * Admins are in by virtue of their Vortex account. Beyond that, an admin can
 * extend access to one specific person by giving them a radio role through
 * /api/ptt/users/:id/grant — that endpoint is itself admin-only, so the set of
 * people on the radio stays under admin control either way. A radio ban closes
 * the door regardless of rank.
 */
function canUsePtt(user, grants) {
  if (!user) return false;
  if (user.isLocked) return false;
  const g = (grants && grants.byUser && grants.byUser[user.id]) || {};
  if (g.banned) return false;
  if (user.isSuperAdmin || user.isAdmin) return true;
  return !!(g.role && RANK[g.role] != null);
}

/** Priority transmit can seize the floor from an ordinary transmission. */
function canPriority(user, grants, channel) {
  const g = (grants && grants.byUser && grants.byUser[user.id]) || {};
  if (g.priority) return true;
  return can(user, 'priority', grants, channel);
}

/**
 * A name to put on the radio.
 *
 * Vortex accounts carry an email and nothing else -- no username, no display
 * name -- so the local part of the address is the only identity available.
 * Without this every operator showed up as the literal word "User", which on a
 * radio is worse than useless: you cannot tell who is transmitting.
 */
function displayName(user) {
  if (!user) return 'Unknown';
  if (user.displayName) return String(user.displayName);
  if (user.username) return String(user.username);
  const local = String(user.email || '').split('@')[0];
  if (!local) return 'User ' + String(user.id || '').slice(0, 4);
  // first.last / first_last / first-last -> First Last
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\d+$/, '')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || local;
}

module.exports = { ROLES, RANK, CAPS, roleFor, can, canTransmit, canJoin, canPriority, canUsePtt, displayName };
