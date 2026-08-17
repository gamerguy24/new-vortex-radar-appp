import fs from 'fs/promises';
import path from 'path';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type MailerMode = 'smtp' | 'outbox';

let transport: Transporter | null = null;
let mode: MailerMode = 'outbox';

export function getMailerMode(): MailerMode {
  return mode;
}

export function initMailer(): void {
  if (!env.smtpHost) {
    mode = 'outbox';
    console.warn(
      `SMTP is not configured. Password reset emails will be written to ${path.join(env.dataDir, 'outbox')} ` +
      'instead of being delivered. Set SMTP_HOST/SMTP_USER/SMTP_PASS to send real mail.',
    );
    return;
  }

  // A host with no credentials almost always means a half-finished .env. Say so
  // now rather than letting every reset email fail quietly at send time.
  if (!env.smtpUser || !env.smtpPassword) {
    console.warn(
      `SMTP_HOST is set to ${env.smtpHost} but SMTP_USER or SMTP_PASSWORD is empty. ` +
      'Authentication will fail and password reset emails will not be delivered. ' +
      'Run "npm run mail:test -- you@yourdomain.com" to diagnose.',
    );
  }

  if (env.mailFrom && env.smtpUser && !env.mailFrom.includes(env.smtpUser)) {
    console.warn(
      `MAIL_FROM (${env.mailFrom}) does not contain the authenticated address (${env.smtpUser}). ` +
      'Most providers, Zoho included, reject a From address that is not the account or a verified alias.',
    );
  }

  transport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    // Port 465 is implicit TLS; other ports upgrade via STARTTLS.
    secure: env.smtpSecure ?? env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPassword } : undefined,
  });
  mode = 'smtp';
  console.log(`Mailer: smtp (${env.smtpHost}:${env.smtpPort})`);
}

/**
 * Writes the message to a local file when SMTP is not configured, so the reset
 * flow is fully testable in development without silently dropping mail.
 */
async function writeToOutbox(message: MailMessage): Promise<void> {
  const dir = path.join(env.dataDir, 'outbox');
  await fs.mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeTo = message.to.replace(/[^a-zA-Z0-9._@-]/g, '_');
  const file = path.join(dir, `${stamp}-${safeTo}.txt`);

  await fs.writeFile(
    file,
    `To: ${message.to}\nFrom: ${env.mailFrom}\nSubject: ${message.subject}\n\n${message.text}\n`,
    { mode: 0o600 },
  );

  console.log(`[outbox] Wrote email for ${message.to} to ${file}`);
}

/**
 * Returns true when the message was handed off successfully. Callers must not
 * expose this result to unauthenticated users, since it reveals whether an
 * address is registered.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  try {
    if (transport) {
      await transport.sendMail({
        from: env.mailFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return true;
    }

    await writeToOutbox(message);
    return true;
  } catch (err) {
    console.error(`Failed to send email to ${message.to}:`, err);
    return false;
  }
}

export function buildTempPasswordEmail(
  fullName: string,
  username: string,
  password: string,
  ttlMinutes: number,
): Omit<MailMessage, 'to'> {
  return {
    subject: `${env.appName} — temporary password`,
    text:
      `Hi ${fullName},\n\n` +
      `A password reset was requested for your ${env.appName} account.\n\n` +
      `  Username:           ${username}\n` +
      `  Temporary password: ${password}\n\n` +
      `This temporary password expires in ${ttlMinutes} minutes and can only be used once — ` +
      `you will be asked to choose a new password as soon as you sign in.\n\n` +
      `If you did not request this, you can ignore this email. Your existing password was ` +
      `replaced, so contact an administrator if you are locked out.\n\n` +
      `— ${env.appName}\n`,
  };
}
