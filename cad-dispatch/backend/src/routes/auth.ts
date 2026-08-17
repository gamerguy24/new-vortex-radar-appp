import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import {
  DEPARTMENTS,
  getUserStore,
  normalizeUsername,
  toPublicUser,
  UsernameTakenError,
} from '../services/userStore';
import {
  checkPasswordStrength,
  generatePassword,
  hashPassword,
  verifyPassword,
} from '../services/passwordService';
import { asyncHandler, issueToken, requireAuth, statusMessage } from '../middleware/auth';
import { loginThrottle, resetIdentityThrottle, resetIpThrottle } from '../services/loginThrottle';
import { buildTempPasswordEmail, sendMail } from '../services/mailer';

export const authRouter = Router();

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters.')
  .max(32, 'Username must be 32 characters or fewer.')
  .regex(/^[A-Za-z0-9._-]+$/, 'Username may only contain letters, numbers, dots, underscores and hyphens.');

const registerSchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().min(2, 'Enter your full name.').max(80),
  // Required: this is the only channel a forgotten password can be recovered through.
  email: z.string().trim().email('Enter a valid email address.').max(120),
  department: z.enum(DEPARTMENTS),
  password: z.string(),
  note: z.string().trim().max(300).optional(),
});

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username.'),
  password: z.string().min(1, 'Enter your password.'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string(),
});

/**
 * A real hash to compare against when the username does not exist, so that a
 * failed lookup costs the same time as a wrong password and cannot be used to
 * enumerate valid usernames.
 */
let decoyHash: string | null = null;
async function getDecoyHash(): Promise<string> {
  if (!decoyHash) decoyHash = await hashPassword('decoy-value-not-in-use');
  return decoyHash;
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message || 'Invalid request.';
}

function clientIp(req: { ip?: string; socket: { remoteAddress?: string } }): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/* -------------------------------------------------------------------------- */
/* Self-registration                                                          */
/* -------------------------------------------------------------------------- */

authRouter.post('/register', asyncHandler(async (req, res) => {
  if (!env.allowSelfRegistration) {
    return res.status(403).json({ error: 'Self-registration is currently disabled.' });
  }

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: firstIssue(parsed.error) });
  }

  const { username, fullName, email, department, password, note } = parsed.data;

  const strength = checkPasswordStrength(password, username);
  if (!strength.ok) {
    return res.status(400).json({ error: strength.reason });
  }

  const store = getUserStore();

  try {
    const user = await store.createUser({
      username,
      fullName,
      email: email || null,
      role: 'officer',
      department,
      permissions: [],
      status: 'pending',
      passwordHash: await hashPassword(password),
      mustChangePassword: false,
      note: note || null,
    });

    await store.appendAudit({
      actorId: user.id,
      actorName: user.fullName,
      action: 'Access requested',
      targetId: user.id,
      targetName: user.username,
      detail: `${user.fullName} requested access for ${user.department}.`,
    });

    return res.status(201).json({
      status: 'pending',
      message: 'Request submitted. An administrator will review your account shortly.',
    });
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    throw err;
  }
}));

/* -------------------------------------------------------------------------- */
/* Login                                                                      */
/* -------------------------------------------------------------------------- */

authRouter.post('/login', asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: firstIssue(parsed.error) });
  }

  const username = normalizeUsername(parsed.data.username);
  const throttleKeys = [`user:${username}`, `ip:${clientIp(req)}`];

  const throttle = loginThrottle.check(throttleKeys);
  if (throttle.blocked) {
    return res.status(429).json({
      error: `Too many failed sign-in attempts. Try again in ${Math.ceil(throttle.retryAfterSeconds / 60)} minute(s).`,
      retryAfterSeconds: throttle.retryAfterSeconds,
    });
  }

  const store = getUserStore();
  const user = await store.findByUsername(username);

  const passwordOk = user
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : await verifyPassword(parsed.data.password, await getDecoyHash());

  if (!user || !passwordOk) {
    loginThrottle.recordFailure(throttleKeys);
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  // Credentials are correct, so the account is no longer a brute-force target.
  loginThrottle.clear(throttleKeys);

  if (user.status !== 'active') {
    return res.status(403).json({ error: statusMessage(user.status), status: user.status });
  }

  if (user.tempPasswordExpiresAt && Date.parse(user.tempPasswordExpiresAt) < Date.now()) {
    return res.status(401).json({
      error: 'That temporary password has expired. Request a new one from the sign-in page.',
      tempPasswordExpired: true,
    });
  }

  const stamped = await store.updateUser(user.id, { lastLoginAt: new Date().toISOString() }) ?? user;

  return res.json({
    token: issueToken(stamped),
    user: toPublicUser(stamped),
    mustChangePassword: stamped.mustChangePassword,
  });
}));

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = req.authUser!;
  return res.json({ user: toPublicUser(user), mustChangePassword: user.mustChangePassword });
}));

