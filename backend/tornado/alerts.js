/*
 * backend/tornado/alerts.js
 * Threshold-crossing notifications for the experimental score.
 *
 * Rules that keep this from becoming noise — or becoming dangerous:
 *   - An alert fires on a RISE across the threshold, not on merely sitting
 *     above it, so a long-lived supercell produces one alert, not sixty.
 *   - Per-storm cooldown, configurable.
 *   - A re-alert requires a further configurable increase in score.
 *   - Confidence floor: a high score built on a low-confidence detection does
 *     not alert at all.
 *   - Wording is fixed and cannot be configured into sounding official. An
 *     alert always says TORNADO POTENTIAL and carries the experimental notice.
 *     When an official NWS tornado warning covers the storm, the alert says so
 *     and points at the warning — the official product always leads.
 */

const geo = require('./geo');
const log = require('./logger');

const CONF_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 };

const feed = [];                 // newest last
const lastAlertByStorm = new Map(); // stormId -> { atMs, score }
let seq = 0;

const DISCLAIMER = 'Vortex Radar Tornado Potential is an experimental radar-derived '
    + 'analysis tool. It is not an official warning system and does not replace alerts '
    + 'or warnings issued by the National Weather Service.';

/**
 * Decide whether this storm's new score warrants an alert, and record it.
 * @returns {object|null} the alert, or null
 */
function evaluate(storm, scoreRec, rot, official, cfg) {
    if (!cfg.alerts.enabled) return null;
    const a = cfg.alerts;

    if (scoreRec.score < a.minScore) return null;
    if ((CONF_RANK[scoreRec.confidence] || 0) < (CONF_RANK[a.minConfidence] || 2)) return null;

    const prev = lastAlertByStorm.get(storm.id);
    const nowMs = Date.now();
    const prevScore = previousScore(storm);

    // Must be a rise across the line, not a storm that was already above it.
    if (prevScore != null && prevScore >= a.minScore) {
        if (!prev) return null;
        const sinceMin = (nowMs - prev.atMs) / 60000;
        if (sinceMin < a.cooldownMinutes) return null;
        if (scoreRec.score - prev.score < a.minScoreIncrease) return null;
    }

    const alert = {
        id: 'TPA-' + (++seq) + '-' + storm.id,
        stormId: storm.id,
        site: storm.site,
        issued: new Date(nowMs).toISOString(),
        lat: storm.lat,
        lon: storm.lon,
        previousScore: prevScore,
        currentScore: scoreRec.score,
        category: scoreRec.category,
        confidence: scoreRec.confidence,
        rotation: rot.strength,
        trend: rot.trend,
        persistenceMinutes: Math.round(rot.persistenceMinutes),
        stormMotion: storm.motion
            ? { direction: Math.round(storm.motion.direction), speedMph: Math.round(storm.motion.speedKmh * 0.621371), compass: geo.compass(storm.motion.direction) }
            : null,
        // Official products are reported alongside, never merged into, the score.
        officialTornadoWarning: official && official.tornadoWarning
            ? { event: official.tornadoWarning.event, expires: official.tornadoWarning.expires, headline: official.tornadoWarning.headline }
            : null,
        experimental: true,
        title: 'Tornado Potential Increased',
        disclaimer: DISCLAIMER,
    };

    lastAlertByStorm.set(storm.id, { atMs: nowMs, score: scoreRec.score });
    feed.push(alert);
    while (feed.length > cfg.alerts.maxFeedLength) feed.shift();

    log.info('alert.threshold', {
        storm: storm.id, site: storm.site,
        from: prevScore, to: scoreRec.score,
        conf: scoreRec.confidence, official: !!alert.officialTornadoWarning,
    });
    return alert;
}

function previousScore(storm) {
    const h = storm.scoreHistory;
    if (!h || h.length < 2) return null;
    return h[h.length - 2].score;
}

/** Alerts newer than `sinceIso`, or the whole feed. */
function since(sinceIso) {
    if (!sinceIso) return feed.slice();
    const t = Date.parse(sinceIso);
    if (!Number.isFinite(t)) return feed.slice();
    return feed.filter((x) => Date.parse(x.issued) > t);
}

function clearStorm(stormId) { lastAlertByStorm.delete(stormId); }
function clearAll() { feed.length = 0; lastAlertByStorm.clear(); }

module.exports = { evaluate, since, clearStorm, clearAll, DISCLAIMER, feed };
