import { Router } from 'express';
import { z } from 'zod';
import {
  AppUser,
  DEPARTMENTS,
  getUserStore,
  toPublicUser,
  USER_ROLES,
  UsernameTakenError,
} from '../services/userStore';
import { generatePassword, hashPassword } from '../services/passwordService';
import { asyncHandler, requireAuth, requireCurrentPassword, requireRole } from '../middleware/auth';
import { getActiveCalls, getUnits } from '../services/dispatchService';
import { buildTempPasswordEmail, sendMail } from '../services/mailer';
import { env } from '../config/env';

export const adminRouter = Router();

// Every admin route requires an authenticated, fully-provisioned account.
adminRouter.use(requireAuth, requireCurrentPassword);

const readAccess = requireRole('admin', 'supervisor');
const writeAccess = requireRole('admin');

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, 'Username may only contain letters, numbers, dots, underscores and hyphens.');

const createUserSchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120).optional().or(z.literal('')),
  role: z.enum(USER_ROLES),
  department: z.enum(DEPARTMENTS),
  permissions: z.array(z.string().max(40)).max(20).optional(),
});

const approveSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  department: z.enum(DEPARTMENTS).optional(),
  permissions: z.array(z.string().max(40)).max(20).optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(120).optional().or(z.literal('')),
  role: z.enum(USER_ROLES).optional(),
  department: z.enum(DEPARTMENTS).optional(),
  permissions: z.array(z.string().max(40)).max(20).optional(),
});

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message || 'Invalid request.';
}

/**
 * Prevents an admin from locking everyone out by removing the final active
 * admin, and from disabling their own account by accident.
 */
async function guardLastAdmin(target: AppUser, change: 'demote' | 'disable'): Promise<string | null> {
  if (target.role !== 'admin' || target.status !== 'active') return null;
  const activeAdmins = await getUserStore().countActiveAdmins();
  if (activeAdmins > 1) return null;
  return change === 'demote'
    ? 'This is the last active administrator. Promote another admin before changing this role.'
    : 'This is the last active administrator. Promote another admin before disabling this account.';
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

adminRouter.get('/users', readAccess, asyncHandler(async (_req, res) => {
  const users = await getUserStore().listUsers();
  const sorted = [...users].sort((a, b) => {
    // Pending requests float to the top; the rest are newest-first.
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return res.json({
    users: sorted.map(toPublicUser),
    roles: USER_ROLES,
    departments: DEPARTMENTS,
    pendingCount: sorted.filter((user) => user.status === 'pending').length,
  });
}));

/** Creates an account directly and returns a generated password exactly once. */
adminRouter.post('/users', writeAccess, asyncHandler(async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: firstIssue(parsed.error) });
  }

  const actor = req.authUser!;
  const { username, fullName, email, role, department, permissions } = parsed.data;
  const tempPassword = generatePassword();
  const store = getUserStore();

  try {
    const user = await store.createUser({
      username,
      fullName,
      email: email || null,
      role,
      department,
      permissions: permissions ?? [],
      status: 'active',
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
    });

    let emailed = false;
    if (user.email) {
      const message = buildTempPasswordEmail(
        user.fullName,
        user.username,
        tempPassword,
        env.tempPasswordTtlMinutes,
      );
      emailed = await sendMail({ to: user.email, ...message });
    }

    await store.appendAudit({
      actorId: actor.id,
      actorName: actor.fullName,
      action: 'User created',
      targetId: user.id,
      targetName: user.username,
      detail: emailed
        ? `Created ${role} in ${department}; generated password emailed to ${user.email}.`
        : `Created ${role} in ${department} with a generated password.`,
    });

    return res.status(201).json({
      user: toPublicUser(user),
      // Returned once and never stored in plaintext — only the hash is persisted.
      tempPassword,
      emailed,
    });
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    throw err;
  }
}));

adminRouter.post('/users/:id/approve', writeAccess, asyncHandler(async (req, res) => {
  const parsed = approveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: firstIssue(parsed.error) });
  }

  const store = getUserStore();
  const target = await store.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  if (target.status === 'active') {
    return res.status(409).json({ error: 'That account is already active.' });
  }

  const actor = req.authUser!;
  const updated = await store.updateUser(target.id, {
    status: 'active',
    role: parsed.data.role ?? target.role,
    department: parsed.data.department ?? target.department,
    permissions: parsed.data.permissions ?? target.permissions,
    approvedAt: new Date().toISOString(),
    approvedBy: actor.fullName,
  });

  await store.appendAudit({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'Access approved',
    targetId: target.id,
    targetName: target.username,
    detail: `Approved as ${updated?.role} in ${updated?.department}.`,
  });

  return res.json({ user: updated ? toPublicUser(updated) : null });
}));

adminRouter.post('/users/:id/deny', writeAccess, asyncHandler(async (req, res) => {
  const store = getUserStore();
  const target = await store.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const actor = req.authUser!;
  if (target.id === actor.id) {
    return res.status(400).json({ error: 'You cannot deny your own account.' });
  }

  const blocked = await guardLastAdmin(target, 'disable');
  if (blocked) return res.status(409).json({ error: blocked });

  const updated = await store.updateUser(target.id, {
    status: 'denied',
    // Invalidates any session the account may already hold.
    passwordVersion: target.passwordVersion + 1,
  });

  await store.appendAudit({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'Access denied',
    targetId: target.id,
    targetName: target.username,
    detail: `Denied access request from ${target.fullName}.`,
  });

  return res.json({ user: updated ? toPublicUser(updated) : null });
}));

