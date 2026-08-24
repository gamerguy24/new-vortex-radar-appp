/*
 * backend/tornado/api.js
 * JSON API for the Tornado Potential system.
 *
 * Every payload that carries a score also carries `experimental: true` and the
 * disclaimer, so there is no route by which a client can receive a score
 * without also receiving the fact that it is not an official warning. Official
 * NWS products travel in their own `official` field and are never merged into
 * the experimental numbers.
 *
 * Routes (all under the mount point, /api):
 *   GET /tornado-potential              active storms with a score, ranked
 *   GET /tornado-potential/:stormId     one storm, full detail
 *   GET /storms                         every tracked storm
 *   GET /storms/:stormId                one storm
 *   GET /rotation                       current circulations only
 *   GET /rotation/history/:stormId      that storm's scan-by-scan rotation
 *   GET /tornado-potential/alerts/feed   recent threshold crossings
 *   GET /tornado-potential/meta/status   engine health (admin)
 *   GET /tornado-potential/replay/days   days with recorded history
 *   GET /tornado-potential/replay/:day   recorded observations for a day
 */

const express = require('express');
const storms = require('./storms');
const alertsMod = require('./alerts');
const engine = require('./engine');
const history = require('./history');
const configMod = require('./config');
const log = require('./logger');
const geo = require('./geo');

const DISCLAIMER = alertsMod.DISCLAIMER;

function toMph(kmh) { return kmh == null ? null : Math.round(kmh * 0.621371); }

/** Public shape of a tracked storm. */
function serializeStorm(st, full) {
    const c = st.circulation;
    const rot = st.rotationAnalysis || {};
    const out = {
        stormId: st.id,
        site: st.site,
        latitude: Number(st.lat.toFixed(4)),
        longitude: Number(st.lon.toFixed(4)),
        score: st.score ? st.score.score : 0,
        category: st.score ? st.score.category : 'VERY LOW',
        confidence: st.score ? st.score.confidence : 'LOW',
        rotation: rot.strength || 'NONE',
        trend: rot.trend || 'NONE',
        persistenceMinutes: Math.round(rot.persistenceMinutes || 0),
        maxReflectivityDbz: st.maxDbz != null ? Number(st.maxDbz.toFixed(1)) : null,
        maxVelocityDifferentialMs: c ? Number(c.deltaV.toFixed(1)) : 0,
        rotationalVelocityMs: c ? Number(c.vrot.toFixed(1)) : 0,
        azimuthalShear: c ? Number(c.shear.toFixed(5)) : 0,
        coupletDiameterKm: c ? Number(c.diameterKm.toFixed(2)) : null,
        beamHeightKm: c ? Number(c.beamHeightKm.toFixed(2)) : null,
        stormMotion: st.motion ? {
            direction: Math.round(st.motion.direction),
            compass: geo.compass(st.motion.direction),
            speedMph: toMph(st.motion.speedKmh),
            speedKmh: Number(st.motion.speedKmh.toFixed(1)),
        } : null,
        firstSeen: new Date(st.firstSeenMs).toISOString(),
        lastSeen: new Date(st.lastSeenMs).toISOString(),
        // Official products, kept strictly separate from the experimental score.
        official: {
            tornadoWarning: st.nwsWarning || null,
            hasOfficialWarning: !!st.nwsWarning,
        },
        experimental: true,
    };

    if (full) {
        out.projectedStormMotion = st.projection || [];
        out.rotationProjection = (c && st.projection && st.projection.length && rot.strength && rot.strength !== 'NONE' && rot.strength !== 'WEAK')
            ? st.projection.map((p) => ({ ...p, note: 'Rotation projection assumes the circulation continues with the parent storm motion.' }))
            : [];
        out.scoreBreakdown = st.score ? {
            components: st.score.components,
            weights: st.score.weightsUsed,
            missingComponents: st.score.missingComponents,
            partial: st.score.partial,
            modifier: st.score.modifier,
            detail: st.score.detail,
        } : null;
        out.circulation = c ? {
            latitude: Number(c.lat.toFixed(4)),
            longitude: Number(c.lon.toFixed(4)),
            radiusKm: Number(c.radiusKm.toFixed(2)),
            cyclonic: c.cyclonic,
            rangeKm: Number(c.rangeKm.toFixed(1)),
            azimuth: Number(c.azimuth.toFixed(1)),
            reflectivityDbz: c.dbz,
            aliasSuspect: c.aliasSuspect,
            supportingGates: c.supportingGates,
            confidence: c.confidence,
        } : null;
        out.environment = st.environment || null;
        out.scoreHistory = (st.scoreHistory || []).map((s) => ({ time: new Date(s.t).toISOString(), score: s.score, category: s.category }));
        out.tightening = Number.isFinite(rot.tightening) ? Number(rot.tightening.toFixed(3)) : null;
        out.officialAlerts = st.nwsAlerts || [];
    }
    return out;
}

function envelope(extra) {
    return {
        generatedAt: new Date().toISOString(),
        experimental: true,
        product: 'VORTEX RADAR EXPERIMENTAL — TORNADO POTENTIAL',
        disclaimer: DISCLAIMER,
        ...extra,
    };
}

