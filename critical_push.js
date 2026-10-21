/*
 * critical_push.js — browser push notifications for weather alerts
 * ────────────────────────────────────────────────────────────────────────────
 * The `push` channel of the Critical Weather Alerts system: Web Push, straight
 * from this server to the browser, with no third-party notification service
 * and nothing to pay for. It is the one channel that works on a phone with the
 * app closed, which is the entire point of the feature.
 *
 * HOW WEB PUSH ACTUALLY WORKS, because the shape of this file follows from it:
 *
 *   1. The browser asks ITS OWN vendor's push service (Google, Mozilla, Apple)
 *      for an endpoint, and hands us the URL plus two keys. That is the
 *      "subscription". We store it.
 *   2. To notify, we encrypt the payload to those keys and POST it to that
 *      endpoint, signed with our VAPID identity so the push service knows who
 *      is sending.
 *   3. The vendor wakes the service worker on the device, which shows the
 *      notification. Our server is never in contact with the device.
 *
 * So: the server cannot notify a browser that has not subscribed, a
 * subscription can die at any time (uninstall, permission revoked, expiry),
 * and a dead one answers 404 or 410 — which is the signal to forget it rather
 * than an error to log. That pruning is not tidiness; without it a user who
 * reinstalls accumulates endpoints that will never deliver again.
 *
 * VAPID KEYS ARE AN IDENTITY, NOT A SECRET TO SHARE. The pair is generated
 * once, on first start, and kept in the data directory. If it is lost, every
 * existing subscription becomes undeliverable — the push services check that
 * the signature matches the key the subscription was created with — so it is
 * written once and never regenerated automatically.
 */

const path = require('path');
const webpush = require('web-push');

const MAX_SUBS_PER_USER = 8;     // a phone, a laptop, a tablet, and some slack

/*
 * The notification a warning becomes.
 *
 * Deliberately plain: event, where, and when it expires. A push notification
 * is read in a glance on a lock screen, and the one failure mode that matters
 * is saying more than the office said — so nothing here is embellished, and
 * the body is the areaDesc the National Weather Service wrote.
 */
function alertNotification(alert, location) {
    const p = (alert && alert.properties) || {};
    const event = p.event || 'Weather Alert';
    // A watched state names the counties, not just "Oklahoma".
    const stateAreas = location && location.stateCode
        ? (p.areaDesc || '').split(';').map((s) => s.trim()).filter((s) => s.endsWith(', ' + location.stateCode))
        : [];
    const where = stateAreas.length
        ? stateAreas.slice(0, 2).join('; ') + (stateAreas.length > 2 ? ` +${stateAreas.length - 2}` : '')
        : location && location.name ? location.name : (p.areaDesc || '').split(';')[0].trim();
    return {
        title: where ? `${event} — ${where}` : event,
        body: (p.headline || p.areaDesc || '').slice(0, 240),
        tag: `crit-${p.id || event}-${(location && location.id) || ''}`,
        url: '/',
        event,
        // CRITICAL alerts ask the device not to collapse them quietly.
        requireInteraction: /Tornado Warning|Extreme Wind|Hurricane Warning/i.test(event),
    };
}

