import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { pool } from '../db/pool';
import { env } from '../config/env';

export const USER_ROLES = ['admin', 'supervisor', 'dispatcher', 'officer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['pending', 'active', 'suspended', 'denied'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const DEPARTMENTS = [
  'Police', 'Sheriff', 'State Patrol', 'Fire Rescue', 'EMS', 'Dispatch', 'DOT', 'SWAT',
] as const;

export interface AppUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: UserRole;
  department: string;
  permissions: string[];
  status: UserStatus;
  passwordHash: string;
  mustChangePassword: boolean;
  /**
   * Set only for self-service resets, where the password was emailed rather than
   * handed over in person. Null means the current password does not expire.
   */
  tempPasswordExpiresAt: string | null;
  /** Bumped on every credential/status change so existing JWTs stop validating. */
  passwordVersion: number;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  lastLoginAt: string | null;
  note: string | null;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  targetId: string | null;
  targetName: string | null;
  detail: string;
  createdAt: string;
}

/** The shape safe to send to a client — never includes passwordHash. */
export type PublicUser = Omit<AppUser, 'passwordHash'>;

export function toPublicUser(user: AppUser): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export function normalizeUsername(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}

export interface NewUserInput {
  username: string;
  fullName: string;
  email: string | null;
  role: UserRole;
  department: string;
  permissions: string[];
  status: UserStatus;
  passwordHash: string;
  mustChangePassword: boolean;
  note?: string | null;
}

export interface UserStore {
  readonly driver: 'postgres' | 'file';
  init(): Promise<void>;
  listUsers(): Promise<AppUser[]>;
  findById(id: string): Promise<AppUser | null>;
  findByUsername(username: string): Promise<AppUser | null>;
  createUser(input: NewUserInput): Promise<AppUser>;
  updateUser(id: string, patch: Partial<AppUser>): Promise<AppUser | null>;
  deleteUser(id: string): Promise<boolean>;
  countActiveAdmins(): Promise<number>;
  appendAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void>;
  listAudit(limit: number): Promise<AuditEntry[]>;
}

