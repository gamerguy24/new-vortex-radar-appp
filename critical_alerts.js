/*
 * critical_alerts.js — Critical Weather Alert & Notification System
 * ────────────────────────────────────────────────────────────────────────────
 * Free-first, self-hosted. Users save locations (Home/Work/…); a server-side NWS
 * poller (added in a later phase) matches active warnings to those locations with
 * point-in-polygon (turf) and notifies via a pluggable set of channels
 * (browser push, email, Text Gateway, Discord, Telegram, ntfy). NO paid provider
 * is required — text goes through whatever gateway the admin configures.
 *
 * Storage is the app's JSON store (readJson/writeJson), not Postgres — this box
 * is a single self-hosted server. Point-in-polygon uses @turf/turf. The queue is
 * in-process/async (a paid Redis+BullMQ is unnecessary at this scale).
 *
 * ── PHASE 2: data model + Saved Locations + preferences + admin config.
 * ── PHASE 3 (critical_push.js + critical_worker.js): browser push, the NWS
 *    poller and the point-in-polygon matcher. Still to come: the other
 *    channels (email, text gateway, Discord, Telegram, ntfy), history and the
 *    admin dashboard.
 *
 * ── EMAIL (critical_messaging.js): free for signed-in users (was a paid
 *    add-on until 2026-10-18; billing.js hasAlerts), sent through the server's own SMTP.
 *
 * Attached from server.js: attachCriticalAlerts({ app, requireAuth, requireAdmin,
 *   DATA_DIR, readJson, writeJson, getUser, hasAlerts, sendMail, mailReady }).
 *   Guarded so it never breaks boot.
 */

const path = require('path');

const NWS_UA = (process.env.NWS_USER_AGENT || 'EchoRadar (critical-alerts, admin@twistcasterlivemedia.com)').trim();

// ── default admin config (editable in the admin dashboard; NOT hard-coded through
//    the app — everything reads from crit_config.json). Priorities + per-priority
//    channel routing per the spec. ─────────────────────────────────────────────
/*
 * Which NWS events are eligible, and their priority. Admin can edit; an
 * enabled type is one users can pick for email. Priority sets the DEFAULT a
 * user gets before they pick anything (CRITICAL + HIGH), so adding a NORMAL
 * type here never starts mailing anybody who did not ask for it.
 */
const DEFAULT_ALERT_TYPES = [
    { name: 'Tornado Warning', priority: 'CRITICAL', enabled: true },
    { name: 'Flash Flood Warning', priority: 'CRITICAL', enabled: true },
    { name: 'Extreme Wind Warning', priority: 'CRITICAL', enabled: true },
    { name: 'Hurricane Warning', priority: 'CRITICAL', enabled: true },
    { name: 'Storm Surge Warning', priority: 'CRITICAL', enabled: true },
    { name: 'Tropical Storm Warning', priority: 'CRITICAL', enabled: true },
    { name: 'Severe Thunderstorm Warning', priority: 'HIGH', enabled: true },
    { name: 'Flood Warning', priority: 'HIGH', enabled: true },
    { name: 'Special Marine Warning', priority: 'HIGH', enabled: false },
    { name: 'Snow Squall Warning', priority: 'NORMAL', enabled: true },
    { name: 'Blizzard Warning', priority: 'NORMAL', enabled: true },
    { name: 'Ice Storm Warning', priority: 'NORMAL', enabled: true },
    { name: 'Winter Storm Warning', priority: 'NORMAL', enabled: true },
    { name: 'High Wind Warning', priority: 'NORMAL', enabled: true },
    { name: 'Dust Storm Warning', priority: 'NORMAL', enabled: true },
    { name: 'Extreme Heat Warning', priority: 'NORMAL', enabled: true },
    { name: 'Red Flag Warning', priority: 'NORMAL', enabled: true },
    { name: 'Tornado Watch', priority: 'NORMAL', enabled: true },
    { name: 'Severe Thunderstorm Watch', priority: 'NORMAL', enabled: true },
    { name: 'Flash Flood Watch', priority: 'NORMAL', enabled: true },
    { name: 'Flood Watch', priority: 'NORMAL', enabled: true },
    { name: 'Hurricane Watch', priority: 'NORMAL', enabled: true },
    { name: 'Tropical Storm Watch', priority: 'NORMAL', enabled: true },
    { name: 'Storm Surge Watch', priority: 'NORMAL', enabled: true },
    { name: 'Winter Storm Watch', priority: 'NORMAL', enabled: true },
    { name: 'High Wind Watch', priority: 'NORMAL', enabled: true },
    { name: 'Extreme Heat Watch', priority: 'NORMAL', enabled: true },
];
const CATALOG_VERSION = 2;

