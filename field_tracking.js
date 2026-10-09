/*
 * field_tracking.js — tracking chasers in the field, by consent
 * ────────────────────────────────────────────────────────────────────────────
 * A chaser turns sharing on; their phone reports its position while the app is
 * open; the owner sees them on a map. That is the whole feature. Everything
 * below exists to keep one promise:
 *
 *   A CHASER'S LOCATION IS VISIBLE TO THE OWNER AND TO NOBODY ELSE.
 *
 * Not to other chasers, not to other admins, not to anyone who finds a URL.
 * That promise is the reason to be careful here, so it is enforced in one
 * place — isOwner() — and every read path goes through it. There is no
 * endpoint that returns somebody else's position to a non-owner, including by
 * accident: the two list endpoints are owner-only, and the chaser's own status
 * endpoint returns only their own record.
 *
 * Why it is NOT built on /api/stream/live, which already carries positions:
 * that one is deliberately visible to every signed-in user so chasers can see
 * each other, and it only runs while someone is broadcasting. This is the
 * opposite on both counts — private, and nothing to do with streaming — so
 * sharing the store would have meant one bug away from publishing it.
 *
 * ── CONSENT. Sharing is off until the chaser turns it on, the moment of
 *    consent is recorded with the account that gave it, and turning it off
 *    both stops the reporting and deletes the trail. A chaser can also wipe
 *    their trail while still sharing. The owner cannot turn sharing on for
 *    somebody else; there is no endpoint for it, by design.
 *
 * ── THE TRAIL is a rolling window (TRAIL_MS, four hours), thinned to one
 *    point per TRAIL_MIN_GAP_MS so a long drive cannot grow without bound,
 *    and pruned on every write rather than by a timer — a timer would leave
 *    the data sitting there if it ever failed to run.
 *
 * ── GOING STALE. A phone that loses signal, locks, or has the browser
 *    backgrounded simply stops reporting; there is no event for it. So a
 *    chaser who has not reported for STALE_MS is shown as stale rather than
 *    silently frozen at their last position, which otherwise reads as a
 *    chaser parked somewhere they left an hour ago. After GONE_MS they drop
 *    off the list but stay enrolled, so getting signal back resumes them.
 *
 * Attached from server.js:
 *   attachFieldTracking({ app, requireAuth, DATA_DIR, readJson, writeJson,
 *                         SUPER_ADMIN_EMAIL })
 */

const path = require('path');

const TRAIL_MS = 4 * 60 * 60 * 1000;   // how much history is kept at all
const TRAIL_MIN_GAP_MS = 20 * 1000;    // thinning: one kept point per 20s
const TRAIL_MAX_POINTS = 900;          // a hard ceiling whatever the maths says
const STALE_MS = 3 * 60 * 1000;        // no word for 3 min -> flagged stale
const GONE_MS = 45 * 60 * 1000;        // no word for 45 min -> off the list
const MIN_PING_GAP_MS = 2000;          // ignore a client reporting faster than this

/* A position only means something with sane numbers behind it. */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

