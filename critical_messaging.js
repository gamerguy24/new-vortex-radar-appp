/*
 * critical_messaging.js — weather warnings by email and text
 * ────────────────────────────────────────────────────────────────────────────
 * The `email` and `text` channels of Critical Weather Alerts, and a paid
 * feature: both need the Email & Text Alerts subscription (billing.js). Texts
 * go out through Twilio; email through the server's own SMTP, the same
 * transport password resets use.
 *
 * THE RULES THIS FOLLOWS, and why each exists:
 *
 * NOTHING IS SENT TO AN ADDRESS NOBODY PROVED THEY OWN. Signing up sends a
 * six-digit code, and only the right code turns the channel on. Without that,
 * this is a form anybody can use to point warnings — or a stream of codes —
 * at a stranger's phone. Code sends are rate-limited for the same reason.
 *
 * TEXTS NEED EXPLICIT CONSENT. The sign-up must carry the ticked consent box,
 * its time is kept, and the first text says how to stop. When somebody replies
 * STOP, Twilio refuses further texts to them (error 21610) and their number is
 * taken off here too, so the admin list never shows somebody who opted out.
 *
 * ONE MESSAGE PER WARNING, NOT ONE PER SAVED PLACE. Home and Work inside one
 * warning is one text naming both. Every text costs money.
 *
 * SAY ONLY WHAT THE OFFICE SAID. Event, place, expiry, the issuing office —
 * and in email the office's own description and instructions, verbatim.
 *
 * NO SUBSCRIPTION, NO MESSAGES. The gate is checked again at send time, so a
 * subscription that lapses stops the messages without anybody having to tidy
 * the list.
 */

const path = require('path');
const crypto = require('crypto');

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TRIES = 5;
const SENDS_PER_HOUR = 5;          // confirmation codes, per user
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

function prettyPhone(e164) {
    const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 || '');
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
 * Twilio, over its REST API — no SDK needed for one POST.
 *
 * Authenticates with an API key (SK…) and secret, or the account's auth
 * token. Sends from a Messaging Service when one is set (Twilio then picks
 * the number and handles STOP/HELP), otherwise from TWILIO_FROM.
 */
function twilio() {
    const account = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const user = (process.env.TWILIO_API_KEY || '').trim() || account;
    const secret = (process.env.TWILIO_API_SECRET || process.env.TWILIO_AUTH_TOKEN || '').trim();
    const service = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
    const from = normPhone(process.env.TWILIO_FROM) || (process.env.TWILIO_FROM || '').trim();
    if (!account || !secret || (!service && !from)) return null;
    const auth = 'Basic ' + Buffer.from(`${user}:${secret}`).toString('base64');

    async function send(to, body) {
        const form = new URLSearchParams({ To: to, Body: body });
        if (service) form.set('MessagingServiceSid', service); else form.set('From', from);
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
            signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* no body */ }
        if (!res.ok) {
            const err = new Error(`Twilio ${res.status}${data && data.message ? ': ' + data.message : ''}`);
            err.code = data && data.code;
            throw err;
        }
        return data && data.sid;
    }
    return { send };
}

