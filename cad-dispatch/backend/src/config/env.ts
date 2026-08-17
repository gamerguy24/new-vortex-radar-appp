import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../data');

const WEAK_SECRETS = new Set(['change-me-in-production', 'change-this-secret', 'secret', '']);

/**
 * JWT signing key. If the operator has not set one, a random key is generated
 * and persisted so tokens are never signed with a value that is public in the
 * repository. Deleting the file simply invalidates all existing sessions.
 */
function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured && !WEAK_SECRETS.has(configured)) return configured;

  if (configured) {
    console.warn('JWT_SECRET is set to a known placeholder value and is being ignored.');
  }

  const secretFile = path.join(dataDir, '.jwt-secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* not generated yet */
  }

  const generated = crypto.randomBytes(48).toString('base64url');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.warn(`JWT_SECRET was not configured. Generated one and stored it at ${secretFile}.`);
  } catch (err) {
    console.warn('JWT_SECRET was not configured and could not be persisted; sessions will end on restart.', err);
  }
  return generated;
}

export const env = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: resolveJwtSecret(),
  tokenTtl: process.env.TOKEN_TTL || '8h',
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: Number(process.env.DB_PORT || 5432),
  dbUser: process.env.DB_USER || 'postgres',
  dbPassword: process.env.DB_PASSWORD || 'postgres',
  dbName: process.env.DB_NAME || 'cad_dispatch',
  dbRequired: process.env.DB_REQUIRED === 'true',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  dataDir,
  /** When false, the public /api/auth/register endpoint is disabled. */
  allowSelfRegistration: process.env.ALLOW_SELF_REGISTRATION !== 'false',
  bootstrapAdminUsername: process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin',

  appName: process.env.APP_NAME || 'CAD Dispatch',
  /** How long an emailed temporary password stays valid. */
  tempPasswordTtlMinutes: Number(process.env.TEMP_PASSWORD_TTL_MINUTES || 60),

  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || '',
  smtpSecure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : undefined,
  mailFrom: process.env.MAIL_FROM || 'CAD Dispatch <no-reply@localhost>',
};
