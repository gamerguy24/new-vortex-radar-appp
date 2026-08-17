import { env } from '../config/env';
import { generatePassword, hashPassword } from '../services/passwordService';
import { getUserStore } from '../services/userStore';

/**
 * Creates the first administrator when the store is empty and prints the
 * generated password once. Nothing else in the system can hand out that
 * password afterwards — only the hash is kept.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const store = getUserStore();
  const users = await store.listUsers();

  if (users.length > 0) {
    if ((await store.countActiveAdmins()) === 0) {
      console.warn(
        '\n  WARNING: no active administrator exists. Approve or reactivate an admin\n' +
        '  account directly in the user store to regain access to the admin portal.\n',
      );
    }
    return;
  }

  const password = generatePassword();
  const admin = await store.createUser({
    username: env.bootstrapAdminUsername,
    fullName: 'System Administrator',
    email: null,
    role: 'admin',
    department: 'Dispatch',
    permissions: ['dispatch', 'admin', 'records'],
    status: 'active',
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
  });

  await store.appendAudit({
    actorId: null,
    actorName: 'system',
    action: 'Bootstrap admin created',
    targetId: admin.id,
    targetName: admin.username,
    detail: 'Initial administrator account generated on first start.',
  });

  const line = '='.repeat(64);
  console.log(
    `\n${line}\n` +
    '  FIRST-RUN ADMIN ACCOUNT CREATED\n\n' +
    `    Username:  ${admin.username}\n` +
    `    Password:  ${password}\n\n` +
    '  This password is shown once and is not recoverable. Sign in now;\n' +
    '  you will be required to change it immediately.\n' +
    `${line}\n`,
  );
}
