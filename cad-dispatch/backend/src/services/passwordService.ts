import crypto from 'crypto';

/**
 * Password hashing and generation.
 *
 * Uses Node's built-in scrypt so the project needs no native/extra dependency.
 * Hash format: scrypt$<N>$<r>$<p>$<saltBase64>$<keyBase64>
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

// Ambiguous characters (0/O, 1/l/I) are excluded so a generated password can be
// read aloud or copied by hand without confusion.
const GEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const GEN_GROUPS = 4;
const GEN_GROUP_SIZE = 4;

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password.normalize('NFKC'),
      salt,
      keylen,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * 1024 * 1024 },
      (err, derived) => (err ? reject(err) : resolve(derived)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltRaw, 'base64');
    expected = Buffer.from(keyRaw, 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const derived = await new Promise<Buffer | null>((resolve) => {
    crypto.scrypt(
      password.normalize('NFKC'),
      salt,
      expected.length,
      { N, r, p, maxmem: 256 * 1024 * 1024 },
      (err, out) => resolve(err ? null : out),
    );
  });
  if (!derived) return false;

  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Cryptographically secure, unbiased password generator.
 * Produces e.g. "Kf7m-Qx2L-n9pT-Rv4W" (~90 bits of entropy).
 */
export function generatePassword(): string {
  const groups: string[] = [];

  for (let g = 0; g < GEN_GROUPS; g += 1) {
    let group = '';
    for (let i = 0; i < GEN_GROUP_SIZE; i += 1) {
      group += GEN_ALPHABET[crypto.randomInt(GEN_ALPHABET.length)];
    }
    groups.push(group);
  }

  return groups.join('-');
}

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Validation for user-chosen passwords. Deliberately length-first rather than a
 * composition-rule maze, which is what current NIST guidance recommends.
 */
export function checkPasswordStrength(password: string, username?: string): PasswordCheck {
  if (typeof password !== 'string' || password.length < 10) {
    return { ok: false, reason: 'Password must be at least 10 characters long.' };
  }

  if (password.length > 200) {
    return { ok: false, reason: 'Password must be 200 characters or fewer.' };
  }

  if (/^\s|\s$/.test(password)) {
    return { ok: false, reason: 'Password cannot start or end with a space.' };
  }

  const lowered = password.toLowerCase();

  if (username && username.length >= 3 && lowered.includes(username.toLowerCase())) {
    return { ok: false, reason: 'Password cannot contain your username.' };
  }

  const banned = [
    'password', 'passw0rd', '12345678', '123456789', '1234567890',
    'qwerty', 'letmein', 'welcome', 'iloveyou', 'admin123',
    'dispatch', 'changeme',
  ];
  if (banned.some((entry) => lowered.includes(entry))) {
    return { ok: false, reason: 'That password is too common. Choose something less predictable.' };
  }

  if (/^(.)\1+$/.test(password)) {
    return { ok: false, reason: 'Password cannot be a single repeated character.' };
  }

  return { ok: true };
}
