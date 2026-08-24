/*
 * backend/tornado/config.js
 * Loads config/tornado.json, merges it over the built-in defaults, and watches
 * the file so edits take effect without restarting the radar server.
 *
 * Every tunable in the Tornado Potential system lives here. Nothing else in the
 * engine hardcodes a threshold — if you find one, it is a bug.
 *
 * Environment overrides (useful for systemd drop-ins):
 *   TORNADO_ENABLED=1            turn the engine on
 *   TORNADO_SITES=KFFC,KGWX      explicit radar sites (disables auto-select)
 *   TORNADO_POLL_SECONDS=60      scan cadence
 *   TORNADO_CONFIG=/path.json    use a different config file
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    enabled: false,
    sites: [],
    autoSelectSites: { enabled: true, maxSites: 6, fromNwsWarnings: true, fromSavedLocations: true, extraSites: [] },
    scan: { pollSeconds: 60, siteTimeoutMs: 90000, maxConcurrentSites: 2, minVolumeAgeSeconds: 0, staleVolumeMinutes: 20 },
    weights: {
        coupletStrength: 0.30, shearIncrease: 0.20, lowLevelRotation: 0.15, rotationTightening: 0.10,
        stormStructure: 0.10, stormRelativeVelocity: 0.05, instability: 0.05, helicityShear: 0.05,
    },
    detection: {
        minRangeKm: 8, maxRangeKm: 230, minReflectivityDbz: 35, reflectivitySearchKm: 3,
        minDeltaVMs: 20, minRotationalVelocityMs: 10, maxCoupletDiameterKm: 12, minSupportingGates: 4,
        maxBeamHeightKmForLowLevel: 3.0, azimuthWindow: 4, gateWindow: 4, nyquistAliasFactor: 0.92,
        seedLags: [1, 3, 6],
    },
    storms: {
        cellReflectivityDbz: 40, gridKm: 2, minCellGates: 6, maxTrackDistanceKm: 20,
        maxCoastMinutes: 15, circulationAttachKm: 15, projectionMinutes: [15, 30, 45, 60],
    },
    environment: { enabled: true, provider: 'open-meteo', cacheMinutes: 30, timeoutMs: 8000, maxPointsPerCycle: 4 },
    nws: { enabled: true, cacheSeconds: 60, timeoutMs: 8000 },
    alerts: { enabled: true, minScore: 60, minConfidence: 'MEDIUM', cooldownMinutes: 10, minScoreIncrease: 10, maxFeedLength: 200 },
    history: { enabled: true, maxFileMb: 64, retainDays: 90 },
    modifiers: { persistenceMaxBonus: 0.15, persistenceFullMinutes: 20, decayFactor: 0.55, aliasPenalty: 0.85 },
    ml: { enabled: false, modelPath: "", blendWeight: 0 },
    logging: { level: 'info', logScans: true, logDetections: true },
};

const CONFIG_PATH = process.env.TORNADO_CONFIG
    || path.join(__dirname, '..', '..', 'config', 'tornado.json');

let current = null;
let watching = false;
const listeners = [];

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

// Deep-merge `over` onto `base` without mutating either. Arrays replace wholesale
// (a partial array of weights would be meaningless).
function merge(base, over) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!isPlainObject(over)) return out;
    for (const k of Object.keys(over)) {
        if (k.startsWith('_')) continue; // comment keys
        const b = out[k], o = over[k];
        out[k] = (isPlainObject(b) && isPlainObject(o)) ? merge(b, o) : o;
    }
    return out;
}

function applyEnv(cfg) {
    const c = merge(cfg, {});
    if (process.env.TORNADO_ENABLED != null) {
        c.enabled = /^(1|true|yes|on)$/i.test(String(process.env.TORNADO_ENABLED));
    }
    if (process.env.TORNADO_SITES) {
        c.sites = String(process.env.TORNADO_SITES).split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    }
    if (process.env.TORNADO_POLL_SECONDS) {
        const n = parseInt(process.env.TORNADO_POLL_SECONDS, 10);
        if (Number.isFinite(n) && n > 0) c.scan.pollSeconds = n;
    }
    return c;
}

// Weights must sum to 1 or the 0-100 score stops meaning anything. Rather than
// refusing to run on a typo, normalize and say so.
function normalizeWeights(cfg, warn) {
    const w = cfg.weights || {};
    const keys = Object.keys(DEFAULTS.weights);
    let sum = 0;
    for (const k of keys) {
        const v = Number(w[k]);
        w[k] = Number.isFinite(v) && v >= 0 ? v : 0;
        sum += w[k];
    }
    if (sum <= 0) {
        cfg.weights = { ...DEFAULTS.weights };
        if (warn) warn('all weights were zero or invalid — falling back to defaults');
        return cfg;
    }
    if (Math.abs(sum - 1) > 0.001) {
        for (const k of keys) w[k] = w[k] / sum;
        if (warn) warn(`weights summed to ${sum.toFixed(3)}, normalized to 1.0`);
    }
    cfg.weights = w;
    return cfg;
}

function readFile() {
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        if (e.code !== 'ENOENT') {
            console.warn('[TORNADO] config parse failed (' + e.message + ') — using previous/default values');
        }
        return null;
    }
}

function load(warn) {
    const file = readFile();
    const cfg = normalizeWeights(applyEnv(merge(DEFAULTS, file || {})), warn);
    current = cfg;
    return cfg;
}

function get() { return current || load(); }

/** Re-read the file on change so operators can retune a live system. */
function watch(onChange) {
    if (typeof onChange === 'function') listeners.push(onChange);
    if (watching) return;
    watching = true;
    try {
        fs.watch(path.dirname(CONFIG_PATH), (evt, filename) => {
            if (filename && filename !== path.basename(CONFIG_PATH)) return;
            clearTimeout(watch._t);
            watch._t = setTimeout(() => {                 // debounce editor double-writes
                const before = JSON.stringify(current);
                const after = JSON.stringify(load());
                if (before !== after) listeners.forEach((fn) => { try { fn(current); } catch (e) { /* listener's problem */ } });
            }, 400);
        });
    } catch (e) {
        // Watching is a convenience (some filesystems/containers don't support
        // it). The engine still runs with whatever was loaded at startup.
        console.warn('[TORNADO] config watch unavailable:', e.message);
    }
}

module.exports = { get, load, watch, CONFIG_PATH, DEFAULTS };
