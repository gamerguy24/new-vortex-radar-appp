/*
 * backend/tornado/score.js
 * The Tornado Potential Score: eight weighted components, 0-100.
 *
 * THIS IS NOT A TORNADO FORECAST. It is a weighted summary of how strongly a
 * storm's radar presentation resembles presentations associated with tornadic
 * rotation. It carries no official standing and is never phrased as a warning.
 *
 * Two design decisions worth reading before changing anything:
 *
 * 1. MISSING DATA REDISTRIBUTES, IT DOES NOT ZERO.
 *    If the environment provider is down, the instability and helicity terms
 *    are unavailable. Scoring them as 0 would silently drag every storm's score
 *    down by 10 points and make a radar-only deployment look calm during a
 *    tornado outbreak. Instead their weight is redistributed across the
 *    components we do have, and the result is flagged `partial`.
 *
 * 2. PERSISTENCE MODIFIES, IT DOES NOT ADD.
 *    The eight configured weights must sum to 1 for the 0-100 range to mean
 *    anything, so rotation persistence and decay are applied afterwards as a
 *    bounded multiplier rather than as a ninth weight. A circulation that has
 *    held for several scans is meaningfully more significant than one that
 *    appeared in a single volume, and one that just collapsed is meaningfully
 *    less.
 */

const CATEGORIES = [
    { min: 80, name: 'EXTREME' },
    { min: 60, name: 'HIGH' },
    { min: 40, name: 'ELEVATED' },
    { min: 20, name: 'LOW' },
    { min: 0, name: 'VERY LOW' },
];

const MOD_DEFAULTS = {
    persistenceMaxBonus: 0.15,     // +15% at full persistence credit
    persistenceFullMinutes: 20,    // minutes of unbroken rotation for full credit
    decayFactor: 0.55,             // multiplier applied once rotation has ended
    aliasPenalty: 0.85,
    confidenceFloor: 0.45,         // fraction of the score a zero-confidence detection keeps
};

function clamp01(x) { return !Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 1 ? 1 : x; }
function lerp01(x, lo, hi) { return clamp01((x - lo) / (hi - lo)); }

function categoryFor(score) {
    for (const c of CATEGORIES) if (score >= c.min) return c.name;
    return 'VERY LOW';
}

/**
 * Rotational-velocity threshold for "strong", scaled with range.
 * Beam broadening means a circulation of fixed size is progressively
 * under-sampled with distance, so the same measured Vrot is more significant
 * far away than nearby. The scale mirrors the shape of the NWS mesocyclone
 * nomogram without pretending to reproduce it exactly.
 */
function strongVrotThreshold(rangeKm) {
    if (rangeKm <= 60) return 24;      // m/s
    if (rangeKm >= 180) return 16;
    return 24 - (rangeKm - 60) * (8 / 120);
}

/**
 * Compute the score for one storm.
 * @param {object} storm     tracked storm (with .circulation, .rotationHistory)
 * @param {object} rot       output of storms.analyzeRotation()
 * @param {object|null} env  environment.get() result, or null
 * @param {object} cfg
 * @returns {object} score record
 */