/**
 * Generates a fresh password for a user, emails it to them when an address is on
 * file, and also returns it once so the admin can relay it if there is no email.
 * Admin-issued passwords do not expire, since delivery timing is the admin's.
 */
adminRouter.post('/users/:id/reset-password', writeAccess, asyncHandler(async (req, res) => {
  const store = getUserStore();
  const target = await store.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const actor = req.authUser!;
  const tempPassword = generatePassword();

  const updated = await store.updateUser(target.id, {
    passwordHash: await hashPassword(tempPassword),
    mustChangePassword: true,
    tempPasswordExpiresAt: null,
    // Forces re-authentication everywhere the old password was used.
    passwordVersion: target.passwordVersion + 1,
  });

  let emailed = false;
  if (target.email) {
    const message = buildTempPasswordEmail(
      target.fullName,
      target.username,
      tempPassword,
      env.tempPasswordTtlMinutes,
    );
    emailed = await sendMail({ to: target.email, ...message });
  }

  await store.appendAudit({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'Password reset',
    targetId: target.id,
    targetName: target.username,
    detail: emailed
      ? `Generated a new password for ${target.fullName} and emailed it to ${target.email}.`
      : `Generated a new password for ${target.fullName}. No email on file — delivered manually.`,
  });

  return res.json({ user: updated ? toPublicUser(updated) : null, tempPassword, emailed });
}));

adminRouter.post('/users/:id/suspend', writeAccess, asyncHandler(async (req, res) => {
  const store = getUserStore();
  const target = await store.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const actor = req.authUser!;
  if (target.id === actor.id) {
    return res.status(400).json({ error: 'You cannot suspend your own account.' });
  }

  const blocked = await guardLastAdmin(target, 'disable');
  if (blocked) return res.status(409).json({ error: blocked });

  const updated = await store.updateUser(target.id, {
    status: 'suspended',
    passwordVersion: target.passwordVersion + 1,
  });

  await store.appendAudit({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'User suspended',
    targetId: target.id,
    targetName: target.username,
    detail: `Suspended ${target.fullName}.`,
  });

  return res.json({ user: updated ? toPublicUser(updated) : null });
}));

adminRouter.post('/users/:id/reactivate', writeAccess, asyncHandler(async (req, res) => {
  const store = getUserStore();
  const target = await store.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const actor = req.authUser!;
  const updated = await store.updateUser(target.id, {
    status: 'active',
    approvedAt: target.approvedAt ?? new Date().toISOString(),
    approvedBy: target.approvedBy ?? actor.fullName,
  });

  await store.appendAudit({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'User reactivated',
    targetId: target.id,
    targetName: target.username,
    detail: `Reactivated ${target.fullName}.`,
  });

  return res.json({ user: updated ? toPublicUser(updated) : null });
}));

adminRouter.patch('/users/:id', writeAccess, asyncHandler(async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: firstIssue(parsed.error) });
  }

  const store = getUserStore();
  const target = await store.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const actor = req.authUser!;
  const nextRole = parsed.data.role ?? target.role;

  if (nextRole !== 'admin' && target.role === 'admin') {
    const blocked = await guardLastAdmin(target, 'demote');
    if (blocked) return res.status(409).json({ error: blocked });
  }

  if (target.id === actor.id && nextRole !== 'admin') {
    return res.status(400).json({ error: 'You cannot remove your own admin role.' });
  }

  const patch: Partial<AppUser> = {};
  if (parsed.data.fullName !== undefined) patch.fullName = parsed.data.fullName;
  if (parsed.data.email !== undefined) patch.email = parsed.data.email || null;
  if (parsed.data.role !== undefined) patch.role = parsed.data.role;
  if (parsed.data.department !== undefined) patch.department = parsed.data.department;
  if (parsed.data.permissions !== undefined) patch.permissions = parsed.data.permissions;

  const updated = await store.updateUser(target.id, patch);

  await store.appendAudit({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'User updated',
    targetId: target.id,
    targetName: target.username,
    detail: `Updated ${Object.keys(patch).join(', ') || 'nothing'}.`,
  });

  return res.json({ user: updated ? toPublicUser(updated) : null });
}));

adminRouter.delete('/users/:id', writeAccess, asyncHandler(async (req, res) => {
  const store = getUserStore();
  const target = await store.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const actor = req.authUser!;
  if (target.id === actor.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  const blocked = await guardLastAdmin(target, 'disable');
  if (blocked) return res.status(409).json({ error: blocked });

  await store.deleteUser(target.id);
  await store.appendAudit({
    actorId: actor.id,
    actorName: actor.fullName,
    action: 'User deleted',
    targetId: target.id,
    targetName: target.username,
    detail: `Deleted account for ${target.fullName}.`,
  });

  return res.json({ deleted: true });
}));

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

adminRouter.get('/analytics', readAccess, asyncHandler(async (_req, res) => {
  const users = await getUserStore().listUsers();

  return res.json({
    activeCalls: getActiveCalls().filter((call) => call.active).length,
    activeUnits: getUnits().length,
    totalUsers: users.length,
    pendingApprovals: users.filter((user) => user.status === 'pending').length,
    suspendedUsers: users.filter((user) => user.status === 'suspended').length,
    admins: users.filter((user) => user.role === 'admin' && user.status === 'active').length,
  });
}));

adminRouter.get('/audit', readAccess, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  return res.json({ logs: await getUserStore().listAudit(limit) });
}));
