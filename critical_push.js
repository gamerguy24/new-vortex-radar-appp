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
    const where = location && location.name ? location.name : (p.areaDesc || '').split(';')[0].trim();
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
     * Send to every device a user has registered.
     *
     * A 404 or 410 means that subscription is gone for good — the push service
     * is telling us to forget it, and keeping it would mean trying forever. Any
     * other failure is transient and left alone.
     *
     * Returns { sent, dropped } so a caller can log something true.
     */
    async function sendToUser(userId, note) {
        const list = listFor(userId);
        if (!list.length) return { sent: 0, dropped: 0 };
        const payload = JSON.stringify(note);
        let sent = 0;
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
    const hasSubscribers = (userId) => listFor(userId).length > 0;

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
            return res.status(400).json({ error: 'This browser is not subscribed yet.' });
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