const DEFAULT_CONFIG = {
    catalogVersion: CATALOG_VERSION,
    alertTypes: DEFAULT_ALERT_TYPES,
    // Which channels fire at each priority level (a per-priority default; a user's
    // own method toggles further gate this).
    routing: {
        CRITICAL: { push: true, email: true, text: true, discord: true, telegram: true, ntfy: true },
        HIGH: { push: true, email: true, text: false, discord: true, telegram: true, ntfy: true },
        NORMAL: { push: true, email: true, text: false, discord: false, telegram: false, ntfy: false },
    },
    notifyOnUpdate: false,   // does an updated/extended warning re-notify?
    // Carrier email-to-SMS gateways. Availability depends on the carrier and is
    // NOT guaranteed — surfaced to the user in the UI. Admin-editable.
    smsGateways: [
        { id: 'att', carrier: 'AT&T', domain: 'txt.att.net', enabled: true, country: 'US' },
        { id: 'tmobile', carrier: 'T-Mobile', domain: 'tmomail.net', enabled: true, country: 'US' },
        { id: 'verizon', carrier: 'Verizon', domain: 'vtext.com', enabled: true, country: 'US' },
        { id: 'sprint', carrier: 'Sprint', domain: 'messaging.sprintpcs.com', enabled: false, country: 'US' },
        { id: 'uscellular', carrier: 'US Cellular', domain: 'email.uscc.net', enabled: true, country: 'US' },
    ],
};

/*
 * States (and territories) a user can watch whole, instead of an address. An
 * NWS alert lists the zones and counties it was issued for as UGC codes, and
 * every UGC starts with the two-letter state ("OKC017", "TXZ119"), so a state
 * matches exactly what the office issued — no geometry involved.
 */
const STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
    LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
    NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
    OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
    PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam', AS: 'American Samoa', MP: 'Northern Mariana Islands',
};
const MAX_STATES = 10;

const ALL_METHODS =['push', 'email', 'text', 'discord', 'telegram', 'ntfy'];
function normMethods(m, dflt) {
    const out = {};
    for (const k of ALL_METHODS) out[k] = (m && typeof m[k] === 'boolean') ? m[k] : !!(dflt && dflt[k]);
    return out;
}

const clampStr = (v, n) => String(v == null ? '' : v).slice(0, n).trim();
const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const uid = () => 'crit-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