function createRouter(opts) {
    const router = express.Router();
    const requireAdmin = (opts && opts.requireAdmin) || ((req, res, next) => next());

    // ── scored storms ──
    router.get('/tornado-potential', (req, res) => {
        const min = Number(req.query.minScore) || 0;
        const list = storms.allStorms()
            .filter((s) => s.score && s.score.score >= min)
            .sort((a, b) => (b.score ? b.score.score : 0) - (a.score ? a.score.score : 0))
            .map((s) => serializeStorm(s, false));
        res.json(envelope({
            count: list.length,
            activeCirculations: storms.allStorms().filter((s) => s.circulation).length,
            storms: list,
        }));
    });

    router.get('/tornado-potential/alerts/feed', (req, res) => {
        res.json(envelope({ alerts: alertsMod.since(req.query.since) }));
    });

    router.get('/tornado-potential/meta/status', requireAdmin, (req, res) => {
        res.json(envelope({
            engine: engine.getStats(),
            config: {
                path: configMod.CONFIG_PATH,
                enabled: configMod.get().enabled,
                weights: configMod.get().weights,
                pollSeconds: configMod.get().scan.pollSeconds,
                sites: configMod.get().sites,
                autoSelectSites: configMod.get().autoSelectSites,
            },
            log: log.recent(Number(req.query.log) || 60),
        }));
    });

    // ── historical replay ──
    router.get('/tornado-potential/replay/days', (req, res) => {
        res.json(envelope({ days: history.availableDays() }));
    });

    router.get('/tornado-potential/replay/:day', (req, res) => {
        const day = String(req.params.day || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'day must be YYYY-MM-DD' });
        const site = req.query.site ? String(req.query.site).toUpperCase() : null;
        const minScore = Number(req.query.minScore) || 0;
        const rows = history.readDay(day, (r) => (!site || r.site === site) && r.score >= minScore);
        res.json(envelope({
            day,
            count: rows.length,
            note: 'Recorded engine output for this UTC day, for evaluating how the algorithm performed.',
            observations: rows,
        }));
    });

    router.get('/tornado-potential/:stormId', (req, res) => {
        const st = storms.getStorm(req.params.stormId);
        if (!st) return res.status(404).json({ error: 'Unknown storm id' });
        res.json(envelope({ storm: serializeStorm(st, true) }));
    });

    // ── storms ──
    router.get('/storms', (req, res) => {
        const site = req.query.site ? String(req.query.site).toUpperCase() : null;
        const list = (site ? storms.stormsForSite(site) : storms.allStorms())
            .sort((a, b) => (b.score ? b.score.score : 0) - (a.score ? a.score.score : 0))
            .map((s) => serializeStorm(s, false));
        res.json(envelope({ count: list.length, storms: list }));
    });

    router.get('/storms/:stormId', (req, res) => {
        const st = storms.getStorm(req.params.stormId);
        if (!st) return res.status(404).json({ error: 'Unknown storm id' });
        res.json(envelope({ storm: serializeStorm(st, true) }));
    });

    // ── rotation ──
    router.get('/rotation', (req, res) => {
        const list = storms.allStorms()
            .filter((s) => s.circulation)
            .sort((a, b) => b.circulation.deltaV - a.circulation.deltaV)
            .map((s) => ({
                stormId: s.id,
                site: s.site,
                latitude: Number(s.circulation.lat.toFixed(4)),
                longitude: Number(s.circulation.lon.toFixed(4)),
                deltaVMs: Number(s.circulation.deltaV.toFixed(1)),
                rotationalVelocityMs: Number(s.circulation.vrot.toFixed(1)),
                azimuthalShear: Number(s.circulation.shear.toFixed(5)),
                diameterKm: Number(s.circulation.diameterKm.toFixed(2)),
                radiusKm: Number(s.circulation.radiusKm.toFixed(2)),
                cyclonic: s.circulation.cyclonic,
                beamHeightKm: Number(s.circulation.beamHeightKm.toFixed(2)),
                confidence: s.circulation.confidence,
                score: s.score ? s.score.score : 0,
                category: s.score ? s.score.category : 'VERY LOW',
                detectedAt: new Date(s.lastSeenMs).toISOString(),
            }));
        res.json(envelope({ count: list.length, circulations: list }));
    });

    router.get('/rotation/history/:stormId', (req, res) => {
        const st = storms.getStorm(req.params.stormId);
        if (!st) return res.status(404).json({ error: 'Unknown storm id' });
        res.json(envelope({
            stormId: st.id,
            site: st.site,
            history: (st.rotationHistory || []).map((h) => ({
                time: new Date(h.t).toISOString(),
                deltaVMs: Number(h.deltaV.toFixed(1)),
                rotationalVelocityMs: Number(h.vrot.toFixed(1)),
                azimuthalShear: Number(h.shear.toFixed(5)),
                diameterKm: h.diameterKm != null ? Number(h.diameterKm.toFixed(2)) : null,
                beamHeightKm: h.beamHeightKm != null ? Number(h.beamHeightKm.toFixed(2)) : null,
                confidence: Number(h.confidence.toFixed(3)),
            })),
            analysis: st.rotationAnalysis || null,
            scoreHistory: (st.scoreHistory || []).map((s) => ({ time: new Date(s.t).toISOString(), score: s.score, category: s.category })),
        }));
    });

    return router;
}

module.exports = { createRouter, serializeStorm, DISCLAIMER };