function buildUser(input: NewUserInput): AppUser {
  return {
    id: crypto.randomUUID(),
    username: normalizeUsername(input.username),
    fullName: input.fullName,
    email: input.email,
    role: input.role,
    department: input.department,
    permissions: input.permissions,
    status: input.status,
    passwordHash: input.passwordHash,
    mustChangePassword: input.mustChangePassword,
    tempPasswordExpiresAt: null,
    passwordVersion: 1,
    createdAt: new Date().toISOString(),
    approvedAt: input.status === 'active' ? new Date().toISOString() : null,
    approvedBy: null,
    lastLoginAt: null,
    note: input.note ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* JSON file store                                                            */
/* -------------------------------------------------------------------------- */

interface FileShape {
  users: AppUser[];
  audit: AuditEntry[];
}

class FileUserStore implements UserStore {
  readonly driver = 'file' as const;

  private readonly filePath = path.join(env.dataDir, 'users.json');
  private data: FileShape = { users: [], audit: [] };
  /** Serializes writes so concurrent requests cannot interleave and corrupt the file. */
  private writeChain: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    await fs.mkdir(env.dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<FileShape>;
      this.data = {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      };
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        throw new Error(`Unable to read user store at ${this.filePath}: ${err?.message || err}`);
      }
      await this.flush();
    }
  }

  private flush(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      const payload = JSON.stringify(this.data, null, 2);
      await fs.writeFile(tmp, payload, { mode: 0o600 });
      await fs.rename(tmp, this.filePath);
    }).catch((err) => {
      console.error('Failed to persist user store:', err);
    });
    return this.writeChain;
  }

  async listUsers(): Promise<AppUser[]> {
    return this.data.users.map((user) => ({ ...user }));
  }

  async findById(id: string): Promise<AppUser | null> {
    const found = this.data.users.find((user) => user.id === id);
    return found ? { ...found } : null;
  }

  async findByUsername(username: string): Promise<AppUser | null> {
    const target = normalizeUsername(username);
    const found = this.data.users.find((user) => user.username === target);
    return found ? { ...found } : null;
  }

  async createUser(input: NewUserInput): Promise<AppUser> {
    const user = buildUser(input);
    if (this.data.users.some((entry) => entry.username === user.username)) {
      throw new UsernameTakenError();
    }
    this.data.users.push(user);
    await this.flush();
    return { ...user };
  }

  async updateUser(id: string, patch: Partial<AppUser>): Promise<AppUser | null> {
    const index = this.data.users.findIndex((user) => user.id === id);
    if (index === -1) return null;
    const merged = { ...this.data.users[index], ...patch, id };
    this.data.users[index] = merged;
    await this.flush();
    return { ...merged };
  }

  async deleteUser(id: string): Promise<boolean> {
    const index = this.data.users.findIndex((user) => user.id === id);
    if (index === -1) return false;
    this.data.users.splice(index, 1);
    await this.flush();
    return true;
  }

  async countActiveAdmins(): Promise<number> {
    return this.data.users.filter((user) => user.role === 'admin' && user.status === 'active').length;
  }

  async appendAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void> {
    this.data.audit.unshift({ ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
    this.data.audit = this.data.audit.slice(0, 1000);
    await this.flush();
  }

  async listAudit(limit: number): Promise<AuditEntry[]> {
    return this.data.audit.slice(0, limit).map((entry) => ({ ...entry }));
  }
}

/* -------------------------------------------------------------------------- */
/* Postgres store                                                             */
/* -------------------------------------------------------------------------- */

const USER_COLUMNS = `
  id, username, full_name, email, role, department, permissions, status,
  password_hash, must_change_password, temp_password_expires_at, password_version,
  created_at, approved_at, approved_by, last_login_at, note
`;

function rowToUser(row: any): AppUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    department: row.department,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    status: row.status,
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password,
    tempPasswordExpiresAt: row.temp_password_expires_at
      ? new Date(row.temp_password_expires_at).toISOString()
      : null,
    passwordVersion: Number(row.password_version),
    createdAt: new Date(row.created_at).toISOString(),
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    approvedBy: row.approved_by,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    note: row.note,
  };
}

/** Maps AppUser fields to their column names for the dynamic UPDATE builder. */
const COLUMN_MAP: Record<string, string> = {
  username: 'username',
  fullName: 'full_name',
  email: 'email',
  role: 'role',
  department: 'department',
  permissions: 'permissions',
  status: 'status',
  passwordHash: 'password_hash',
  mustChangePassword: 'must_change_password',
  tempPasswordExpiresAt: 'temp_password_expires_at',
  passwordVersion: 'password_version',
  approvedAt: 'approved_at',
  approvedBy: 'approved_by',
  lastLoginAt: 'last_login_at',
  note: 'note',
};

class PgUserStore implements UserStore {
  readonly driver = 'postgres' as const;