function attachCriticalPush({ app, requireAuth, DATA_DIR, readJson, writeJson, subject }) {
    const VAPID_FILE = path.join(DATA_DIR, 'crit_vapid.json');
    const SUBS_FILE = path.join(DATA_DIR, 'crit_push_subs.json');   // userId -> [sub]

    /*
     * One pair, for the life of the installation.
     *
     * Regenerating it would silently orphan every subscription already out
     * there, so this only ever creates a pair that does not exist.
     */
    let vapid = readJson(VAPID_FILE, null);
    if (!vapid || !vapid.publicKey || !vapid.privateKey) {
        vapid = webpush.generateVAPIDKeys();
        try {
            writeJson(VAPID_FILE, vapid);
            console.log('[CRIT-PUSH] generated a VAPID key pair in ' + VAPID_FILE);
        } catch (e) {
            console.error('[CRIT-PUSH] could not save the VAPID keys: ' + e.message);
        }
    }
    const contact = subject || process.env.PUSH_CONTACT || 'mailto:admin@localhost';
    webpush.setVapidDetails(contact, vapid.publicKey, vapid.privateKey);

    let subs = readJson(SUBS_FILE, {});
    const saveSubs = () => { try { writeJson(SUBS_FILE, subs); } catch (e) { /* next write */ } };

    const listFor = (userId) => (Array.isArray(subs[userId]) ? subs[userId] : []);

    /** Is this shaped like a push subscription? Endpoint plus the two keys. */
    function validSub(s) {
        return !!(s && typeof s.endpoint === 'string'
            && /^https:\/\//.test(s.endpoint)
            && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string');
    }

    function addSub(userId, sub) {
        const list = listFor(userId).filter((s) => s.endpoint !== sub.endpoint);
        list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, at: Date.now() });
        // Oldest out first: the newest device is the one in the user's hand.
        subs[userId] = list.slice(-MAX_SUBS_PER_USER);
        saveSubs();
    }

    function removeSub(userId, endpoint) {
        const list = listFor(userId).filter((s) => s.endpoint !== endpoint);
        if (list.length) subs[userId] = list; else delete subs[userId];
        saveSubs();
    }

    /*
     * The Echo Radar desktop app (window.echoRadarDesktop in the page) has no
     * Web Push, so a computer running it registers here instead and polls an
     * inbox: every note sendToUser makes is also queued for the user's
     * registered desktops, and the app shows it with its own notify(). Notes
     * live 30 minutes, the same as a push's TTL, so a laptop that wakes up is
     * not handed old news; a desktop not seen for 30 days is forgotten.
     */
    const DESK_FILE = path.join(DATA_DIR, 'crit_desktop.json');   // userId -> { devices: {id: lastSeen}, inbox: [{id, at, note}] }
    const INBOX_TTL = 30 * 60 * 1000;
    const INBOX_MAX = 50;
    const DESK_IDLE = 30 * 24 * 60 * 60 * 1000;
    const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
    let desk = readJson(DESK_FILE, {});
    const saveDesk = () => { try { writeJson(DESK_FILE, desk); } catch (e) { /* next write */ } };
    let lastNoteId = 0;
    const nextNoteId = () => (lastNoteId = Math.max(Date.now(), lastNoteId + 1));

    function deskFor(userId) {
        const d = desk[userId];
        if (!d) return { devices: {}, inbox: [] };
        const now = Date.now();
        for (const [id, seen] of Object.entries(d.devices || {})) if (now - seen > DESK_IDLE) delete d.devices[id];
        d.inbox = (d.inbox || []).filter((n) => now - n.at < INBOX_TTL);
        return d;
    }
    const desktopsFor = (userId) => Object.keys(deskFor(userId).devices || {}).length;

    function queueDesktop(userId, note) {
        const count = desktopsFor(userId);
        if (!count) return 0;
        const d = desk[userId];
        d.inbox.push({ id: nextNoteId(), at: Date.now(), note });
        d.inbox = d.inbox.slice(-INBOX_MAX);
        saveDesk();
        return count;
    }

    /*
     * Send to every device a user has registered.
     *
     * A 404 or 410 means that subscription is gone for good — the push service
     * is telling us to forget it, and keeping it would mean trying forever. Any
     * other failure is transient and left alone.
     *
     * Returns { sent, dropped } so a caller can log something true; desktops
     * count as sent once the note is in their inbox.
     */
    async function sendToUser(userId, note) {
        const desktops = queueDesktop(userId, note);
        const list = listFor(userId);
        if (!list.length) return { sent: desktops, dropped: 0 };
        const payload = JSON.stringify(note);
        let sent = desktops;
        const dead = [];
        await Promise.all(list.map(async (s) => {
            try {
                await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, {
                    // High urgency so a tornado warning is not batched for
                    // delivery at the vendor's convenience.
                    urgency: note.requireInteraction ? 'high' : 'normal',
                    TTL: 1800,
                });
                sent++;
            } catch (e) {
                const code = e && e.statusCode;
                if (code === 404 || code === 410) dead.push(s.endpoint);
                else console.warn('[CRIT-PUSH] send failed (' + (code || e.message) + ')');
            }
        }));
        for (const endpoint of dead) removeSub(userId, endpoint);
        return { sent, dropped: dead.length };
    }

    /** Does this user have anywhere to send to? Used to skip work upstream. */
    const hasSubscribers = (userId) => listFor(userId).length > 0 || desktopsFor(userId) > 0;

    // ── routes ───────────────────────────────────────────────────────────────
    /*
     * The public key, which the browser needs before it can subscribe. Public
     * by design: it is an identity the push service checks, not a credential.
     */
    app.get('/api/critical/push/key', requireAuth, (req, res) => {
        res.json({ publicKey: vapid.publicKey });
    });

    app.post('/api/critical/push/subscribe', requireAuth, (req, res) => {
        const sub = req.body && req.body.subscription ? req.body.subscription : req.body;
        if (!validSub(sub)) return res.status(400).json({ error: 'That is not a push subscription.' });
        addSub(req.user.id, sub);
        res.json({ ok: true, devices: listFor(req.user.id).length });
    });

    app.post('/api/critical/push/unsubscribe', requireAuth, (req, res) => {
        const endpoint = String((req.body && req.body.endpoint) || '');
        if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
        removeSub(req.user.id, endpoint);
        res.json({ ok: true, devices: listFor(req.user.id).length });
    });

    // ── desktop app ──────────────────────────────────────────────────────────
    // A computer running the desktop app says it wants notifications. The
    // reply's cursor is the newest note now, so it starts from here rather
    // than replaying the last half hour.
    app.post('/api/critical/push/desktop/register', requireAuth, (req, res) => {
        const device = String((req.body && req.body.device) || '');
        if (!DEVICE_RE.test(device)) return res.status(400).json({ error: 'device id required' });
        const d = desk[req.user.id] = deskFor(req.user.id);
        d.devices = d.devices || {};
        d.devices[device] = Date.now();
        // Newest computer kept, like browser subscriptions.
        const ids = Object.keys(d.devices).sort((a, b) => d.devices[a] - d.devices[b]);
        for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SUBS_PER_USER))) delete d.devices[id];
        saveDesk();
        res.json({ ok: true, cursor: d.inbox.length ? d.inbox[d.inbox.length - 1].id : 0 });
    });

    app.post('/api/critical/push/desktop/unregister', requireAuth, (req, res) => {
        const device = String((req.body && req.body.device) || '');
        const d = desk[req.user.id];
        if (d && d.devices) { delete d.devices[device]; if (!Object.keys(d.devices).length) delete desk[req.user.id]; saveDesk(); }
        res.json({ ok: true });
    });

    // The app polls this; notes newer than its cursor come back for it to show.
    app.get('/api/critical/push/desktop/inbox', requireAuth, (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const device = String(req.query.device || '');
        const d = deskFor(req.user.id);
        if (!d.devices || !d.devices[device]) return res.status(404).json({ error: 'This computer is not registered for notifications.' });
        // Seen-times only matter to the 30-day forget, so they are saved hourly, not every poll.
        const seenBefore = d.devices[device];
        d.devices[device] = Date.now();
        if (Date.now() - seenBefore > 60 * 60 * 1000) saveDesk();
        const after = Number(req.query.after) || 0;
        const notes = d.inbox.filter((n) => n.id > after);
        res.json({
            notes: notes.map((n) => ({ id: n.id, title: n.note.title, body: n.note.body, url: n.note.url || '/' })),
            cursor: notes.length ? notes[notes.length - 1].id : Math.max(after, d.inbox.length ? d.inbox[d.inbox.length - 1].id : 0),
        });
    });

    /*
     * A test notification.
     *
     * Worth a route of its own: permission can be granted and a subscription
     * stored and delivery still fail — a blocked vendor endpoint, a service
     * worker that did not activate — and without this the first time anybody
     * finds out is during a tornado warning.
     */
    app.post('/api/critical/push/test', requireAuth, async (req, res) => {
        if (!hasSubscribers(req.user.id)) {
            return res.status(400).json({ error: 'This device is not subscribed yet.' });
        }
        const out = await sendToUser(req.user.id, {
            title: 'Echo Radar notifications are on',
            body: 'This is a test. Real warnings will look like this.',
            tag: 'crit-test',
            url: '/',
        });
        res.json({ ok: out.sent > 0, ...out });
    });

    return { sendToUser, hasSubscribers, alertNotification, publicKey: vapid.publicKey };
}

module.exports = { attachCriticalPush, alertNotification };