authRouter.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: firstIssue(parsed.error) });
  }

  const user = req.authUser!;
  const { currentPassword, newPassword } = parsed.data;

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'Your current password is incorrect.' });
  }

  const strength = checkPasswordStrength(newPassword, user.username);
  if (!strength.ok) {
    return res.status(400).json({ error: strength.reason });
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    return res.status(400).json({ error: 'Choose a password you have not already used.' });
  }

  const store = getUserStore();
  const updated = await store.updateUser(user.id, {
    passwordHash: await hashPassword(newPassword),
    mustChangePassword: false,
    // The chosen password replaces any emailed temporary one, so the clock stops.
    tempPasswordExpiresAt: null,
    passwordVersion: user.passwordVersion + 1,
  });

  if (!updated) {
    return res.status(404).json({ error: 'Account no longer exists.' });
  }

  await store.appendAudit({
    actorId: user.id,
    actorName: user.fullName,
    action: 'Password changed',
    targetId: user.id,
    targetName: user.username,
    detail: 'User changed their own password.',
  });

  // The old token carries a stale password version, so hand back a fresh one.
  return res.json({ token: issueToken(updated), user: toPublicUser(updated) });
}));

/* -------------------------------------------------------------------------- */
/* Self-service password reset                                                */
/* -------------------------------------------------------------------------- */

const forgotSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or email address.').max(120),
});

/**
 * Emails a freshly generated temporary password to the address on the account.
 *
 * The response is deliberately identical whether or not the account exists, so
 * the endpoint cannot be used to discover usernames or email addresses. The
 * generated password is never returned in the response body — it only ever
 * reaches the user through their own inbox.
 */
authRouter.post('/forgot-password', asyncHandler(async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: firstIssue(parsed.error) });
  }

  const identifier = parsed.data.identifier.trim();
  const genericResponse = {
    message:
      'If that account exists and has an email address on file, a temporary password has been sent to it. ' +
      'Check your inbox, including spam.',
  };

  // Per-account and per-IP limits are tracked separately: one account may only be
  // reset a few times an hour, but a shared address still gets a workable budget.
  const identityKey = [`reset:id:${identifier.toLowerCase()}`];
  const ipKey = [`reset:ip:${clientIp(req)}`];

  const identityThrottle = resetIdentityThrottle.check(identityKey);
  const ipThrottle = resetIpThrottle.check(ipKey);
  const blocked = identityThrottle.blocked ? identityThrottle : ipThrottle.blocked ? ipThrottle : null;

  if (blocked) {
    return res.status(429).json({
      error: `Too many reset requests. Try again in ${Math.ceil(blocked.retryAfterSeconds / 60)} minute(s).`,
      retryAfterSeconds: blocked.retryAfterSeconds,
    });
  }

  // Counted whether or not the account exists, so probing costs the same either way.
  resetIdentityThrottle.recordFailure(identityKey);
  resetIpThrottle.recordFailure(ipKey);

  const store = getUserStore();
  const lowered = identifier.toLowerCase();
  const user = (await store.findByUsername(lowered))
    ?? (await store.listUsers()).find((entry) => entry.email?.toLowerCase() === lowered)
    ?? null;

  // Suspended, denied and pending accounts are not recoverable by their owner.
  if (!user || !user.email || user.status !== 'active') {
    return res.json(genericResponse);
  }

  const tempPassword = generatePassword();
  const ttlMinutes = env.tempPasswordTtlMinutes;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  const updated = await store.updateUser(user.id, {
    passwordHash: await hashPassword(tempPassword),
    mustChangePassword: true,
    tempPasswordExpiresAt: expiresAt,
    // Ends any session opened with the old password.
    passwordVersion: user.passwordVersion + 1,
  });

  if (!updated) {
    return res.json(genericResponse);
  }

  const email = buildTempPasswordEmail(user.fullName, user.username, tempPassword, ttlMinutes);
  const delivered = await sendMail({ to: user.email, ...email });

  await store.appendAudit({
    actorId: user.id,
    actorName: user.fullName,
    action: 'Password reset requested',
    targetId: user.id,
    targetName: user.username,
    detail: delivered
      ? `Temporary password emailed to the address on file. Expires in ${ttlMinutes} minutes.`
      : 'Temporary password generated but the email could not be delivered.',
  });

  return res.json(genericResponse);
}));

/** Departments a registration form can choose from. */
authRouter.get('/departments', (_req, res) => {
  res.json({ departments: DEPARTMENTS, selfRegistration: env.allowSelfRegistration });
});
