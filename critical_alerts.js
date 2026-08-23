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
 * ── PHASE 2 (this file, so far): data model + Saved Locations + preferences +
 *    admin config schema. Later phases add: NWS worker, polygon matcher,
 *    notification queue + channels, radar integration, history, admin dashboard.
 *
 * Attached from server.js: attachCriticalAlerts({ app, requireAuth, requireAdmin,
 *   DATA_DIR, readJson, writeJson }). Guarded so it never breaks boot.
 */

const path = require('path');

const NWS_UA = (process.env.NWS_USER_AGENT || 'VortexRadar (critical-alerts, admin@twistcasterlivemedia.com)').trim();

// ── default admin config (editable in the admin dashboard; NOT hard-coded through
//    the app — everything reads from crit_config.json). Priorities + per-priority
//    channel routing per the spec. ─────────────────────────────────────────────
const DEFAULT_CONFIG = {
    // Which NWS events are eligible, and their priority. Admin can edit.
    alertTypes: [
        { name: 'Tornado Warning', priority: 'CRITICAL', enabled: true },
        { name: 'Flash Flood Warning', priority: 'CRITICAL', enabled: true },
        { name: 'Extreme Wind Warning', priority: 'CRITICAL', enabled: true },
        { name: 'Hurricane Warning', priority: 'CRITICAL', enabled: true },
        { name: 'Tropical Storm Warning', priority: 'CRITICAL', enabled: true },
        { name: 'Severe Thunderstorm Warning', priority: 'HIGH', enabled: true },
        { name: 'Special Marine Warning', priority: 'HIGH', enabled: false },
        { name: 'Tornado Watch', priority: 'NORMAL', enabled: false },
        { name: 'Severe Thunderstorm Watch', priority: 'NORMAL', enabled: false },
    ],
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

const ALL_METHODS = ['push', 'email', 'text', 'discord', 'telegram', 'ntfy'];
function normMethods(m, dflt) {
    const out = {};
    for (const k of ALL_METHODS) out[k] = (m && typeof m[k] === 'boolean') ? m[k] : !!(dflt && dflt[k]);
    return out;
}

const clampStr = (v, n) => String(v == null ? '' : v).slice(0, n).trim();
const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const uid = () => 'crit-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

function attachCriticalAlerts({ app, requireAuth, requireAdmin, DATA_DIR, readJson, writeJson }) {
    const LOC_FILE = path.join(DATA_DIR, 'crit_locations.json');    // userId -> [location]
    const PREFS_FILE = path.join(DATA_DIR, 'crit_prefs.json');      // userId -> prefs
    const CONFIG_FILE = path.join(DATA_DIR, 'crit_config.json');    // admin config

    let locations = readJson(LOC_FILE, {});
    let prefs = readJson(PREFS_FILE, {});
    let config = readJson(CONFIG_FILE, null);
    if (!config) { config = DEFAULT_CONFIG; try { writeJson(CONFIG_FILE, config); } catch (e) {} }

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
        };
    }
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

    console.log(`[CRITICAL] Critical Weather Alerts ready (Phase 2: locations + prefs). ${Object.values(locations).reduce((a, b) => a + (b ? b.length : 0), 0)} saved location(s).`);
}

module.exports = { attachCriticalAlerts };