  async init(): Promise<void> {
    // Idempotent: brings an existing `users` table up to the auth schema without
    // requiring the operator to drop anything.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name TEXT NOT NULL,
        department TEXT NOT NULL
      );
    `);

    const columns: Array<[string, string]> = [
      ['username', 'TEXT'],
      ['email', 'TEXT'],
      ['role', "TEXT NOT NULL DEFAULT 'dispatcher'"],
      ['permissions', "JSONB DEFAULT '[]'::jsonb"],
      ['status', "TEXT NOT NULL DEFAULT 'pending'"],
      ['password_hash', "TEXT NOT NULL DEFAULT ''"],
      ['must_change_password', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['temp_password_expires_at', 'TIMESTAMPTZ'],
      ['password_version', 'INTEGER NOT NULL DEFAULT 1'],
      ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
      ['approved_at', 'TIMESTAMPTZ'],
      ['approved_by', 'TEXT'],
      ['last_login_at', 'TIMESTAMPTZ'],
      ['note', 'TEXT'],
    ];

    for (const [name, type] of columns) {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${name} ${type};`);
    }

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_key
      ON users (username) WHERE username IS NOT NULL;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id TEXT,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        target_id TEXT,
        target_name TEXT,
        detail TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  }

  async listUsers(): Promise<AppUser[]> {
    const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC`);
    return result.rows.map(rowToUser);
  }

  async findById(id: string): Promise<AppUser | null> {
    const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return result.rows[0] ? rowToUser(result.rows[0]) : null;
  }

  async findByUsername(username: string): Promise<AppUser | null> {
    const result = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE username = $1`,
      [normalizeUsername(username)],
    );
    return result.rows[0] ? rowToUser(result.rows[0]) : null;
  }

  async createUser(input: NewUserInput): Promise<AppUser> {
    const user = buildUser(input);
    try {
      const result = await pool.query(
        `INSERT INTO users (
           id, username, full_name, email, role, department, permissions, status,
           password_hash, must_change_password, temp_password_expires_at, password_version,
           created_at, approved_at, note
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING ${USER_COLUMNS}`,
        [
          user.id, user.username, user.fullName, user.email, user.role, user.department,
          JSON.stringify(user.permissions), user.status, user.passwordHash,
          user.mustChangePassword, user.tempPasswordExpiresAt, user.passwordVersion,
          user.createdAt, user.approvedAt, user.note,
        ],
      );
      return rowToUser(result.rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') throw new UsernameTakenError();
      throw err;
    }
  }

  async updateUser(id: string, patch: Partial<AppUser>): Promise<AppUser | null> {
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, column] of Object.entries(COLUMN_MAP)) {
      if (!(key in patch)) continue;
      const value = (patch as Record<string, unknown>)[key];
      values.push(key === 'permissions' ? JSON.stringify(value) : value);
      sets.push(`${column} = $${values.length}`);
    }

    if (sets.length === 0) return this.findById(id);

    values.push(id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${USER_COLUMNS}`,
      values,
    );
    return result.rows[0] ? rowToUser(result.rows[0]) : null;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async countActiveAdmins(): Promise<number> {
    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active'",
    );
    return result.rows[0]?.count ?? 0;
  }

  async appendAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void> {
    await pool.query(
      `INSERT INTO admin_audit (actor_id, actor_name, action, target_id, target_name, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [entry.actorId, entry.actorName, entry.action, entry.targetId, entry.targetName, entry.detail],
    );
  }

  async listAudit(limit: number): Promise<AuditEntry[]> {
    const result = await pool.query(
      `SELECT id, actor_id, actor_name, action, target_id, target_name, detail, created_at
       FROM admin_audit ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      action: row.action,
      targetId: row.target_id,
      targetName: row.target_name,
      detail: row.detail,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}

export class UsernameTakenError extends Error {
  constructor() {
    super('That username is already taken.');
    this.name = 'UsernameTakenError';
  }
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

let store: UserStore | null = null;

/**
 * Uses Postgres when it is reachable, otherwise persists to a JSON file so the
 * app is fully usable without a database server. Set DB_REQUIRED=true to make a
 * missing database a hard startup failure instead.
 */
export async function initUserStore(): Promise<UserStore> {
  if (store) return store;

  try {
    await pool.query('SELECT 1');
    const pg = new PgUserStore();
    await pg.init();
    store = pg;
    console.log('User store: postgres');
    return store;
  } catch (err: any) {
    if (env.dbRequired) {
      throw new Error(`DB_REQUIRED=true but Postgres is unreachable: ${err?.message || err}`);
    }
    console.warn(`Postgres unavailable (${err?.message || err}). Falling back to file-backed user store.`);
  }

  const file = new FileUserStore();
  await file.init();
  store = file;
  console.log(`User store: file (${path.join(env.dataDir, 'users.json')})`);
  return store;
}

export function getUserStore(): UserStore {
  if (!store) throw new Error('User store accessed before initUserStore() completed.');
  return store;
}
