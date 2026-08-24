/*
 * backend/tornado/nws.js
 * Official National Weather Service alerts, kept strictly separate from the
 * experimental score.
 *
 * This exists for two reasons:
 *   1. So the UI can show "OFFICIAL NWS TORNADO WARNING" as a distinct thing
 *      from "VORTEX RADAR EXPERIMENTAL — TORNADO POTENTIAL: HIGH". The
 *      experimental number never inherits official authority, and an official
 *      warning is never suppressed or re-scored by us.
 *   2. So the historical dataset records whether a warning was in force at the
 *      time of each observation — the label a future ML model needs.
 *
 * api.weather.gov is free, requires no key, and asks for a contact in the
 * User-Agent, which is what NWS_USER_AGENT provides.
 */

const geo = require('./geo');
const log = require('./logger');

const ALERTS_URL = 'https://api.weather.gov/alerts/active';
const USER_AGENT = process.env.NWS_USER_AGENT
    || 'VortexRadar Tornado Potential (davidwallis17@gmail.com)';

let cache = { at: 0, features: [] };
let inflight = null;

async function fetchActive(cfg) {
    const ttl = cfg.nws.cacheSeconds * 1000;
    if (Date.now() - cache.at < ttl) return cache.features;
    if (inflight) return inflight;

    inflight = (async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), cfg.nws.timeoutMs);
        try {
            // Only the event types that matter to this feature.
            const url = `${ALERTS_URL}?status=actual&message_type=alert,update`
                + `&event=Tornado%20Warning,Severe%20Thunderstorm%20Warning,Tornado%20Watch`;
            const res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
                signal: ctrl.signal,
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const j = await res.json();
            cache = { at: Date.now(), features: Array.isArray(j.features) ? j.features : [] };
            log.debug('nws.fetched', { count: cache.features.length });
        } catch (e) {
            // Keep serving the previous list; official alerts going missing must
            // never stop radar analysis.
            log.warn('nws.failed', { err: e.message, servingStale: cache.features.length });
            cache.at = Date.now() - (cfg.nws.cacheSeconds * 1000 * 0.5);
        } finally {
            clearTimeout(t);
            inflight = null;
        }
        return cache.features;
    })();
    return inflight;
}

/**
 * Official alerts whose polygon contains this point.
 * @returns {Promise<{tornadoWarning:object|null, severeWarning:object|null, tornadoWatch:object|null, all:Array}>}
 */
async function alertsAt(lat, lon, cfg) {
    const empty = { tornadoWarning: null, severeWarning: null, tornadoWatch: null, all: [] };
    if (!cfg.nws.enabled) return empty;

    let features;
    try { features = await fetchActive(cfg); } catch { return empty; }
    if (!features || !features.length) return empty;

    const hits = [];
    for (const f of features) {
        if (!f || !f.geometry) continue;                    // zone-only alerts carry no polygon
        let inside = false;
        try { inside = geo.pointInGeometry(lon, lat, f.geometry); } catch { inside = false; }
        if (!inside) continue;
        const p = f.properties || {};
        hits.push({
            id: f.id,
            event: p.event,
            severity: p.severity,
            certainty: p.certainty,
            urgency: p.urgency,
            headline: p.headline,
            sent: p.sent,
            expires: p.expires,
            senderName: p.senderName,
            // Impact-based warning tags, when present — these are the NWS's own
            // wording and are shown verbatim, never paraphrased.
            tornadoDetection: (p.parameters && p.parameters.tornadoDetection) ? p.parameters.tornadoDetection[0] : null,
            tornadoDamageThreat: (p.parameters && p.parameters.tornadoDamageThreat) ? p.parameters.tornadoDamageThreat[0] : null,
        });
    }
    if (!hits.length) return empty;

    return {
        tornadoWarning: hits.find((h) => h.event === 'Tornado Warning') || null,
        severeWarning: hits.find((h) => h.event === 'Severe Thunderstorm Warning') || null,
        tornadoWatch: hits.find((h) => h.event === 'Tornado Watch') || null,
        all: hits,
    };
}

/** Active tornado-warning polygons, for choosing which radars to watch. */
async function activeTornadoWarningCentroids(cfg) {
    let features;
    try { features = await fetchActive(cfg); } catch { return []; }
    const out = [];
    for (const f of features || []) {
        const p = f.properties || {};
        if (p.event !== 'Tornado Warning' && p.event !== 'Severe Thunderstorm Warning') continue;
        if (!f.geometry) continue;
        const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates
            : f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : [];
        for (const poly of polys) {
            const ring = poly && poly[0];
            if (!ring || !ring.length) continue;
            let sx = 0, sy = 0;
            for (const pt of ring) { sx += pt[0]; sy += pt[1]; }
            out.push({ lat: sy / ring.length, lon: sx / ring.length, event: p.event });
        }
    }
    return out;
}

function clearCache() { cache = { at: 0, features: [] }; }

module.exports = { alertsAt, activeTornadoWarningCentroids, clearCache };
