/*
 * critical_messaging.js — weather warnings by email
 * ────────────────────────────────────────────────────────────────────────────
 * The `email` channel of Critical Weather Alerts, and a paid feature: it
 * needs the Email Alerts subscription (billing.js). Mail goes out through the
 * server's own SMTP — the same transport password resets use — so there is no
 * third-party messaging service involved.
 *
 * THE RULES THIS FOLLOWS, and why each exists:
 *
 * NOTHING IS SENT TO AN ADDRESS NOBODY PROVED THEY OWN. Signing up sends a
 * six-digit code, and only the right code turns email on. Without that, this
 * is a form anybody can use to point warnings — or a stream of codes — at a
 * stranger's inbox. Code sends are rate-limited for the same reason.
 *
 * ONE EMAIL PER WARNING, NOT ONE PER SAVED PLACE. Home and Work inside one
 * warning is one email naming both.
 *
 * SAY ONLY WHAT THE OFFICE SAID. Event, place, expiry, the issuing office, and
 * the office's own description and instructions, verbatim.
 *
 * NO SUBSCRIPTION, NO EMAIL. The gate is checked again at send time, so a
 * subscription that lapses stops the mail without anybody tidying the list.
 */

const path = require('path');
const crypto = require('crypto');

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TRIES = 5;
const SENDS_PER_HOUR = 5;          // confirmation codes, per user
const RESEND_GAP_MS = 60 * 1000;

const APP_NAME = process.env.APP_NAME || 'Echo Radar';
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');