function computeScore(storm, rot, env, cfg) {
    const W = cfg.weights;
    const M = { ...MOD_DEFAULTS, ...(cfg.modifiers || {}) };
    const c = storm.circulation;

    // Each entry: subscore 0..1, or null when the input is unavailable.
    const parts = {};
    const detail = {};

    /* 1. Velocity couplet strength (30%) */
    if (c) {
        const thr = strongVrotThreshold(c.rangeKm);
        const byVrot = lerp01(c.vrot, thr * 0.45, thr * 1.5);
        const byDeltaV = lerp01(c.deltaV, cfg.detection.minDeltaVMs, 60);
        parts.coupletStrength = clamp01(0.65 * byVrot + 0.35 * byDeltaV);
        detail.vrotMs = c.vrot;
        detail.deltaVMs = c.deltaV;
        detail.vrotThresholdMs = thr;
    } else {
        parts.coupletStrength = 0;      // a storm with no couplet genuinely scores zero here
    }

    /* 2. Increasing azimuthal shear (20%)
     * Blended: how much shear there is, and whether it is growing. A strong,
     * steady couplet should not score zero just because it stopped intensifying. */
    if (c) {
        const magnitude = lerp01(c.shear, 0.003, 0.018);       // s^-1
        // With no history there is no trend to measure. Do NOT substitute a
        // neutral 0.5 — that hands half credit to a brand-new marginal couplet
        // and was inflating quiet-day scores into ELEVATED. Fall back to the
        // shear magnitude we actually measured.
        let trendPart = null;
        if (rot.previousVrot > 0) {
            trendPart = clamp01(0.5 + (rot.shearChange / 0.006) * 0.5);
        }
        parts.shearIncrease = trendPart === null ? magnitude : clamp01(0.55 * magnitude + 0.45 * trendPart);
        detail.azimuthalShear = c.shear;
        detail.shearChange = rot.shearChange;
    } else {
        parts.shearIncrease = 0;
    }

    /* 3. Low-level rotation (15%)
     * Credit is proportional to how close to the ground the measurement is. A
     * couplet sampled at 4 km says little about a tornado at the surface. */
    if (c) {
        const maxLow = cfg.detection.maxBeamHeightKmForLowLevel;
        const lowness = clamp01(1 - (c.beamHeightKm / Math.max(0.5, maxLow)));
        parts.lowLevelRotation = clamp01(lowness * lerp01(c.vrot, 8, 25));
        detail.beamHeightKm = c.beamHeightKm;
    } else {
        parts.lowLevelRotation = 0;
    }

    /* 4. Rotation tightening (10%) — a contracting couplet at constant or
     * rising strength is the classic pre-tornadic signal. */
    if (c && Number.isFinite(rot.tightening)) {
        parts.rotationTightening = clamp01(0.5 + rot.tightening * 2.0);
        detail.tightening = rot.tightening;
    } else {
        // No prior scan to compare against: unknown, so redistribute its weight
        // rather than award half credit for a trend we have not observed.
        parts.rotationTightening = c ? null : 0;
    }

    /* 5. Reflectivity / storm structure (10%) */
    {
        const byDbz = lerp01(storm.maxDbz, 40, 65);
        const byArea = lerp01(storm.areaKm2 || 0, 20, 400);
        parts.stormStructure = clamp01(0.75 * byDbz + 0.25 * byArea);
        detail.maxDbz = storm.maxDbz;
    }

    /* 6. Storm-relative velocity (5%)
     * We have no SRV product, but we can approximate what it is for: after
     * removing the storm's own motion along the radar beam, a true rotation is
     * roughly symmetric about zero (equal inbound and outbound). A gust front or
     * a sheared outflow boundary is not. Symmetry is the useful part of SRV. */
    if (c && Number.isFinite(c.vMax) && Number.isFinite(c.vMin)) {
        let motionRadial = 0;
        if (storm.motion && storm.motion.speedKmh > 0) {
            const ms = storm.motion.speedKmh / 3.6;
            // Component of storm motion along the radar's viewing azimuth.
            const rel = ((storm.motion.direction - c.azimuth) * Math.PI) / 180;
            motionRadial = ms * Math.cos(rel);
        }
        const outSR = c.vMax - motionRadial;
        const inSR = c.vMin - motionRadial;
        const asymmetry = Math.abs(outSR + inSR) / Math.max(1, Math.abs(outSR - inSR));
        parts.stormRelativeVelocity = clamp01(1 - asymmetry);
        detail.srvSymmetry = parts.stormRelativeVelocity;
        detail.stormMotionRadialMs = motionRadial;
    } else {
        parts.stormRelativeVelocity = null;   // unmeasurable → redistribute
    }

    /* 7. Environmental instability (5%) */
    if (env && Number.isFinite(env.cape)) {
        const capePart = lerp01(env.cape, 250, 3000);
        // Strong capping suppresses; treat CIN as a modest penalty, not a veto.
        const cinPart = Number.isFinite(env.cin) ? clamp01(1 - Math.abs(env.cin) / 250) : 1;
        parts.instability = clamp01(capePart * (0.6 + 0.4 * cinPart));
        detail.cape = env.cape;
        detail.cin = env.cin;
    } else {
        parts.instability = null;       // unavailable → weight redistributes
    }

    /* 8. Low-level helicity / wind shear (5%) */
    if (env && (Number.isFinite(env.srh01) || Number.isFinite(env.shear06Ms))) {
        const srhPart = Number.isFinite(env.srh01) ? lerp01(env.srh01, 50, 300) : null;
        const shearPart = Number.isFinite(env.shear06Ms) ? lerp01(env.shear06Ms, 10, 25) : null;
        const lclPart = Number.isFinite(env.lclHeightM) ? clamp01(1 - lerp01(env.lclHeightM, 800, 2000)) : null;
        const avail = [srhPart, shearPart, lclPart].filter((x) => x !== null);
        parts.helicityShear = avail.length ? clamp01(avail.reduce((a, b) => a + b, 0) / avail.length) : null;
        detail.srh01 = env.srh01;
        detail.srh03 = env.srh03;
        detail.shear06Ms = env.shear06Ms;
        detail.lclHeightM = env.lclHeightM;
    } else {
        parts.helicityShear = null;
    }

    /* ── weighted sum with redistribution over available components ── */
    let weightAvailable = 0, weighted = 0;
    const missing = [];
    for (const k of Object.keys(W)) {
        const v = parts[k];
        if (v === null || v === undefined) { missing.push(k); continue; }
        weightAvailable += W[k];
        weighted += W[k] * v;
    }
    let base = weightAvailable > 0 ? weighted / weightAvailable : 0;

    /* ── persistence / decay modifier ── */
    let modifier = 1;
    if (c) {
        const persistCredit = clamp01(rot.persistenceMinutes / Math.max(1, M.persistenceFullMinutes));
        modifier *= 1 + M.persistenceMaxBonus * persistCredit;
    }
    if (rot.trend === 'ENDED' || !c) modifier *= M.decayFactor;
    if (c && c.aliasSuspect) modifier *= M.aliasPenalty;

    // A score is only as good as the measurement under it. Without this, a
    // marginal, poorly-sampled couplet in weak echo reported ELEVATED on a quiet
    // afternoon purely from component defaults. Scale by the detection's own
    // confidence so an uncertain measurement reads as uncertain.
    if (c) modifier *= (M.confidenceFloor + (1 - M.confidenceFloor) * c.confidence.value);

    const score = Math.max(0, Math.min(100, Math.round(base * 100 * modifier)));

    // Confidence in the SCORE is the detection confidence tempered by how much
    // of the model actually had data.
    const completeness = weightAvailable;
    const detConf = c ? c.confidence.value : 0;
    const confValue = clamp01(detConf * (0.75 + 0.25 * completeness));

    return {
        score,
        category: categoryFor(score),
        confidence: confValue >= 0.66 ? 'HIGH' : confValue >= 0.38 ? 'MEDIUM' : 'LOW',
        confidenceValue: Number(confValue.toFixed(3)),
        components: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v === null ? null : Number(v.toFixed(3))])),
        weightsUsed: W,
        missingComponents: missing,
        partial: missing.length > 0,
        modifier: Number(modifier.toFixed(3)),
        detail,
        computedAt: new Date().toISOString(),
    };
}

module.exports = { computeScore, categoryFor, strongVrotThreshold, CATEGORIES, MOD_DEFAULTS };
