/*
 * critical_worker.js — the poller that turns NWS warnings into notifications
 * ────────────────────────────────────────────────────────────────────────────
 * Polls api.weather.gov for active alerts, works out which saved locations are
 * inside each one, and notifies the people who asked to be told.
 *
 * THE RULES THIS FOLLOWS, and why each exists:
 *
 * POINT IN POLYGON, NOT ZONE MATCHING. An alert carries both a polygon and a
 * list of zones. Zones are counties, and a county is large: a tornado warning
 * over the far corner of one is not a reason to wake somebody at the other
 * end. The polygon is what the office actually drew, so that is what is used,
 * and an alert WITHOUT one is skipped rather than approximated — the whole
 * value of this is that it only fires when it should.
 *
 * ONCE PER ALERT, PER LOCATION. Warnings are re-issued and updated constantly;
 * the same id appears in poll after poll. Notifying on each would be
 * unforgivable, so what has been sent is remembered until the alert expires.
 *
 * NOTHING RETROSPECTIVE ON STARTUP. A restart must not deliver an hour of
 * warnings that were already sent — or worse, that were already over. The
 * first poll after boot only RECORDS what is active; it notifies about nothing.
 * The cost is missing a warning issued in the seconds before a restart; the
 * alternative is a phone full of history, which would teach somebody to turn
 * the feature off.
 *
 * QUIET HOURS ARE NOT APPLIED TO LIFE-THREATENING ALERTS. A user can ask for
 * quiet hours, and a tornado warning ignores them. Anything else would be a
 * setting that gets somebody hurt.
 */

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
        DATA_DIR, readJson, writeJson, push,
        getLocations, getPrefs, getConfig, userAgent,
    } = ctx;

    const SENT_FILE = path.join(DATA_DIR, 'crit_sent.json');
    // key `${userId}|${locationId}|${alertId}` -> expiry ms
    let sent = readJson(SENT_FILE, {});
    const saveSent = () => { try { writeJson(SENT_FILE, sent); } catch (e) { /* next write */ } };

    let primed = false;        // has the first poll run?
    let timer = null;
    let pruneTimer = null;
    let lastPoll = { at: 0, alerts: 0, matched: 0, notified: 0, error: null };

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
        let matched = 0, notified = 0;

        for (const feature of features) {
            const p = (feature && feature.properties) || {};
            const alertId = p.id;
            if (!alertId || !feature.geometry) continue;        // see the header
            const row = eligible(p.event);
            if (!row) continue;

            const expires = Date.parse(p.expires || p.ends || '') || (started + 60 * 60 * 1000);
            if (expires < started) continue;                    // already over

            for (const userId of userIds) {
                if (!push.hasSubscribers(userId)) continue;     // nothing to send to
                const prefs = getPrefs(userId) || {};
                const locs = locationsByUser[userId] || [];

                for (const loc of locs) {
                    if (!loc || loc.enabled === false) continue;
                    if (loc.lat == null || loc.lon == null) continue;
                    if (!loc.methods || loc.methods.push !== true) continue;
                    // A location may list its own subset of events.
                    if (Array.isArray(loc.alertTypes) && loc.alertTypes.length
                        && loc.alertTypes.indexOf(p.event) === -1) continue;

                    const key = `${userId}|${loc.id}|${alertId}`;
                    if (sent[key]) continue;                    // told them already

                    if (!hits(feature.geometry, loc.lat, loc.lon)) continue;
                    matched++;

                    // Record BEFORE sending. A crash between the two should
                    // cost one notification, not deliver it on every poll for
                    // the next hour.
                    sent[key] = expires;

                    if (!primed) continue;                      // first pass only records

                    const critical = isLifeThreatening(row.priority, p.event);
                    if (!critical && inQuietHours(prefs, new Date())) continue;

                    const note = push.alertNotification(feature, loc);
                    push.sendToUser(userId, note).then((out) => {
                        if (out.sent) {
                            console.log(`[CRIT] ${p.event} -> ${loc.name} (${out.sent} device(s))`);
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

    return { start, stop, poll, status: () => ({ ...lastPoll, primed, remembered: Object.keys(sent).length }) };
}

module.exports = { attachCriticalWorker, hits, inQuietHours };
