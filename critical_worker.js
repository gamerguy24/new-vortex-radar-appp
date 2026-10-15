/*
 * critical_worker.js — the poller that turns NWS warnings into notifications
 * ────────────────────────────────────────────────────────────────────────────
 * Polls api.weather.gov for active alerts, works out which saved locations are
 * inside each one, and notifies the people who asked to be told.
 *
 * THE RULES THIS FOLLOWS, and why each exists:
 *
 * THE POLYGON WHEN THERE IS ONE. An alert carries both a polygon and a list
 * of zones. Zones are counties, and a county is large: a tornado warning over
 * the far corner of one is not a reason to wake somebody at the other end. So
 * when the office drew a polygon, that is what is used. Watches, hurricane and
 * winter products have NO polygon — they are issued for whole zones — and for
 * those the location's own NWS zones (looked up once from api.weather.gov/points)
 * are matched against the alert's UGC list, which is exactly what the office
 * issued it for.
 *
 * ONCE PER ALERT, PER LOCATION, PER CHANNEL. Warnings are re-issued and
 * updated constantly; the same id appears in poll after poll. What has been
 * sent is remembered until the alert expires, push and email separately, so a
 * failed email can be retried without pushing twice. An UPDATE to something
 * already sent (a continuation, an extension) is not a new warning and is not
 * re-sent unless the admin turned notifyOnUpdate on.
 *
 * NOTHING SENT TWICE ACROSS A RESTART. The sent-history is on disk, so a
 * restart picks up where it left off and delivers anything that is still in
 * effect but was never sent. Only the very first boot (no history file yet)
 * records without notifying. This used to happen on EVERY boot, which meant a
 * warning already in effect when the server restarted was never emailed at all.
 *
 * QUIET HOURS ARE NOT APPLIED TO LIFE-THREATENING ALERTS. A user can ask for
 * quiet hours, and a tornado warning ignores them. Anything else would be a
 * setting that gets somebody hurt.
 */

const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const NWS_ACTIVE = 'https://api.weather.gov/alerts/active';
const POLL_MS = 60 * 1000;               // the feed updates continuously
const PRUNE_MS = 30 * 60 * 1000;         // how often sent-history is tidied

/*
 * Is a point inside the alert's polygon?
 *
 * An alert's geometry may be a Polygon or a MultiPolygon, and a small number
 * carry no geometry at all. Those are the county-wide products; they are
 * skipped deliberately (see the header) rather than matched by zone.
 */
function hits(geometry, lat, lon) {
    if (!geometry) return false;
    try {
        const pt = turf.point([lon, lat]);
        if (geometry.type === 'Polygon') return turf.booleanPointInPolygon(pt, turf.polygon(geometry.coordinates));
        if (geometry.type === 'MultiPolygon') {
            return turf.booleanPointInPolygon(pt, turf.multiPolygon(geometry.coordinates));
        }
        return false;
    } catch (e) {
        return false;      // a malformed polygon is not a reason to stop polling
    }
}

/*
 * Does this alert cover this location? The polygon if the office drew one,
 * otherwise the zones it was issued for. `zonesFor` returns null until the
 * location's zones have been looked up; the next poll tries again.
 */
function covers(feature, loc, zonesFor) {
    const p = feature.properties || {};
    const ugc = p.geocode && Array.isArray(p.geocode.UGC) ? p.geocode.UGC : [];
    // A watched state: issued for any zone or county in it.
    if (loc.stateCode) return ugc.some((z) => z.slice(0, 2) === loc.stateCode);
    if (feature.geometry) return hits(feature.geometry, loc.lat, loc.lon);
    if (!ugc.length || !zonesFor) return false;
    const zones = zonesFor(loc);
    return !!(zones && zones.some((z) => ugc.indexOf(z) !== -1));
}

/** A cancellation or expiry notice — the warning is over, not starting. */
function isEnding(p) {
    if (p.messageType === 'Cancel') return true;
    const vtec = p.parameters && Array.isArray(p.parameters.VTEC) ? p.parameters.VTEC : [];
    return vtec.length > 0 && vtec.every((v) => /\.(CAN|EXP)\./.test(v));
}

/** Which priorities a user's notifyFor covers (the default when they have not picked types). */
function wantsPriority(prefs, priority) {
    const f = (prefs && prefs.notifyFor) || 'critical-high';
    if (f === 'all') return true;
    if (f === 'critical') return priority === 'CRITICAL';
    return priority === 'CRITICAL' || priority === 'HIGH';
}

