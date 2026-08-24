/*
 * backend/tornado/engine.js
 * The scan loop: pick radar sites, process each new volume, keep state.
 *
 * Failure policy — the whole point of this file:
 *   - Every site is processed inside its own try/catch. A site that 404s,
 *     times out, or decodes to garbage is logged and skipped; the others carry
 *     on and the radar application itself is never affected.
 *   - The cycle itself is wrapped, so a bug in scoring cannot kill the timer.
 *   - Cycles never overlap. If a volume takes longer than the poll interval,
 *     the next tick is skipped rather than piling up decodes on top of a busy
 *     CPU.
 *   - Work is bounded: N sites concurrently, and a cap on environment lookups
 *     per cycle so a slow provider cannot stretch a cycle indefinitely.
 *
 * Cost profile: a poll for a site with no new volume is one HTTP directory
 * listing (a few KB). Decode + analysis only happens when the volume filename
 * changes — roughly once every 4-6 minutes per site.
 */

const radarSource = require('./radar_source');
const rotation = require('./rotation');
const storms = require('./storms');
const environment = require('./environment');
const nws = require('./nws');
const score = require('./score');
const history = require('./history');
const alerts = require('./alerts');
const geo = require('./geo');
const log = require('./logger');

const fs = require('fs');
const path = require('path');

let cfg = null;
let timer = null;
let running = false;          // a cycle is in flight
let started = false;
let deps = {};
let statePath = null;

const stats = {
    startedAt: null,
    cycles: 0,
    scansProcessed: 0,
    detections: 0,
    alertsFired: 0,
    lastCycleMs: 0,
    lastCycleAt: null,
    lastError: null,
    sites: [],
};

/* ── site selection ───────────────────────────────────────────────────────── */

function nearestSiteTo(lat, lon) {
    let best = null, bestD = Infinity;
    for (const id of radarSource.allSites()) {
        const loc = radarSource.siteLocation(id);
        if (!loc) continue;
        const d = geo.distanceKm(lat, lon, loc.lat, loc.lon);
        if (d < bestD) { bestD = d; best = id; }
    }
    // A site 400 km away is not covering that point in any useful way.
    return bestD <= 300 ? best : null;
}

/**
 * Which radars to watch this cycle. Explicit config wins; otherwise follow the
 * weather — radars near active warnings first, then near the user's saved
 * locations. This keeps a 24/7 deployment cheap on quiet days and focused on
 * active days without any manual intervention.
 */
async function selectSites() {
    if (cfg.sites && cfg.sites.length) return cfg.sites.slice(0, 40);
    const auto = cfg.autoSelectSites;
    if (!auto.enabled) return [];

    const chosen = new Set((auto.extraSites || []).map((s) => String(s).toUpperCase()));

    if (auto.fromNwsWarnings) {
        try {
            const centroids = await nws.activeTornadoWarningCentroids(cfg);
            // Tornado warnings first, then severe.
            centroids.sort((a, b) => (a.event === 'Tornado Warning' ? -1 : 1) - (b.event === 'Tornado Warning' ? -1 : 1));
            for (const c of centroids) {
                const site = nearestSiteTo(c.lat, c.lon);
                if (site) chosen.add(site);
                if (chosen.size >= auto.maxSites) break;
            }
        } catch (e) {
            log.warn('sites.warningLookupFailed', { err: e.message });
        }
    }

    if (auto.fromSavedLocations && chosen.size < auto.maxSites && typeof deps.getSavedLocations === 'function') {
        try {
            const locs = await deps.getSavedLocations();
            for (const l of locs || []) {
                if (!l || !Number.isFinite(l.lat) || !Number.isFinite(l.lon)) continue;
                const site = nearestSiteTo(l.lat, l.lon);
                if (site) chosen.add(site);
                if (chosen.size >= auto.maxSites) break;
            }
        } catch (e) {
            log.warn('sites.savedLocationsFailed', { err: e.message });
        }
    }

    return [...chosen].slice(0, auto.maxSites);
}

