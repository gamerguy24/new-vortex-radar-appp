/*
 * critical_messaging.js — email and text-message alerts
 * ────────────────────────────────────────────────────────────────────────────
 * The `email` and `text` channels of Critical Weather Alerts. Both go out
 * through AlertRanger (alertranger.com) when ALERTRANGER_API_KEY is set; email
 * falls back to the server's own SMTP (the same transport password resets
 * use) when AlertRanger is not configured or refuses a message. Text has no
 * fallback — the carrier email-to-SMS gateways the original plan leaned on
 * have mostly been switched off.
 *
 * THE RULES THIS FOLLOWS, and why each exists:
 *
 * NOTHING IS SENT TO AN ADDRESS NOBODY PROVED THEY OWN. Signing up sends a
 * six-digit code to the address or number, and only a correct code turns the
 * channel on. Without that, this is a form anybody can use to point tornado
 * warnings — or, worse, a stream of verification codes — at a stranger's
 * phone. The code sends are rate-limited for the same reason.
 *
 * TEXTS NEED EXPLICIT CONSENT. The sign-up must carry a ticked consent box,
 * the time is recorded, and the first message says how to stop. That is what
 * US carriers require of anyone sending alerts by SMS, not a nicety.
 *
 * ONE MESSAGE PER WARNING, NOT ONE PER SAVED PLACE. Somebody whose Home and
 * Work are both inside a warning gets one text naming both. Texts are counted
 * against a monthly allowance (100 on AlertRanger's free plan), so sending two
 * would halve how many warnings a person can be told about.
 *
 * SAY ONLY WHAT THE OFFICE SAID. Event, place, expiry, the issuing office —
 * and in email the office's own description and instructions, verbatim.
 */

const path = require('path');
const crypto = require('crypto');

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TRIES = 5;
const SENDS_PER_HOUR = 5;          // verification codes, per user
const RESEND_GAP_MS = 60 * 1000;
const PROVIDER_TIMEOUT_MS = 15 * 1000;

const APP_NAME = process.env.APP_NAME || 'Echo Radar';
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');

/** US numbers only — NWS warnings are US-only. Returns E.164 or null. */
function normPhone(v) {
    const d = String(v == null ? '' : v).replace(/\D/g, '');
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d[0] === '1') return '+' + d;
    return null;
}

function normEmail(v) {
    const s = String(v == null ? '' : v).trim().slice(0, 200);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/** "(555) 123-4567" for showing a number back to its owner. */
function prettyPhone(e164) {
    const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 || '');
}

/*
 * "7:45 PM", read straight from the alert's own timestamp.
 *
 * NWS writes times in the issuing office's local offset, which is the clock
 * the people under the warning are on — so the wall-clock part is used as-is
 * rather than converted to the server's zone.
 */