function attachFieldTracking({ app, requireAuth, DATA_DIR, readJson, writeJson, SUPER_ADMIN_EMAIL }) {
    const FILE = path.join(DATA_DIR, 'field_tracking.json');

    /*
     * userId -> {
     *   email, name,
     *   sharing, consentAt, revokedAt,
     *   label,                       // what the chaser calls themselves
     *   now:   { lat, lng, acc, speed, heading, alt, battery, at },
     *   trail: [ { lat, lng, at }, … ],
     *   startedAt, updatedAt,
     * }
     */
    let store = readJson(FILE, {});
    if (!store || typeof store !== 'object' || Array.isArray(store)) store = {};
    const save = () => writeJson(FILE, store);

    /*
     * The single gate. The owner is one named account, not a role: "only me"
     * was the requirement, and isAdmin is a role other people can hold.
     *
     * Compared on the account's email because that is what identifies the
     * owner across a rebuilt user store — an id would not survive one.
     */
    const ownerEmail = String(SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
    const isOwner = (user) =>
        !!user && !!ownerEmail && String(user.email || '').trim().toLowerCase() === ownerEmail;

    function requireOwner(req, res, next) {
        if (!isOwner(req.user)) {
            // Deliberately the same answer whether or not anybody is being
            // tracked: a 404-vs-403 difference would tell a caller that the
            // feature is in use, which is itself about the chasers.
            return res.status(403).json({ error: 'Not available on this account.' });
        }
        next();
    }

    /* ── the trail ──────────────────────────────────────────────────────────
     * Pruned on write, not on a schedule. A cleanup timer that silently stops
     * leaves months of positions on disk, and nobody finds out until they
     * look — which for location data is the wrong way round.
     */
    function addToTrail(rec, point) {
        const trail = Array.isArray(rec.trail) ? rec.trail : [];
        const last = trail[trail.length - 1];
        if (!last || point.at - last.at >= TRAIL_MIN_GAP_MS) trail.push(point);
        else trail[trail.length - 1] = point;     // keep the freshest of the gap

        const cutoff = point.at - TRAIL_MS;
        let kept = trail.filter((p) => p.at >= cutoff);
        if (kept.length > TRAIL_MAX_POINTS) kept = kept.slice(kept.length - TRAIL_MAX_POINTS);
        rec.trail = kept;
    }

    const ageOf = (rec) => (rec && rec.now && rec.now.at ? Date.now() - rec.now.at : null);

    /* What the owner sees for one chaser. */
    function publicChaser(uid, rec, { trail }) {
        const age = ageOf(rec);
        return {
            id: uid,
            name: rec.label || rec.name || (rec.email || '').split('@')[0] || 'Chaser',
            email: rec.email || '',
            lat: rec.now.lat,
            lng: rec.now.lng,
            accuracy: rec.now.acc == null ? null : rec.now.acc,
            speed: rec.now.speed == null ? null : rec.now.speed,
            heading: rec.now.heading == null ? null : rec.now.heading,
            altitude: rec.now.alt == null ? null : rec.now.alt,
            battery: rec.now.battery == null ? null : rec.now.battery,
            at: rec.now.at,
            ageMs: age,
            stale: age != null && age > STALE_MS,
            startedAt: rec.startedAt || null,
            consentAt: rec.consentAt || null,
            trail: trail ? (rec.trail || []).map((p) => [p.lng, p.lat]) : undefined,
        };
    }

    /* Everyone currently sharing and heard from recently. */
    function activeChasers({ trail }) {
        const out = [];
        for (const [uid, rec] of Object.entries(store)) {
            if (!rec || !rec.sharing || !rec.now) continue;
            const age = ageOf(rec);
            if (age == null || age > GONE_MS) continue;
            out.push(publicChaser(uid, rec, { trail }));
        }
        // Freshest first: on a busy day the list is read at a glance.
        out.sort((a, b) => (b.at || 0) - (a.at || 0));
        return out;
    }

    /* ── live push to the owner ─────────────────────────────────────────────
     * The owner's map should move when a chaser moves, not up to a poll later.
     * Same SSE shape as /api/reports/stream. Only the owner can hold one of
     * these, which is checked when it is opened AND again on every frame, so
     * a session that stops being the owner stops receiving.
     */
    const ownerClients = new Set();

    function pushToOwner(event, data) {
        if (!ownerClients.size) return;
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of [...ownerClients]) {
            if (!isOwner(client.user)) { ownerClients.delete(client); continue; }
            try { client.res.write(frame); } catch (e) { ownerClients.delete(client); }
        }
    }

    app.get('/api/tracking/stream', requireAuth, requireOwner, (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.write('retry: 5000\n\n');
        res.write(': connected\n\n');

        const client = { res, user: req.user };
        ownerClients.add(client);

        const ping = setInterval(() => {
            try { res.write(': ping\n\n'); } catch (e) { /* cleaned below */ }
        }, 25000);
        const close = () => { clearInterval(ping); ownerClients.delete(client); };
        req.on('close', close);
        req.on('error', close);
    });

    /* ── the chaser's side ──────────────────────────────────────────────────
     * What this account is doing right now, and who can see it. The viewer is
     * named rather than described: "shared with the owner" tells a chaser
     * nothing they can check, and this is the screen where they decide.
     */
    app.get('/api/tracking/me', requireAuth, (req, res) => {
        const rec = store[req.user.id] || null;
        res.json({
            sharing: !!(rec && rec.sharing),
            label: (rec && rec.label) || '',
            consentAt: (rec && rec.consentAt) || null,
            lastAt: (rec && rec.now && rec.now.at) || null,
            trailPoints: (rec && rec.trail) ? rec.trail.length : 0,
            // So the consent screen can name the one person who can see it.
            sharedWith: ownerEmail || null,
            isOwner: isOwner(req.user),
            retentionHours: Math.round(TRAIL_MS / 3600000),
            staleAfterMinutes: Math.round(STALE_MS / 60000),
        });
    });

    /*
     * Turn sharing on or off. This IS the consent record, so it stores who
     * gave it and when, and turning it off deletes the trail in the same
     * write — a chaser who revokes should not have to trust a second request
     * to finish the job.
     */
    app.post('/api/tracking/consent', requireAuth, (req, res) => {
        const want = !!(req.body && req.body.sharing);
        const label = str((req.body && req.body.label) || '', 60).trim();
        const rec = store[req.user.id] || {};

        rec.email = req.user.email || '';
        rec.name = (req.user.email || '').split('@')[0];
        if (label) rec.label = label;

        if (want) {
            if (!rec.sharing) {
                rec.sharing = true;
                rec.consentAt = new Date().toISOString();
                rec.startedAt = Date.now();
                rec.revokedAt = null;
                rec.trail = [];
            }
        } else if (rec.sharing || rec.now) {
            rec.sharing = false;
            rec.revokedAt = new Date().toISOString();
            rec.trail = [];
            delete rec.now;            // the position goes with the consent
            pushToOwner('tracking-off', { id: req.user.id });
        }
        rec.updatedAt = Date.now();
        store[req.user.id] = rec;
        save();
        res.json({ sharing: !!rec.sharing, consentAt: rec.consentAt || null, sharedWith: ownerEmail || null });
    });

    /*
     * A position from the field.
     *
     * Refused outright when sharing is off, rather than stored and filtered
     * on read: a position that should not exist is better not written down.
     */
    app.post('/api/tracking/ping', requireAuth, (req, res) => {
        const rec = store[req.user.id];
        if (!rec || !rec.sharing) return res.status(409).json({ error: 'Location sharing is off.', sharing: false });

        const b = req.body || {};
        const lat = num(b.lat), lng = num(b.lng);
        if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return res.status(400).json({ error: 'A valid position is required.' });
        }

        const now = Date.now();
        // A client reporting faster than this is answered OK but not stored;
        // it costs nothing to be tolerant of a retry or a double watch.
        if (rec.now && rec.now.at && now - rec.now.at < MIN_PING_GAP_MS) {
            return res.json({ ok: true, throttled: true });
        }

        const acc = num(b.accuracy);
        const speed = num(b.speed);
        const heading = num(b.heading);
        const battery = num(b.battery);
        const point = {
            lat: Math.round(lat * 1e5) / 1e5,       // ~1 m; more is false precision
            lng: Math.round(lng * 1e5) / 1e5,
            acc: acc != null && acc >= 0 ? Math.round(acc) : null,
            speed: speed != null && speed >= 0 ? Math.round(speed * 10) / 10 : null,
            heading: heading != null && heading >= 0 && heading <= 360 ? Math.round(heading) : null,
            alt: num(b.altitude) == null ? null : Math.round(num(b.altitude)),
            battery: battery != null && battery >= 0 && battery <= 1 ? Math.round(battery * 100) : null,
            at: now,
        };

        rec.now = point;
        rec.email = req.user.email || rec.email || '';
        if (!rec.startedAt) rec.startedAt = now;
        rec.updatedAt = now;
        addToTrail(rec, { lat: point.lat, lng: point.lng, at: now });
        save();

        res.json({ ok: true });
        pushToOwner('tracking-move', { chaser: publicChaser(req.user.id, rec, { trail: false }) });
    });

    /* Wipe the trail but keep sharing on — the chaser's own history, theirs to drop. */
    app.delete('/api/tracking/me/trail', requireAuth, (req, res) => {
        const rec = store[req.user.id];
        if (!rec) return res.json({ ok: true, trailPoints: 0 });
        rec.trail = [];
        rec.updatedAt = Date.now();
        save();
        res.json({ ok: true, trailPoints: 0 });
        pushToOwner('tracking-trail-cleared', { id: req.user.id });
    });

    /* Stop sharing and remove everything held about this chaser. */
    app.delete('/api/tracking/me', requireAuth, (req, res) => {
        if (store[req.user.id]) {
            delete store[req.user.id];
            save();
            pushToOwner('tracking-off', { id: req.user.id });
        }
        res.json({ ok: true, sharing: false });
    });

    /* ── the owner's side ───────────────────────────────────────────────────
     * Trails are left out of the list by default: a dozen chasers with four
     * hours of history each is a large response to send every refresh, and
     * the map only needs a trail for whoever is being looked at.
     */
    app.get('/api/tracking/chasers', requireAuth, requireOwner, (req, res) => {
        const trail = String(req.query.trail || '') === '1';
        res.json({
            chasers: activeChasers({ trail }),
            staleAfterMinutes: Math.round(STALE_MS / 60000),
            retentionHours: Math.round(TRAIL_MS / 3600000),
        });
    });

    /* One chaser, with their trail, for following them on the map. */
    app.get('/api/tracking/chasers/:id', requireAuth, requireOwner, (req, res) => {
        const rec = store[req.params.id];
        if (!rec || !rec.sharing || !rec.now) return res.status(404).json({ error: 'Not sharing.' });
        res.json({ chaser: publicChaser(req.params.id, rec, { trail: true }) });
    });

    /*
     * Everyone who has ever consented, sharing now or not. This is the roster,
     * not the map: it answers "who is enrolled" without implying a position.
     */
    app.get('/api/tracking/roster', requireAuth, requireOwner, (req, res) => {
        const list = Object.entries(store).map(([uid, rec]) => ({
            id: uid,
            name: (rec.label || rec.name || (rec.email || '').split('@')[0] || 'Chaser'),
            email: rec.email || '',
            sharing: !!rec.sharing,
            consentAt: rec.consentAt || null,
            revokedAt: rec.revokedAt || null,
            lastAt: (rec.now && rec.now.at) || null,
        })).sort((a, b) => Number(b.sharing) - Number(a.sharing) || (b.lastAt || 0) - (a.lastAt || 0));
        res.json({ roster: list });
    });

    const sharingCount = Object.values(store).filter((r) => r && r.sharing).length;
    console.log(`[TRACKING] Field tracking ready — visible only to ${ownerEmail || '(no owner configured)'}; `
        + `${sharingCount} chaser(s) currently sharing.`);

    /*
     * Called when an account is deleted. The consent that allowed a position
     * to be stored belonged to that account, so it does not outlive it.
     */
    function forgetUser(userId) {
        if (!store[userId]) return false;
        delete store[userId];
        save();
        pushToOwner('tracking-off', { id: userId });
        return true;
    }

    return { pushToOwner, forgetUser };
}

module.exports = { attachFieldTracking };