/* ── per-site processing ──────────────────────────────────────────────────── */

async function processSite(site, budget) {
    const scan = await radarSource.fetchLatestScan(site, cfg);
    if (!scan) return 0;               // nothing new, or this site failed (already logged)

    stats.scansProcessed++;
    const t0 = Date.now();

    // 1. rotation
    let detections = [];
    try {
        detections = rotation.detectCirculations(scan, cfg);
    } catch (e) {
        log.error('rotation.failed', { site, vol: scan.volume, err: e.message });
    }
    stats.detections += detections.length;

    // 2. storm cells + tracking
    let tracked = [];
    try {
        const cells = storms.findCells(scan, cfg);
        tracked = storms.trackCells(cells, scan, cfg);
        tracked = storms.attachCirculations(detections, tracked, scan, cfg);
    } catch (e) {
        log.error('storms.failed', { site, vol: scan.volume, err: e.message });
        return detections.length;
    }

    // 3. score each storm
    for (const st of tracked) {
        try {
            const rot = storms.analyzeRotation(st, cfg);

            // Environment is the slow, optional part. Spend the cycle's budget
            // on the storms that could actually matter.
            let env = st.environment;
            const worthEnv = st.circulation || (st.score && st.score.score >= 30);
            if (cfg.environment.enabled && worthEnv && budget.env > 0) {
                budget.env--;
                env = await environment.get(st.lat, st.lon, cfg, st.motion);
                if (env) st.environment = env;
            }

            let official = null;
            if (cfg.nws.enabled) {
                try { official = await nws.alertsAt(st.lat, st.lon, cfg); } catch { official = null; }
            }
            st.nwsWarning = official && official.tornadoWarning ? official.tornadoWarning : null;
            st.nwsAlerts = official ? official.all : [];

            const rec = score.computeScore(st, rot, st.environment, cfg);
            st.score = rec;
            st.rotationAnalysis = rot;
            st.projection = storms.projectPath(st, cfg);
            st.scoreHistory.push({ t: scan.time.getTime(), score: rec.score, category: rec.category });
            if (st.scoreHistory.length > 60) st.scoreHistory.shift();

            log.debug('score.computed', {
                storm: st.id, site, score: rec.score, cat: rec.category,
                conf: rec.confidence, trend: rot.trend, persist: Math.round(rot.persistenceMinutes),
            });

            // 4. alerting
            const alert = alerts.evaluate(st, rec, rot, official, cfg);
            if (alert) {
                stats.alertsFired++;
                if (typeof deps.onAlert === 'function') {
                    try { deps.onAlert(alert); } catch (e) { log.warn('alert.hookFailed', { err: e.message }); }
                }
            }

            // 5. historical record (fire and forget)
            if (cfg.history.enabled) {
                history.append(history.buildRecord(st, rot, st.environment, rec, official, scan), cfg);
            }
        } catch (e) {
            log.error('score.failed', { site, storm: st.id, err: e.message });
        }
    }

    if (cfg.logging.logScans) {
        log.info('scan.analysed', {
            site, vol: scan.volume, storms: tracked.length,
            circulations: detections.length, ms: Date.now() - t0,
        });
    }
    return detections.length;
}

/* ── cycle ────────────────────────────────────────────────────────────────── */

async function runCycle() {
    if (running) { log.debug('cycle.skipped', { reason: 'previous cycle still running' }); return; }
    running = true;
    const t0 = Date.now();
    try {
        const sites = await selectSites();
        stats.sites = sites;
        if (!sites.length) {
            log.debug('cycle.noSites', {});
            return;
        }
        const budget = { env: cfg.environment.maxPointsPerCycle };

        // Bounded concurrency: a simple worker pool over the site list.
        const queue = sites.slice();
        const workers = [];
        const width = Math.max(1, Math.min(cfg.scan.maxConcurrentSites, queue.length));
        for (let i = 0; i < width; i++) {
            workers.push((async () => {
                while (queue.length) {
                    const site = queue.shift();
                    try {
                        await processSite(site, budget);
                    } catch (e) {
                        // Per-site isolation: this is the line that guarantees one
                        // bad radar cannot affect any other site or the app.
                        log.error('site.failed', { site, err: e.message });
                    }
                }
            })());
        }
        await Promise.all(workers);

        stats.cycles++;
        persistState();
    } catch (e) {
        stats.lastError = e.message;
        log.error('cycle.failed', { err: e.message });
    } finally {
        stats.lastCycleMs = Date.now() - t0;
        stats.lastCycleAt = new Date().toISOString();
        running = false;
    }
}