/** HH:MM in the user's own clock, for quiet hours. */
function inQuietHours(prefs, now) {
    const q = prefs && prefs.quietHours;
    if (!q || !q.enabled || !q.start || !q.end) return false;
    const toMin = (s) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const a = toMin(q.start), b = toMin(q.end);
    if (a == null || b == null) return false;
    let mins;
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: q.timeZone || prefs.timeZone || 'UTC',
        }).format(now).split(':');
        mins = Number(parts[0]) * 60 + Number(parts[1]);
    } catch (e) {
        return false;      // an unknown zone must not silence anything
    }
    // A window that crosses midnight is the normal case for quiet hours.
    return a <= b ? (mins >= a && mins < b) : (mins >= a || mins < b);
}

function attachCriticalWorker(ctx) {
    const {
        DATA_DIR, readJson, writeJson, push, messaging,
        getLocations, getPrefs, getConfig, userAgent, zonesFor, wantsEmail,
    } = ctx;

    const SENT_FILE = path.join(DATA_DIR, 'crit_sent.json');
    // push: `${userId}|${locationId}|${alertId}` -> expiry ms; email: the same with an `e|` prefix
    const hadHistory = fs.existsSync(SENT_FILE);
    let sent = readJson(SENT_FILE, {});
    const saveSent = () => { try { writeJson(SENT_FILE, sent); } catch (e) { /* next write */ } };

    // With history on disk, nothing needs priming — see the header.
    let primed = hadHistory;
    let timer = null;
    let pruneTimer = null;
    let lastPoll = { at: 0, alerts: 0, matched: 0, notified: 0, error: null };
    let lastFeatures = [];
    const EMAIL_TRIES = 10;                  // one per poll, so ~10 minutes of retrying
    const emailTries = new Map();            // `${userId}|${alertId}` -> failed attempts

    /*
     * Which alert types this user wants, and at what priority.
     *
     * The admin config lists the eligible events; a location may narrow that
     * further. An event nobody enabled is dropped early, before any geometry
     * work, because the polygon test is the expensive part.
     */
    function eligible(event) {
        const config = getConfig() || {};
        const types = Array.isArray(config.alertTypes) ? config.alertTypes : [];
        const row = types.find((t) => t && t.name === event);
        return row && row.enabled !== false ? row : null;
    }

    function isLifeThreatening(priority, event) {
        return priority === 'CRITICAL' || /Tornado Warning|Extreme Wind|Hurricane Warning/i.test(event || '');
    }

    async function poll() {
        const started = Date.now();
        let features = [];
        try {
            const res = await fetch(NWS_ACTIVE, {
                headers: { Accept: 'application/geo+json', 'User-Agent': userAgent },
            });
            if (!res.ok) throw new Error('NWS ' + res.status);
            const body = await res.json();
            features = Array.isArray(body.features) ? body.features : [];
        } catch (e) {
            lastPoll = { at: started, alerts: 0, matched: 0, notified: 0, error: e.message };
            return;
        }

        const locationsByUser = getLocations();        // userId -> [location]
        const userIds = Object.keys(locationsByUser || {});
        const config = getConfig() || {};
        let matched = 0, notified = 0;
        lastFeatures = features;

        for (const feature of features) {
            const p = (feature && feature.properties) || {};
            const alertId = p.id;
            if (!alertId) continue;
            if (p.status && p.status !== 'Actual') continue;    // tests and exercises
            if (isEnding(p)) continue;                          // "has been cancelled"
            const row = eligible(p.event);
            if (!row) continue;

            const expires = Math.max(Date.parse(p.expires || '') || 0, Date.parse(p.ends || '') || 0)
                || (started + 60 * 60 * 1000);
            if (expires < started) continue;                    // already over

            const critical = isLifeThreatening(row.priority, p.event);
            const routing = (config.routing || {})[row.priority] || {};
            const refs = (Array.isArray(p.references) ? p.references : [])
                .map((r) => r && r.identifier).filter(Boolean);
            // Is this an update to something this key-prefix was already sent?
            const continues = (prefix) => refs.some((id) => sent[prefix + id]);

            for (const userId of userIds) {
                const canPush = !!(push && push.hasSubscribers(userId));
                const canMsg = !!(messaging && messaging.reachable(userId));
                if (!canPush && !canMsg) continue;              // nothing to send to
                const prefs = getPrefs(userId) || {};
                const pushWants = canPush && wantsPriority(prefs, row.priority);
                const emailWants = canMsg && (wantsEmail ? wantsEmail(userId, p.event) : wantsPriority(prefs, row.priority));
                if (!pushWants && !emailWants) continue;
                const locs = locationsByUser[userId] || [];
                const quiet = !critical && inQuietHours(prefs, new Date());
                // Places newly inside this alert, for ONE email naming them all.
                const fresh = [];
                // One push per warning: a watched state does not push again for a warning a saved place already did.
                let pushed = false;

                for (const loc of locs) {
                    if (!loc || loc.enabled === false) continue;
                    if (!loc.stateCode && (loc.lat == null || loc.lon == null)) continue;
                    // A location may list its own subset of events.
                    if (Array.isArray(loc.alertTypes) && loc.alertTypes.length
                        && loc.alertTypes.indexOf(p.event) === -1) continue;

                    // Push is chosen per place; email per person.
                    const pushPrefix = `${userId}|${loc.id}|`;
                    const emailPrefix = 'e|' + pushPrefix;
                    const needPush = pushWants && loc.methods && loc.methods.push === true && !sent[pushPrefix + alertId];
                    const needEmail = emailWants && !sent[emailPrefix + alertId];
                    // Saved places come before states, so this sees an earlier poll's push too.
                    if (!loc.stateCode && sent[pushPrefix + alertId]) pushed = true;
                    if (!needPush && !needEmail) continue;      // told them already

                    if (!covers(feature, loc, zonesFor)) continue;
                    matched++;

                    // Record BEFORE sending. A crash between the two should
                    // cost one notification, not deliver it on every poll for
                    // the next hour.
                    if (needPush) {
                        const update = !config.notifyOnUpdate && continues(pushPrefix);
                        sent[pushPrefix + alertId] = expires;
                        if (primed && !quiet && !update && !(loc.stateCode && pushed)) {
                            pushed = true;
                            const note = push.alertNotification(feature, loc);
                            push.sendToUser(userId, note).then((out) => {
                                if (out.sent) {
                                    console.log(`[CRIT] ${p.event} -> ${loc.name} (${out.sent} device(s))`);
                                }
                            }).catch(() => {});
                            notified++;
                        }
                    }
                    if (needEmail) {
                        const update = !config.notifyOnUpdate && continues(emailPrefix);
                        sent[emailPrefix + alertId] = expires;
                        if (primed && !quiet && !update) fresh.push(loc);
                    }
                }

                if (fresh.length) {
                    messaging.deliver(userId, { alert: feature, locations: fresh, routing })
                        .then((out) => {
                            if (out.email) {
                                emailTries.delete(`${userId}|${alertId}`);
                                console.log(`[CRIT] ${p.event} -> ${fresh.map((l) => l.name).join(', ')} (email)`);
                            } else if (out.failed) {
                                // Forget it was sent so the next poll tries again — a few times.
                                const k = `${userId}|${alertId}`;
                                const n = (emailTries.get(k) || 0) + 1;
                                emailTries.set(k, n);
                                if (n < EMAIL_TRIES) {
                                    for (const loc of fresh) delete sent[`e|${userId}|${loc.id}|${alertId}`];
                                    saveSent();
                                }
                            }
                        }).catch(() => {});
                    notified++;
                }
            }
        }

        saveSent();
        lastPoll = { at: started, alerts: features.length, matched, notified, error: null };
        if (!primed) {
            primed = true;
            console.log(`[CRIT] primed on ${features.length} active alerts; `
                + `${matched} already covered a saved location and were NOT notified`);
        }
    }

    function prune() {
        const now = Date.now();
        let gone = 0;
        for (const k of Object.keys(sent)) {
            if (sent[k] < now) { delete sent[k]; gone++; }
        }
        if (gone) saveSent();
    }

    function start() {
        if (timer) return;
        poll();
        timer = setInterval(poll, POLL_MS);
        pruneTimer = setInterval(prune, PRUNE_MS);
        console.log('[CRIT] warning poller started (' + (POLL_MS / 1000) + 's)');
    }

    function stop() {
        if (timer) { clearInterval(timer); timer = null; }
        if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }
    }

    return {
        start, stop, poll,
        status: () => ({ ...lastPoll, primed, remembered: Object.keys(sent).length }),
        // For the "Right now" check: what the last poll saw, and what was sent.
        snapshot: () => lastFeatures,
        wasSent: (key) => !!sent[key],
        eligible,
    };
}

module.exports = { attachCriticalWorker, hits, covers, isEnding, inQuietHours };
