/**
 * Verifies SMTP configuration end to end:
 *   npm run mail:test -- you@yourdomain.com
 *
 * Connects, authenticates, and sends one real message, translating the common
 * provider rejections into plain guidance instead of raw SMTP codes.
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env';

const recipient = process.argv[2] || process.env.MAIL_TEST_TO || env.smtpUser;

function mask(value: string): string {
  if (!value) return '(empty)';
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}

function explain(err: any): string {
  const code = String(err?.responseCode || err?.code || '');
  const text = String(err?.response || err?.message || '');

  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ESOCKET') {
    return (
      'Could not reach the SMTP server.\n' +
      `  - Check SMTP_HOST (${env.smtpHost || 'not set'}) and SMTP_PORT (${env.smtpPort}).\n` +
      '  - Zoho accounts are region-specific: use smtp.zoho.eu (EU), smtp.zoho.in (India),\n' +
      '    smtp.zoho.com.au (Australia), or smtp.zoho.com (US/global).\n' +
      '  - Some networks block outbound port 465/587.'
    );
  }

  if (code === '535' || code === '534' || /auth/i.test(text)) {
    return (
      'The server rejected the username or password.\n' +
      '  - SMTP_USER must be the FULL email address, not just the mailbox name.\n' +
      '  - If two-factor auth is on, you must use an application-specific password,\n' +
      '    not your normal login password.\n' +
      '  - A region mismatch also surfaces as an auth failure: an account created in the\n' +
      '    EU/India datacenter will not authenticate against smtp.zoho.com.\n' +
      '  - Free Zoho Mail plans may not include SMTP sending at all; if the credentials\n' +
      '    are definitely right, confirm your plan allows IMAP/SMTP access.'
    );
  }

  if (code === '553' || code === '551' || /relay|spoof|from address/i.test(text)) {
    return (
      'The server refused the From address.\n' +
      `  - MAIL_FROM is currently: ${env.mailFrom}\n` +
      `  - It must match the authenticated account (${env.smtpUser}) or be a verified\n` +
      '    alias / "send mail as" address on that account. Providers reject anything else.'
    );
  }

  if (code === '554' || /limit|quota/i.test(text)) {
    return 'The server accepted the login but refused the message, usually a sending limit or quota.';
  }

  return 'Unrecognised SMTP failure. The raw error is above.';
}

async function main(): Promise<void> {
  console.log('SMTP configuration');
  console.log(`  SMTP_HOST     ${env.smtpHost || '(not set)'}`);
  console.log(`  SMTP_PORT     ${env.smtpPort}`);
  console.log(`  SMTP_SECURE   ${env.smtpSecure ?? `(inferred: ${env.smtpPort === 465})`}`);
  console.log(`  SMTP_USER     ${env.smtpUser || '(not set)'}`);
  console.log(`  SMTP_PASSWORD ${mask(env.smtpPassword)}`);
  console.log(`  MAIL_FROM     ${env.mailFrom}`);
  console.log(`  sending to    ${recipient || '(none)'}\n`);

  if (!env.smtpHost) {
    console.error(
      'SMTP_HOST is not set, so the app is in outbox mode: reset emails are written to\n' +
      `${env.dataDir}\\outbox and never delivered. Set SMTP_* in backend/.env first.`,
    );
    process.exit(1);
  }

  if (!recipient) {
    console.error('No recipient. Pass one: npm run mail:test -- you@yourdomain.com');
    process.exit(1);
  }

  const transport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure ?? env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPassword } : undefined,
  });

  try {
    console.log('Connecting and authenticating…');
    await transport.verify();
    console.log('  connection and credentials accepted.\n');
  } catch (err: any) {
    console.error('  FAILED\n');
    console.error(err?.response || err?.message || err);
    console.error(`\n${explain(err)}`);
    process.exit(1);
  }

  try {
    console.log(`Sending a test message to ${recipient}…`);
    const info = await transport.sendMail({
      from: env.mailFrom,
      to: recipient,
      subject: `${env.appName} — SMTP test`,
      text:
        'This is a test message from your CAD Dispatch backend.\n\n' +
        'If you are reading this, password reset emails will reach your users.\n',
    });
    console.log(`  accepted: ${info.accepted.join(', ') || '(none)'}`);
    if (info.rejected.length) console.log(`  rejected: ${info.rejected.join(', ')}`);
    console.log('\nSMTP is working. Check the inbox (and spam) for the test message.');
  } catch (err: any) {
    console.error('  FAILED\n');
    console.error(err?.response || err?.message || err);
    console.error(`\n${explain(err)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