/* ── state persistence (restart recovery) ─────────────────────────────────── */

function persistState() {
    if (!statePath) return;
    try {
        const payload = {
            savedAt: new Date().toISOString(),
            storms: storms.allStorms().map((s) => ({
                ...s,
                // Detections hold no references we need across a restart, and
                // dropping them keeps the file small.
                circulation: s.circulation ? { ...s.circulation } : null,
            })),
        };
        fs.writeFileSync(statePath, JSON.stringify(payload));
    } catch (e) {
        log.warn('state.saveFailed', { err: e.message });
    }
}

function restoreState() {
    if (!statePath) return;
    try {
        if (!fs.existsSync(statePath)) return;
        const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const age = Date.now() - Date.parse(raw.savedAt || 0);
        // Stale tracks are worse than none — a storm from two hours ago is not
        // where we left it.
        if (!Number.isFinite(age) || age > 30 * 60000) {
            log.info('state.discarded', { reason: 'stale', ageMin: Math.round(age / 60000) });
            return;
        }
        storms.hydrate(raw.storms);
        log.info('state.restored', { storms: (raw.storms || []).length, ageMin: Math.round(age / 60000) });
    } catch (e) {
        log.warn('state.restoreFailed', { err: e.message });
    }
}

/* ── lifecycle ────────────────────────────────────────────────────────────── */

function start(config, dependencies) {
    cfg = config;
    deps = dependencies || {};
    log.setLevel(cfg.logging.level);

    if (deps.dataDir) {
        history.init(deps.dataDir);
        statePath = path.join(deps.dataDir, 'tornado-state.json');
        restoreState();
    }

    if (!cfg.enabled) {
        log.info('engine.disabled', { hint: 'set enabled:true in config/tornado.json or TORNADO_ENABLED=1' });
        return;
    }
    if (started) return;
    started = true;
    stats.startedAt = new Date().toISOString();

    const everyMs = Math.max(15, cfg.scan.pollSeconds) * 1000;
    timer = setInterval(() => { runCycle(); }, everyMs);
    if (timer.unref) timer.unref();           // never hold the process open
    log.info('engine.started', { pollSeconds: cfg.scan.pollSeconds, historyDir: !!deps.dataDir });

    // Kick one cycle shortly after boot rather than waiting a full interval,
    // but late enough that it doesn't compete with server startup.
    setTimeout(() => runCycle(), 5000).unref?.();

    // Daily retention pass.
    const daily = setInterval(() => { try { history.prune(cfg); } catch { /* non-fatal */ } }, 6 * 3600 * 1000);
    if (daily.unref) daily.unref();
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    started = false;
    log.info('engine.stopped', {});
}

/** Apply a live config change without dropping tracked storms. */
function reconfigure(next) {
    const wasEnabled = cfg && cfg.enabled;
    cfg = next;
    log.setLevel(cfg.logging.level);
    if (cfg.enabled && !wasEnabled) { started = false; start(cfg, deps); }
    else if (!cfg.enabled && wasEnabled) stop();
    log.info('engine.reconfigured', { enabled: cfg.enabled, pollSeconds: cfg.scan.pollSeconds });
}

function getStats() {
    return {
        ...stats,
        enabled: !!(cfg && cfg.enabled),
        running,
        storms: storms.allStorms().length,
        siteHealth: radarSource.siteHealth(),
    };
}

module.exports = { start, stop, reconfigure, runCycle, getStats, selectSites, persistState };