function attachCriticalMessaging({
    app, requireAuth, requireAdmin, DATA_DIR, readJson, writeJson,
    getLocations, getPrefs, getUser, hasAlerts, sendMail, mailReady,
}) {
    const tw = twilio();
    const FILE = path.join(DATA_DIR, 'crit_signups.json');
    // userId -> { account, email: { value, at } | null, sms: { value, at, consentAt } | null }
    // Only confirmed addresses are ever stored here.
    let signups = readJson(FILE, {});
    const save = () => { try { writeJson(FILE, signups); } catch (e) { /* next write */ } };
    const USAGE_FILE = path.join(DATA_DIR, 'crit_msg_usage.json');
    let usage = readJson(USAGE_FILE, {});      // 'YYYY-MM' -> { sms, email }
    let lastError = null;

    const available = () => ({ email: !!(mailReady && mailReady()), sms: !!tw });
    const paid = (userId) => !!(hasAlerts && hasAlerts(getUser(userId)));
    const kindOf = (k) => (k === 'sms' || k === 'email' ? k : null);
    const mine = (userId) => {
        const s = signups[userId] || {};
        return { email: s.email || null, sms: s.sms || null };
    };

    function remove(userId, kind) {
        const s = signups[userId];
        if (!s) return;
        s[kind] = null;
        if (!s.email && !s.sms) delete signups[userId];
        save();
    }

    function count(kind) {
        const month = new Date().toISOString().slice(0, 7);
        const row = usage[month] || (usage[month] = { sms: 0, email: 0 });
        row[kind] = (row[kind] || 0) + 1;
        try { writeJson(USAGE_FILE, usage); } catch (e) { /* next write */ }
    }

    async function sendEmail(to, subject, text) {
        if (!available().email) return { ok: false, error: 'Email is not set up on this server.' };
        if (await sendMail({ to, subject, text })) { count('email'); return { ok: true }; }
        lastError = { at: Date.now(), channel: 'email', error: 'SMTP send failed (see server log)' };
        return { ok: false, error: 'The email could not be sent.' };
    }

    /*
     * One text. `userId` is passed for alert sends so a STOP reply (Twilio
     * 21610) takes that number off the list; codes have no list entry yet.
     */
    async function sendSms(to, body, userId) {
        if (!tw) return { ok: false, error: 'Texts are not set up on this server.' };
        try {
            await tw.send(to, body);
            count('sms');
            return { ok: true };
        } catch (e) {
            lastError = { at: Date.now(), channel: 'sms', error: e.message };
            console.warn('[CRIT-MSG] text failed: ' + e.message);
            if (e.code === 21610 && userId) {
                remove(userId, 'sms');
                console.log(`[CRIT-MSG] ${prettyPhone(to)} replied STOP; removed from text alerts`);
            }
            const why = e.code === 21608 || e.code === 21219
                ? 'Twilio trial accounts can only text numbers verified in the Twilio console.'
                : e.code === 21610 ? 'This number has replied STOP. Text START to resubscribe.'
                    : 'The text could not be sent.';
            return { ok: false, error: why };
        }
    }

    // ── delivery, called by the poller ───────────────────────────────────────
    function reachable(userId) {
        const s = signups[userId];
        if (!s || !paid(userId)) return false;
        const p = getPrefs(userId) || {};
        if (p.enabled === false) return false;
        return !!((s.email && available().email) || (s.sms && available().sms));
    }

    function wantsPriority(p, priority) {
        const f = (p && p.notifyFor) || 'critical-high';
        if (f === 'all') return true;
        if (f === 'critical') return priority === 'CRITICAL';
        return priority === 'CRITICAL' || priority === 'HIGH';
    }

    /*
     * Tell one user about one warning, on whichever of email and text they
     * signed up for and the admin's per-priority routing allows.
     */
    async function deliver(userId, { alert, locations, priority, routing }) {
        const out = { email: false, sms: false };
        const s = signups[userId];
        if (!s || !locations.length || !paid(userId)) return out;
        if (!wantsPriority(getPrefs(userId), priority)) return out;
        const route = routing || {};
        const jobs = [];
        if (s.email && route.email !== false) {
            const m = emailMessage(alert, locations);
            jobs.push(sendEmail(s.email.value, m.subject, m.text).then((r) => { out.email = r.ok; }));
        }
        if (s.sms && route.text === true) {
            jobs.push(sendSms(s.sms.value, smsText(alert, locations), userId).then((r) => { out.sms = r.ok; }));
        }
        await Promise.all(jobs);
        return out;
    }

    // ── sign-up, with a confirmation code ────────────────────────────────────
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

    app.get('/api/critical/signup', requireAuth, (req, res) => {
        res.json({ ...mine(req.user.id), available: available(), subscribed: paid(req.user.id) });
    });

    app.post('/api/critical/signup', requireAuth, async (req, res) => {
        const b = req.body || {};
        const kind = kindOf(b.kind);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        if (!paid(req.user.id)) {
            return res.status(402).json({ error: 'Email & text alerts need a subscription.' });
        }
        if (!available()[kind]) {
            return res.status(503).json({ error: kind === 'sms'
                ? 'Texts are not set up on this server yet.'
                : 'Email is not set up on this server yet.' });
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

    app.post('/api/critical/signup/verify', requireAuth, (req, res) => {
        const b = req.body || {};
        const kind = kindOf(b.kind);
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
        const now = new Date().toISOString();
        const s = signups[req.user.id] || (signups[req.user.id] = {});
        s.account = req.user.email || '';
        s[kind] = kind === 'sms' ? { value: row.value, at: now, consentAt: now } : { value: row.value, at: now };
        save();
        console.log(`[CRIT-MSG] ${s.account || req.user.id} turned on ${kind === 'sms' ? 'texts' : 'email'}`);
        res.json(mine(req.user.id));
    });

    app.post('/api/critical/signup/test', requireAuth, async (req, res) => {
        const kind = kindOf(req.body && req.body.kind);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        const s = mine(req.user.id);
        if (!s[kind]) return res.status(400).json({ error: 'That is not turned on yet.' });
        const out = kind === 'sms'
            ? await sendSms(s.sms.value, `${APP_NAME}: test. Weather warning texts are on for this number. Reply STOP to opt out.`, req.user.id)
            : await sendEmail(s.email.value, `${APP_NAME} — test alert`,
                'Email weather warnings are on. Real warnings will arrive at this address.\n');
        if (!out.ok) return res.status(502).json({ error: out.error });
        res.json({ ok: true });
    });

    app.delete('/api/critical/signup/:kind', requireAuth, (req, res) => {
        const kind = kindOf(req.params.kind);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        remove(req.user.id, kind);
        res.json(mine(req.user.id));
    });

    // ── admin ────────────────────────────────────────────────────────────────
    app.get('/admin/critical/signups', requireAdmin, (req, res) => {
        const locations = getLocations() || {};
        const rows = Object.entries(signups).map(([userId, s]) => ({
            userId,
            account: s.account || '',
            subscribed: paid(userId),
            email: s.email || null,
            sms: s.sms || null,
            places: (locations[userId] || []).filter((l) => l && l.enabled !== false).map((l) => ({
                name: l.name || 'Location',
                where: [l.city, l.state].filter(Boolean).join(', ') || l.address || l.geocoded || '',
            })),
        }));
        const latest = (r) => Math.max(Date.parse((r.email && r.email.at) || 0) || 0, Date.parse((r.sms && r.sms.at) || 0) || 0);
        rows.sort((a, b) => latest(b) - latest(a));
        res.json({ signups: rows, available: available(), usage, lastError });
    });

    app.delete('/admin/critical/signups/:userId/:kind', requireAdmin, (req, res) => {
        const kind = kindOf(req.params.kind);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        if (!signups[req.params.userId]) return res.status(404).json({ error: 'No sign-up for that user.' });
        remove(req.params.userId, kind);
        res.json({ ok: true });
    });

    console.log(`[CRIT-MSG] email: ${available().email ? 'SMTP' : 'off (set SMTP_*)'}, `
        + `text: ${tw ? 'Twilio' : 'off (set TWILIO_*)'}`);

    return { available, reachable, deliver };
}

module.exports = { attachCriticalMessaging, normPhone, normEmail, smsText, emailMessage, untilText };