function attachCriticalAlerts({
    app, requireAuth, requireAdmin, DATA_DIR, readJson, writeJson,
    getUser, hasAlerts, sendMail, mailReady, mailError,
}) {
    const LOC_FILE = path.join(DATA_DIR, 'crit_locations.json');    // userId -> [location]
    const PREFS_FILE = path.join(DATA_DIR, 'crit_prefs.json');      // userId -> prefs
    const CONFIG_FILE = path.join(DATA_DIR, 'crit_config.json');    // admin config

    let locations = readJson(LOC_FILE, {});
    let prefs = readJson(PREFS_FILE, {});
    let config = readJson(CONFIG_FILE, null);
    if (!config) { config = DEFAULT_CONFIG; try { writeJson(CONFIG_FILE, config); } catch (e) {} }

    /*
     * Catalog v2: watches and the rest of the warnings, so users can pick them
     * for email. Types the admin already has keep their settings — except the
     * two watches, which were off only because nobody could choose them yet.
     */
    if (!(config.catalogVersion >= CATALOG_VERSION)) {
        const have = new Set((config.alertTypes || []).map((t) => t.name));
        config.alertTypes = (config.alertTypes || []).map((t) => (
            /^(Tornado|Severe Thunderstorm) Watch$/.test(t.name) ? { ...t, enabled: true } : t));
        for (const t of DEFAULT_ALERT_TYPES) if (!have.has(t.name)) config.alertTypes.push({ ...t });
        config.catalogVersion = CATALOG_VERSION;
        try { writeJson(CONFIG_FILE, config); } catch (e) {}
        console.log('[CRITICAL] alert catalog updated to v' + CATALOG_VERSION);
    }

    const saveLocations = () => { try { writeJson(LOC_FILE, locations); } catch (e) {} };
    const savePrefs = () => { try { writeJson(PREFS_FILE, prefs); } catch (e) {} };
    const saveConfig = () => { try { writeJson(CONFIG_FILE, config); } catch (e) {} };

    // Default prefs for a user (email defaults to their account email).
    function userPrefs(user) {
        const p = prefs[user.id] || {};
        return {
            enabled: p.enabled !== false,
            methods: normMethods(p.methods, { push: true, email: true, text: false, discord: false, telegram: false, ntfy: false }),
            email: p.email || user.email || '',
            phone: p.phone || '',
            phoneCarrier: p.phoneCarrier || '',
            phoneVerified: !!p.phoneVerified,
            phoneConsentAt: p.phoneConsentAt || null,
            discordWebhook: p.discordWebhook || '',
            telegramChatId: p.telegramChatId || '',
            ntfyTopic: p.ntfyTopic || '',
            quietHours: {
                enabled: !!(p.quietHours && p.quietHours.enabled),
                start: (p.quietHours && p.quietHours.start) || '23:00',
                end: (p.quietHours && p.quietHours.end) || '07:00',
                overrideCritical: !(p.quietHours && p.quietHours.overrideCritical === false), // default true
            },
            notifyFor: p.notifyFor || 'critical-high', // 'critical' | 'critical-high' | 'all'
            emailTypes: emailTypesFor(user.id),
            emailTypesCustom: Array.isArray(p.emailTypes),
            states: Array.isArray(p.states) ? p.states : [],
        };
    }

    /*
     * Watched states as places the poller can treat like any other: one
     * pseudo-location per state, matched by UGC prefix (critical_worker.js
     * covers()). Push is on for them, like a place added in the dialog.
     */
    function statePlaces(userId) {
        const list = (prefs[userId] && Array.isArray(prefs[userId].states)) ? prefs[userId].states : [];
        return list.filter((s) => STATES[s]).map((s) => ({
            id: 'state-' + s, name: STATES[s], stateCode: s, enabled: true, methods: { push: true },
        }));
    }
    /** userId -> saved places followed by watched states. What the poller iterates. */
    function placesByUser() {
        const out = {};
        for (const [id, list] of Object.entries(locations)) if (Array.isArray(list) && list.length) out[id] = list.slice();
        for (const id of Object.keys(prefs)) {
            const st = statePlaces(id);
            if (st.length) out[id] = (out[id] || []).concat(st);
        }
        return out;
    }

    /*
     * The alert types this user gets by email: the ones they ticked, or —
     * until they tick anything — every enabled type at the priorities their
     * notifyFor covers. Always limited to what the admin has enabled.
     */
    function emailTypesFor(userId) {
        const p = prefs[userId] || {};
        const enabled = config.alertTypes.filter((t) => t.enabled);
        if (Array.isArray(p.emailTypes)) {
            const picked = new Set(p.emailTypes);
            return enabled.filter((t) => picked.has(t.name)).map((t) => t.name);
        }
        const f = p.notifyFor || 'critical-high';
        return enabled.filter((t) => f === 'all' || t.priority === 'CRITICAL'
            || (f === 'critical-high' && t.priority === 'HIGH')).map((t) => t.name);
    }
    const wantsEmail = (userId, event) => emailTypesFor(userId).indexOf(event) !== -1;
    // What we expose (never leak the discord webhook value; report configured only).
    function publicPrefs(user) {
        const p = userPrefs(user);
        return { ...p, discordWebhook: undefined, discordConfigured: !!p.discordWebhook };
    }

    function getLocs(userId) { return Array.isArray(locations[userId]) ? locations[userId] : []; }

    // ── geocoding (free, no key): US Census one-line geocoder. NWS is US-only, so
    //    this fits. Returns { lat, lon, matched } or null. ─────────────────────
    async function geocode(oneline) {
        const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
            + `?address=${encodeURIComponent(oneline)}&benchmark=Public_AR_Current&format=json`;
        try {
            const r = await fetch(url, { headers: { 'User-Agent': NWS_UA } });
            if (!r.ok) return null;
            const j = await r.json();
            const m = j && j.result && j.result.addressMatches && j.result.addressMatches[0];
            if (m && m.coordinates) return { lat: m.coordinates.y, lon: m.coordinates.x, matched: m.matchedAddress };
        } catch (e) {}
        /*
         * The Census geocoder only knows street addresses, but the dialog asks
         * for "address, city or ZIP" — so a bare city or ZIP falls back to
         * OpenStreetMap's Nominatim (free, no key, US only here).
         */
        try {
            const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q='
                + encodeURIComponent(oneline), { headers: { 'User-Agent': NWS_UA } });
            if (!r.ok) return null;
            const m = (await r.json())[0];
            if (m && m.lat && m.lon) return { lat: Number(m.lat), lon: Number(m.lon), matched: m.display_name };
        } catch (e) {}
        return null;
    }

    /*
     * A location's NWS zones (forecast zone, county, fire zone), for alerts
     * issued by zone rather than polygon — watches, hurricane and winter
     * products. Looked up once from api.weather.gov/points and kept on the
     * location; a moved pin looks them up again. Returns null while the
     * lookup is in flight, so the poller simply catches it on the next pass.
     */
    const zoneJobs = new Map();         // location id -> in-flight lookup
    const zoneFails = new Map();        // location id -> time of last failure
    function zonesFor(loc) {
        const at = `${loc.lat},${loc.lon}`;
        if (Array.isArray(loc.zones) && loc.zonesAt === at) return loc.zones;
        if (zoneJobs.has(loc.id) || Date.now() - (zoneFails.get(loc.id) || 0) < 10 * 60 * 1000) return null;
        const url = `https://api.weather.gov/points/${Number(loc.lat).toFixed(4)},${Number(loc.lon).toFixed(4)}`;
        zoneJobs.set(loc.id, fetch(url, { headers: { Accept: 'application/geo+json', 'User-Agent': NWS_UA } })
            .then((r) => { if (!r.ok) throw new Error('NWS ' + r.status); return r.json(); })
            .then((body) => {
                const p = (body && body.properties) || {};
                const zones = [p.forecastZone, p.county, p.fireWeatherZone]
                    .filter(Boolean).map((u) => String(u).split('/').pop());
                if (!zones.length) throw new Error('no zones');
                loc.zones = zones;
                loc.zonesAt = at;
                saveLocations();
            })
            .catch(() => zoneFails.set(loc.id, Date.now()))
            .finally(() => zoneJobs.delete(loc.id)));
        return null;
    }
    function oneLine(b) {
        return [b.address, b.city, b.state, b.zip].map((x) => clampStr(x, 120)).filter(Boolean).join(', ');
    }

    // Build a clean location object from a request body (geocoding when needed).
    async function buildLocation(existing, b) {
        const loc = { ...(existing || {}) };
        loc.name = clampStr(b.name != null ? b.name : loc.name, 60) || 'Location';
        loc.address = clampStr(b.address != null ? b.address : loc.address, 160);
        loc.city = clampStr(b.city != null ? b.city : loc.city, 80);
        loc.state = clampStr(b.state != null ? b.state : loc.state, 40);
        loc.zip = clampStr(b.zip != null ? b.zip : loc.zip, 12);
        loc.enabled = b.enabled != null ? !!b.enabled : (loc.enabled !== false);
        loc.methods = normMethods(b.methods || loc.methods, { push: true, email: true, text: false });
        loc.alertTypes = Array.isArray(b.alertTypes) ? b.alertTypes.map((s) => clampStr(s, 60)).filter(Boolean) : (loc.alertTypes || []);

        let lat = numOrNull(b.latitude != null ? b.latitude : b.lat);
        let lon = numOrNull(b.longitude != null ? b.longitude : b.lon);
        const valid = (la, lo) => la != null && lo != null && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
        if (!valid(lat, lon)) {
            // No explicit coords in the request. Keep the existing coords unless the
            // address actually changed (so a name/enable-only edit never re-geocodes
            // and never loses the pin); otherwise geocode the address.
            const addrChanged = existing && (loc.address !== existing.address || loc.city !== existing.city
                || loc.state !== existing.state || loc.zip !== existing.zip);
            if (existing && valid(existing.lat, existing.lon) && !addrChanged) {
                lat = existing.lat; lon = existing.lon;
            } else if (oneLine(loc)) {
                const g = await geocode(oneLine(loc));
                if (g) { lat = g.lat; lon = g.lon; loc.geocoded = g.matched; }
            }
        }
        loc.lat = lat; loc.lon = lon;
        return loc;
    }

    // ═══════════════════════════ user API ═══════════════════════════════════════
    // Summary for the Critical Weather Alerts page.
    app.get('/api/critical', requireAuth, (req, res) => {
        res.json({
            locations: getLocs(req.user.id),
            preferences: publicPrefs(req.user),
            alertTypes: config.alertTypes.filter((t) => t.enabled),
            states: STATES,
            maxStates: MAX_STATES,
            smsGateways: config.smsGateways.filter((g) => g.enabled).map((g) => ({ id: g.id, carrier: g.carrier, country: g.country })),
        });
    });

    app.get('/api/critical/locations', requireAuth, (req, res) => res.json({ locations: getLocs(req.user.id) }));

    app.post('/api/critical/locations', requireAuth, async (req, res) => {
        const list = getLocs(req.user.id);
        if (list.length >= 25) return res.status(400).json({ error: 'Location limit reached (25).' });
        const loc = await buildLocation(null, req.body || {});
        if (loc.lat == null || loc.lon == null) {
            return res.status(400).json({ error: 'Could not find that address. Add a fuller address or enter latitude/longitude directly.' });
        }
        loc.id = uid();
        loc.createdAt = new Date().toISOString();
        loc.updatedAt = loc.createdAt;
        list.push(loc);
        locations[req.user.id] = list;
        saveLocations();
        zonesFor(loc);
        res.json({ location: loc });
    });

    app.put('/api/critical/locations/:id', requireAuth, async (req, res) => {
        const list = getLocs(req.user.id);
        const i = list.findIndex((l) => l.id === req.params.id);
        if (i < 0) return res.status(404).json({ error: 'Location not found.' });
        const loc = await buildLocation(list[i], req.body || {});
        if (loc.lat == null || loc.lon == null) return res.status(400).json({ error: 'Could not resolve coordinates for that address.' });
        loc.id = list[i].id;
        loc.createdAt = list[i].createdAt;
        loc.updatedAt = new Date().toISOString();
        list[i] = loc;
        saveLocations();
        zonesFor(loc);
        res.json({ location: loc });
    });

    app.delete('/api/critical/locations/:id', requireAuth, (req, res) => {
        const list = getLocs(req.user.id);
        const next = list.filter((l) => l.id !== req.params.id);
        if (next.length === list.length) return res.status(404).json({ error: 'Location not found.' });
        locations[req.user.id] = next;
        saveLocations();
        res.json({ ok: true });
    });

    app.get('/api/critical/preferences', requireAuth, (req, res) => res.json({ preferences: publicPrefs(req.user) }));

    app.put('/api/critical/preferences', requireAuth, (req, res) => {
        const b = req.body || {};
        const cur = prefs[req.user.id] || {};
        const next = { ...cur };
        if (b.enabled != null) next.enabled = !!b.enabled;
        if (b.methods) next.methods = normMethods(b.methods, userPrefs(req.user).methods);
        if (b.email != null) next.email = clampStr(b.email, 200);
        if (b.telegramChatId != null) next.telegramChatId = clampStr(b.telegramChatId, 60);
        if (b.ntfyTopic != null) next.ntfyTopic = clampStr(b.ntfyTopic, 120);
        if (b.notifyFor && ['critical', 'critical-high', 'all'].includes(b.notifyFor)) next.notifyFor = b.notifyFor;
        if (Array.isArray(b.emailTypes)) {
            const known = new Set(config.alertTypes.map((t) => t.name));
            next.emailTypes = b.emailTypes.map((s) => clampStr(s, 60)).filter((s) => known.has(s));
        } else if (b.emailTypes === null) delete next.emailTypes;      // back to the defaults
        if (Array.isArray(b.states)) {
            const picked = [...new Set(b.states.map((s) => String(s).toUpperCase().slice(0, 2)).filter((s) => STATES[s]))];
            if (picked.length > MAX_STATES) {
                return res.status(400).json({ error: `You can watch up to ${MAX_STATES} states.` });
            }
            next.states = picked;
        }
        if (b.phone != null) {
            const phone = clampStr(b.phone, 20);
            // changing the number resets verification + requires fresh consent
            if (phone !== cur.phone) { next.phoneVerified = false; next.phoneConsentAt = null; }
            next.phone = phone;
        }
        if (b.phoneCarrier != null) next.phoneCarrier = clampStr(b.phoneCarrier, 40);
        if (b.consent === true) next.phoneConsentAt = new Date().toISOString(); // opt-in timestamp
        if (b.quietHours) {
            next.quietHours = {
                enabled: !!b.quietHours.enabled,
                start: clampStr(b.quietHours.start, 5) || '23:00',
                end: clampStr(b.quietHours.end, 5) || '07:00',
                overrideCritical: b.quietHours.overrideCritical !== false,
            };
        }
        // Discord webhook: only accept real webhook URLs; store server-side only.
        if (typeof b.discordWebhook === 'string' && b.discordWebhook.length) {
            if (!/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(b.discordWebhook)) {
                return res.status(400).json({ error: 'That does not look like a Discord webhook URL.' });
            }
            next.discordWebhook = clampStr(b.discordWebhook, 300);
        } else if (b.discordWebhook === null) { delete next.discordWebhook; }
        prefs[req.user.id] = next;
        savePrefs();
        res.json({ preferences: publicPrefs(req.user) });
    });

    // Public (to signed-in users) read of the alert-type catalog + priorities.
    app.get('/api/critical/config', requireAuth, (req, res) => {
        res.json({ alertTypes: config.alertTypes, routing: config.routing, notifyOnUpdate: config.notifyOnUpdate });
    });

    // ═══════════════════════════ admin API ══════════════════════════════════════
    app.get('/admin/critical/config', requireAdmin, (req, res) => res.json({ config }));

    app.post('/admin/critical/config', requireAdmin, (req, res) => {
        const b = req.body || {};
        if (Array.isArray(b.alertTypes)) {
            config.alertTypes = b.alertTypes.map((t) => ({
                name: clampStr(t.name, 60),
                priority: ['CRITICAL', 'HIGH', 'NORMAL'].includes(t.priority) ? t.priority : 'NORMAL',
                enabled: t.enabled !== false,
            })).filter((t) => t.name);
        }
        if (b.routing) {
            for (const lvl of ['CRITICAL', 'HIGH', 'NORMAL']) {
                if (b.routing[lvl]) config.routing[lvl] = normMethods(b.routing[lvl], config.routing[lvl]);
            }
        }
        if (b.notifyOnUpdate != null) config.notifyOnUpdate = !!b.notifyOnUpdate;
        if (Array.isArray(b.smsGateways)) {
            config.smsGateways = b.smsGateways.map((g) => ({
                id: clampStr(g.id, 40) || uid(),
                carrier: clampStr(g.carrier, 60),
                domain: clampStr(g.domain, 120),
                enabled: g.enabled !== false,
                country: clampStr(g.country, 4) || 'US',
                notes: clampStr(g.notes, 200),
            })).filter((g) => g.carrier);
        }
        saveConfig();
        res.json({ config });
    });

    // Expose internals for later phases (NWS worker, matcher, notifier).
    attachCriticalAlerts._api = {
        getConfig: () => config,
        allLocations: () => locations,
        allPrefs: () => prefs,
        userPrefs,
        geocode,
    };

    /*
     * PHASE 3: the push channel and the poller that uses it.
     *
     * Wrapped separately and both non-fatal. Somebody who cannot be notified
     * must still be able to manage the locations they would have been notified
     * about, and nothing here may stop the radar serving.
     */
    let push = null;
    try {
        push = require('./critical_push').attachCriticalPush({
            app, requireAuth, DATA_DIR, readJson, writeJson,
            subject: process.env.PUSH_CONTACT || undefined,
        });
    } catch (e) {
        console.error('[CRITICAL] browser push unavailable: ' + e.message);
    }

    /*
     * Email (free). Also separately non-fatal: with no SMTP the channel
     * reports itself unavailable, never that push stops.
     */
    let messaging = null;
    try {
        messaging = require('./critical_messaging').attachCriticalMessaging({
            app, requireAuth, requireAdmin, DATA_DIR, readJson, writeJson,
            getLocations: () => locations,
            getPrefs: (id) => prefs[id],
            getUser, hasAlerts, sendMail, mailReady, mailError, wantsEmail,
        });
    } catch (e) {
        console.error('[CRITICAL] email alerts unavailable: ' + e.message);
    }

    let worker = null;
    if (push || messaging) {
        try {
            worker = require('./critical_worker').attachCriticalWorker({
                DATA_DIR, readJson, writeJson, push, messaging,
                getLocations: placesByUser,
                getPrefs: (id) => prefs[id],
                getConfig: () => config,
                userAgent: NWS_UA,
                zonesFor, wantsEmail,
            });
            worker.start();
            attachCriticalAlerts._api.poll = () => worker.poll();
        } catch (e) {
            console.error('[CRITICAL] warning poller unavailable: ' + e.message);
        }
    }

    /*
     * What the poller last did. Read by the admin page, and the first thing
     * to look at when somebody says they were not notified: it says whether
     * the feed is being reached at all, how many alerts were active, and how
     * many covered a saved location.
     */
    app.get('/api/critical/status', requireAuth, (req, res) => {
        res.json({
            push: !!push,
            devices: push ? push.hasSubscribers(req.user.id) : false,
            poller: worker ? worker.status() : null,
        });
    });

    /*
     * "Right now": every alert in effect at each of this user's places, and
     * for each, whether it was emailed — and if not, why not. The answer to
     * "there's a warning and I didn't get anything", without a server log.
     */
    app.get('/api/critical/check', requireAuth, (req, res) => {
        const { covers, isEnding } = require('./critical_worker');
        const userId = req.user.id;
        const email = messaging ? messaging.statusFor(userId) : { on: false, available: false };
        if (req.user.isAdmin && messaging && messaging.lastError()) email.lastError = messaging.lastError();
        if (!worker) return res.json({ poller: null, email, places: [] });
        const picks = new Set(emailTypesFor(userId));
        const all = worker.snapshot();
        // A warning and its later updates are one warning: keep only the newest.
        const superseded = new Set();
        for (const f of all) {
            for (const r of ((f && f.properties && f.properties.references) || [])) superseded.add(r && r.identifier);
        }
        const feats = all.filter((f) => {
            const p = (f && f.properties) || {};
            return p.id && !superseded.has(p.id) && (!p.status || p.status === 'Actual') && !isEnding(p);
        });
        const places = getLocs(userId).concat(statePlaces(userId)).map((loc) => {
            const out = {
                name: loc.stateCode ? `${loc.name} (whole state)` : (loc.name || 'Location'),
                where: [loc.city, loc.state].filter(Boolean).join(', ') || loc.address || '',
                enabled: loc.enabled !== false,
                positioned: !!loc.stateCode || (loc.lat != null && loc.lon != null),
                alerts: [],
            };
            if (!out.positioned) return out;
            for (const f of feats) {
                if (!covers(f, loc, zonesFor)) continue;
                const p = f.properties;
                out.alerts.push({
                    event: p.event,
                    until: p.ends || p.expires || null,
                    sender: p.senderName || '',
                    offered: !!worker.eligible(p.event),
                    picked: picks.has(p.event),
                    emailed: worker.wasSent(`e|${userId}|${loc.id}|${p.id}`),
                });
            }
            return out;
        });
        res.json({ poller: worker.status(), email, places });
    });

    console.log(`[CRITICAL] Critical Weather Alerts ready (push: ${push ? 'on' : 'off'}, `
        + `poller: ${worker ? 'running' : 'off'}). `
        + `${Object.values(locations).reduce((a, b) => a + (b ? b.length : 0), 0)} saved location(s).`);
}

module.exports = { attachCriticalAlerts };