function normEmail(v) {
    const s = String(v == null ? '' : v).trim().slice(0, 200);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/*
 * "7:45 PM", read straight from the alert's own timestamp. NWS writes times
 * in the issuing office's offset — the clock the people under the warning are
 * on — so the wall-clock part is used as-is.
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

function attachCriticalMessaging({
    app, requireAuth, requireAdmin, DATA_DIR, readJson, writeJson,
    getLocations, getPrefs, getUser, hasAlerts, sendMail, mailReady, mailError,
}) {
    const FILE = path.join(DATA_DIR, 'crit_signups.json');
    // userId -> { account, email: { value, at } | null }. Only confirmed addresses.
    let signups = readJson(FILE, {});
    const save = () => { try { writeJson(FILE, signups); } catch (e) { /* next write */ } };
    const USAGE_FILE = path.join(DATA_DIR, 'crit_msg_usage.json');
    let usage = readJson(USAGE_FILE, {});      // 'YYYY-MM' -> { email }
    let lastError = null;

    const available = () => !!(mailReady && mailReady());
    const paid = (userId) => !!(hasAlerts && hasAlerts(getUser(userId)));
    const emailOf = (userId) => (signups[userId] && signups[userId].email) || null;

    function remove(userId) {
        if (!signups[userId]) return;
        delete signups[userId];
        save();
    }

    function count() {
        const month = new Date().toISOString().slice(0, 7);
        const row = usage[month] || (usage[month] = { email: 0 });
        row.email = (row.email || 0) + 1;
        try { writeJson(USAGE_FILE, usage); } catch (e) { /* next write */ }
    }

    async function sendEmail(to, subject, text) {
        if (!available()) return { ok: false, error: 'Email is not set up on this server.' };
        if (await sendMail({ to, subject, text })) { count(); return { ok: true }; }
        const detail = (mailError && mailError()) || 'SMTP send failed (see server log)';
        lastError = { at: Date.now(), error: detail };
        return { ok: false, error: 'The email could not be sent.', detail };
    }

    // ── delivery, called by the poller ───────────────────────────────────────
    function reachable(userId) {
        if (!emailOf(userId) || !available() || !paid(userId)) return false;
        const p = getPrefs(userId) || {};
        return p.enabled !== false;
    }

    function wantsPriority(p, priority) {
        const f = (p && p.notifyFor) || 'critical-high';
        if (f === 'all') return true;
        if (f === 'critical') return priority === 'CRITICAL';
        return priority === 'CRITICAL' || priority === 'HIGH';
    }

    /** Email one user about one warning, if the admin's routing allows email at this priority. */
    async function deliver(userId, { alert, locations, priority, routing }) {
        const out = { email: false };
        const to = emailOf(userId);
        if (!to || !locations.length || !paid(userId)) return out;
        if (!wantsPriority(getPrefs(userId), priority)) return out;
        if (routing && routing.email === false) return out;
        const m = emailMessage(alert, locations);
        out.email = (await sendEmail(to.value, m.subject, m.text)).ok;
        return out;
    }

    /*
     * The message for a failed send. 500, not 502: Cloudflare replaces a 502
     * from the origin with its own page, so the browser only ever saw
     * "HTTP 502". An admin also gets the mail server's own reason, which is
     * what actually says how to fix it.
     */
    function failure(req, out) {
        return req.user && req.user.isAdmin && out.detail ? `${out.error} (${out.detail})` : out.error;
    }

    // ── sign-up, with a confirmation code ────────────────────────────────────
    const pending = new Map();      // userId -> { value, code, expires, tries }
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

    app.get('/api/critical/signup', requireAuth, (req, res) => {
        res.json({ email: emailOf(req.user.id), available: available(), subscribed: paid(req.user.id) });
    });

    app.post('/api/critical/signup', requireAuth, async (req, res) => {
        if (!paid(req.user.id)) return res.status(402).json({ error: 'Email alerts need a subscription.' });
        if (!available()) return res.status(503).json({ error: 'Email is not set up on this server yet.' });
        const value = normEmail(req.body && req.body.value);
        if (!value) return res.status(400).json({ error: 'That does not look like an email address.' });
        const wait = throttled(req.user.id);
        if (wait) return res.status(429).json({ error: wait });

        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        pending.set(req.user.id, { value, code, expires: Date.now() + CODE_TTL_MS, tries: 0 });
        const sent = await sendEmail(value, `${APP_NAME} — your confirmation code`,
            `Your ${APP_NAME} confirmation code is ${code}\n\n`
            + 'Enter it in Alert Notifications to start getting weather warnings by email. '
            + 'It expires in 10 minutes.\n\nIf you did not ask for this, ignore this email.\n');
        if (!sent.ok) {
            pending.delete(req.user.id);
            return res.status(500).json({ error: failure(req, sent) });
        }
        res.json({ ok: true, sentTo: value });
    });

    app.post('/api/critical/signup/verify', requireAuth, (req, res) => {
        const row = pending.get(req.user.id);
        if (!row || row.expires < Date.now()) {
            pending.delete(req.user.id);
            return res.status(400).json({ error: 'That code has expired. Send a new one.' });
        }
        if (String((req.body && req.body.code) || '').replace(/\D/g, '') !== row.code) {
            row.tries++;
            if (row.tries >= CODE_TRIES) pending.delete(req.user.id);
            return res.status(400).json({ error: row.tries >= CODE_TRIES
                ? 'Too many wrong tries. Send a new code.'
                : 'That code is not right.' });
        }
        pending.delete(req.user.id);
        signups[req.user.id] = { account: req.user.email || '', email: { value: row.value, at: new Date().toISOString() } };
        save();
        console.log(`[CRIT-MSG] ${req.user.email || req.user.id} turned on email alerts`);
        res.json({ email: emailOf(req.user.id) });
    });

    app.post('/api/critical/signup/test', requireAuth, async (req, res) => {
        const to = emailOf(req.user.id);
        if (!to) return res.status(400).json({ error: 'Email alerts are not turned on yet.' });
        const out = await sendEmail(to.value, `${APP_NAME} — test alert`,
            'Email weather warnings are on. Real warnings will arrive at this address.\n');
        if (!out.ok) return res.status(500).json({ error: failure(req, out) });
        res.json({ ok: true });
    });

    app.delete('/api/critical/signup', requireAuth, (req, res) => {
        remove(req.user.id);
        res.json({ email: null });
    });

    // ── admin ────────────────────────────────────────────────────────────────
    app.get('/admin/critical/signups', requireAdmin, (req, res) => {
        const locations = getLocations() || {};
        const rows = Object.entries(signups).filter(([, s]) => s && s.email).map(([userId, s]) => ({
            userId,
            account: s.account || '',
            subscribed: paid(userId),
            email: s.email,
            places: (locations[userId] || []).filter((l) => l && l.enabled !== false).map((l) => ({
                name: l.name || 'Location',
                where: [l.city, l.state].filter(Boolean).join(', ') || l.address || l.geocoded || '',
            })),
        }));
        rows.sort((a, b) => (Date.parse(b.email.at) || 0) - (Date.parse(a.email.at) || 0));
        res.json({ signups: rows, available: available(), usage, lastError });
    });

    app.delete('/admin/critical/signups/:userId', requireAdmin, (req, res) => {
        if (!signups[req.params.userId]) return res.status(404).json({ error: 'No sign-up for that user.' });
        remove(req.params.userId);
        res.json({ ok: true });
    });

    console.log(`[CRIT-MSG] email alerts: ${available() ? 'SMTP' : 'off (set SMTP_*)'}`);

    return { available, reachable, deliver };
}

module.exports = { attachCriticalMessaging, normEmail, emailMessage, untilText };