function untilText(p) {
    const m = /T(\d{2}):(\d{2})/.exec(p.ends || p.expires || '');
    if (!m) return '';
    const h = Number(m[1]);
    return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

function placeNames(locations) {
    const names = locations.map((l) => (l && l.name) || 'your saved place');
    if (names.length <= 2) return names.join(' and ');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function smsText(alert, locations) {
    const p = (alert && alert.properties) || {};
    const until = untilText(p);
    return [
        `${APP_NAME}: ${p.event || 'Weather warning'} for ${placeNames(locations)}`
            + (until ? ` until ${until}.` : '.'),
        p.senderName ? `Issued by ${p.senderName}.` : '',
        APP_URL ? `Radar: ${APP_URL}` : '',
    ].filter(Boolean).join(' ').slice(0, 300);
}

function emailMessage(alert, locations) {
    const p = (alert && alert.properties) || {};
    const until = untilText(p);
    const subject = `${p.event || 'Weather warning'} — ${placeNames(locations)}`;
    const text = [
        p.headline || p.event || 'Weather warning',
        '',
        `Your saved ${locations.length > 1 ? 'places' : 'place'} inside this warning: ${placeNames(locations)}`,
        until ? `In effect until ${until} local time.` : '',
        '',
        p.description || '',
        p.instruction ? '\n' + p.instruction : '',
        '',
        p.senderName ? `Issued by ${p.senderName}.` : '',
        APP_URL ? `Open the radar: ${APP_URL}` : '',
        '',
        `You get these because you turned on email alerts in ${APP_NAME} (menu › Alert Notifications).`
            + ' You can turn them off there at any time.',
    ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
    return { subject, text };
}

/*
 * The AlertRanger adapter.
 *
 * Everything that depends on the shape of AlertRanger's API is in this one
 * function, so matching it to their documentation is a change here and
 * nowhere else. The endpoint, path and sender are environment variables for
 * the same reason.
 */
function alertRanger() {
    const key = (process.env.ALERTRANGER_API_KEY || '').trim();
    if (!key) return null;
    const base = (process.env.ALERTRANGER_API_URL || 'https://app.alertranger.com/api').replace(/\/+$/, '');
    const sendPath = process.env.ALERTRANGER_SEND_PATH || '/v1/messages';
    const sender = (process.env.ALERTRANGER_SENDER || '').trim();

    async function send(channel, to, subject, text) {
        const res = await fetch(base + sendPath, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                channel,                         // 'sms' | 'email'
                to,
                subject: channel === 'email' ? subject : undefined,
                message: text,
                sender: sender || undefined,
            }),
            signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
        if (!res.ok) {
            let detail = '';
            try { detail = (await res.text()).slice(0, 200); } catch (e) { /* no body */ }
            throw new Error(`AlertRanger ${res.status}${detail ? ': ' + detail : ''}`);
        }
        return true;
    }
    return { send };
}

function attachCriticalMessaging({
    app, requireAuth, requireAdmin, DATA_DIR, readJson, writeJson,
    getPrefs, updatePrefs, sendMail, mailReady,
}) {
    const ar = alertRanger();
    const USAGE_FILE = path.join(DATA_DIR, 'crit_msg_usage.json');
    let usage = readJson(USAGE_FILE, {});      // 'YYYY-MM' -> { sms, email }
    let lastError = null;

    const available = () => ({ email: !!ar || !!(mailReady && mailReady()), sms: !!ar });

    function count(kind) {
        const month = new Date().toISOString().slice(0, 7);
        const row = usage[month] || (usage[month] = { sms: 0, email: 0 });
        row[kind] = (row[kind] || 0) + 1;
        try { writeJson(USAGE_FILE, usage); } catch (e) { /* next write */ }
    }

    async function sendEmail(to, subject, text) {
        if (ar) {
            try {
                await ar.send('email', to, subject, text);
                count('email');
                return { ok: true, via: 'alertranger' };
            } catch (e) {
                lastError = { at: Date.now(), channel: 'email', error: e.message };
                console.warn('[CRIT-MSG] AlertRanger email failed: ' + e.message);
            }
        }
        if (sendMail && mailReady && mailReady() && await sendMail({ to, subject, text })) {
            count('email');
            return { ok: true, via: 'smtp' };
        }
        return { ok: false, error: 'Email could not be sent.' };
    }

    async function sendSms(to, text) {
        if (!ar) return { ok: false, error: 'Text alerts are not set up on this server.' };
        try {
            await ar.send('sms', to, null, text);
            count('sms');
            return { ok: true, via: 'alertranger' };
        } catch (e) {
            lastError = { at: Date.now(), channel: 'sms', error: e.message };
            console.warn('[CRIT-MSG] AlertRanger text failed: ' + e.message);
            return { ok: false, error: 'The text could not be sent.' };
        }
    }

    // ── who is reachable, and on what ────────────────────────────────────────
    function emailOn(p) {
        return !!(p && p.email && p.emailVerified && !(p.methods && p.methods.email === false));
    }
    function textOn(p) {
        return !!(p && p.phone && p.phoneVerified && p.phoneConsentAt && p.methods && p.methods.text === true);
    }
    function reachable(userId) {
        const p = getPrefs(userId);
        if (!p || p.enabled === false) return false;
        return (emailOn(p) && available().email) || (textOn(p) && available().sms);
    }

    /** Does this user want to hear about a warning of this priority at all? */
    function wantsPriority(p, priority) {
        const f = p.notifyFor || 'critical-high';
        if (f === 'all') return true;
        if (f === 'critical') return priority === 'CRITICAL';
        return priority === 'CRITICAL' || priority === 'HIGH';
    }

    /*
     * Tell one user about one warning, on whichever of email and text they
     * have turned on and the admin routing allows at this priority.
     */
    async function deliver(userId, { alert, locations, priority, routing }) {
        const p = getPrefs(userId);
        if (!p || p.enabled === false || !locations.length) return { email: false, sms: false };
        if (!wantsPriority(p, priority)) return { email: false, sms: false };
        const route = routing || {};
        const out = { email: false, sms: false };
        const jobs = [];
        if (emailOn(p) && route.email !== false) {
            const m = emailMessage(alert, locations);
            jobs.push(sendEmail(p.email, m.subject, m.text).then((r) => { out.email = r.ok; }));
        }
        if (textOn(p) && route.text === true) {
            jobs.push(sendSms(p.phone, smsText(alert, locations)).then((r) => { out.sms = r.ok; }));
        }
        await Promise.all(jobs);
        return out;
    }

    // ── sign-up: verification codes ──────────────────────────────────────────
    const pending = new Map();      // `${userId}|${kind}` -> { value, code, expires, tries }
    const sends = new Map();        // userId -> [timestamps]

    function throttled(userId) {
        const now = Date.now();
        const list = (sends.get(userId) || []).filter((t) => now - t < 60 * 60 * 1000);
        sends.set(userId, list);
        if (list.length && now - list[list.length - 1] < RESEND_GAP_MS) {
            return 'Wait a minute before asking for another code.';
        }
        if (list.length >= SENDS_PER_HOUR) return 'Too many codes requested. Try again in an hour.';
        list.push(now);
        return null;
    }

    const kindOf = (b) => (b && (b.kind === 'sms' || b.kind === 'email') ? b.kind : null);

    app.post('/api/critical/contact/start', requireAuth, async (req, res) => {
        const b = req.body || {};
        const kind = kindOf(b);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        if (!available()[kind]) {
            return res.status(503).json({ error: kind === 'sms'
                ? 'Text alerts are not set up on this server yet.'
                : 'Email alerts are not set up on this server yet.' });
        }
        const value = kind === 'sms' ? normPhone(b.value) : normEmail(b.value);
        if (!value) {
            return res.status(400).json({ error: kind === 'sms'
                ? 'Enter a 10-digit US mobile number.'
                : 'That does not look like an email address.' });
        }
        if (kind === 'sms' && b.consent !== true) {
            return res.status(400).json({ error: 'Tick the box to agree to receive text alerts.' });
        }
        const wait = throttled(req.user.id);
        if (wait) return res.status(429).json({ error: wait });

        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        pending.set(`${req.user.id}|${kind}`, { value, code, expires: Date.now() + CODE_TTL_MS, tries: 0 });

        const sent = kind === 'sms'
            ? await sendSms(value, `${APP_NAME} code: ${code}. Enter it to turn on weather warning texts. `
                + 'Msg & data rates may apply. Reply STOP to opt out.')
            : await sendEmail(value, `${APP_NAME} — your confirmation code`,
                `Your ${APP_NAME} confirmation code is ${code}\n\n`
                + 'Enter it in Alert Notifications to start getting weather warnings by email. '
                + 'It expires in 10 minutes.\n\nIf you did not ask for this, ignore this email.\n');
        if (!sent.ok) {
            pending.delete(`${req.user.id}|${kind}`);
            return res.status(502).json({ error: sent.error });
        }
        res.json({ ok: true, sentTo: kind === 'sms' ? prettyPhone(value) : value });
    });

    app.post('/api/critical/contact/verify', requireAuth, (req, res) => {
        const b = req.body || {};
        const kind = kindOf(b);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        const key = `${req.user.id}|${kind}`;
        const row = pending.get(key);
        if (!row || row.expires < Date.now()) {
            pending.delete(key);
            return res.status(400).json({ error: 'That code has expired. Send a new one.' });
        }
        if (String(b.code || '').replace(/\D/g, '') !== row.code) {
            row.tries++;
            if (row.tries >= CODE_TRIES) pending.delete(key);
            return res.status(400).json({ error: row.tries >= CODE_TRIES
                ? 'Too many wrong tries. Send a new code.'
                : 'That code is not right.' });
        }
        pending.delete(key);
        const cur = getPrefs(req.user.id) || {};
        const methods = { ...(cur.methods || {}) };
        if (kind === 'sms') {
            methods.text = true;
            updatePrefs(req.user.id, {
                phone: row.value, phoneVerified: true,
                phoneConsentAt: new Date().toISOString(), methods,
            });
        } else {
            methods.email = true;
            updatePrefs(req.user.id, { email: row.value, emailVerified: true, methods });
        }
        res.json({ ok: true });
    });

    /*
     * Stop. For text this also withdraws consent, so turning it back on means
     * agreeing — and confirming the number — again.
     */
    app.post('/api/critical/contact/off', requireAuth, (req, res) => {
        const kind = kindOf(req.body);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        const cur = getPrefs(req.user.id) || {};
        const methods = { ...(cur.methods || {}) };
        if (kind === 'sms') {
            methods.text = false;
            updatePrefs(req.user.id, { phoneVerified: false, phoneConsentAt: null, methods });
        } else {
            methods.email = false;
            updatePrefs(req.user.id, { emailVerified: false, methods });
        }
        res.json({ ok: true });
    });

    app.post('/api/critical/contact/test', requireAuth, async (req, res) => {
        const kind = kindOf(req.body);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        const p = getPrefs(req.user.id) || {};
        if (kind === 'sms' ? !textOn(p) : !emailOn(p)) {
            return res.status(400).json({ error: 'That is not turned on yet.' });
        }
        const out = kind === 'sms'
            ? await sendSms(p.phone, `${APP_NAME}: test. Weather warning texts are on for this number. Reply STOP to opt out.`)
            : await sendEmail(p.email, `${APP_NAME} — test alert`,
                'Email weather warnings are on. Real warnings will arrive at this address.\n');
        if (!out.ok) return res.status(502).json({ error: out.error });
        res.json({ ok: true });
    });

    /*
     * For the admin: is the provider configured, how much has been sent this
     * month, and the last thing that went wrong. The first place to look when
     * somebody says a text never came.
     */
    app.get('/admin/critical/messaging', requireAdmin, (req, res) => {
        res.json({
            alertranger: !!ar,
            smtp: !!(mailReady && mailReady()),
            available: available(),
            usage,
            lastError,
        });
    });

    console.log(`[CRIT-MSG] email: ${available().email ? (ar ? 'AlertRanger' : 'SMTP') : 'off'}, `
        + `text: ${available().sms ? 'AlertRanger' : 'off (set ALERTRANGER_API_KEY)'}`);

    return { available, reachable, deliver, status: () => ({ available: available(), lastError }) };
}

module.exports = { attachCriticalMessaging, normPhone, normEmail, smsText, emailMessage, untilText };
