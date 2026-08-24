/*
 * backend/tornado/index.js
 * Mount point for the Tornado Potential system.
 *
 * Wired into server.js the same way the other optional subsystems are:
 *
 *   require('./backend/tornado').attachTornado({
 *       app, requireAuth, requireAdmin, DATA_DIR, readJson,
 *   });
 *
 * The entire attach is wrapped by the caller in try/catch, and everything
 * inside is defensive as well: if the tornado engine cannot start for any
 * reason, the radar application must continue to serve normally. That is the
 * single hard requirement of this file.
 *
 * The engine does NOT run by default. It stays dormant until
 * config/tornado.json sets enabled:true (or TORNADO_ENABLED=1), so deploying
 * this code changes nothing about an existing install until you ask for it.
 */

const configMod = require('./config');
const engine = require('./engine');
const api = require('./api');
const log = require('./logger');

function attachTornado(opts) {
    const { app, requireAuth, requireAdmin, DATA_DIR } = opts || {};
    if (!app) throw new Error('attachTornado requires an express app');

    const cfg = configMod.load((msg) => log.warn('config.normalized', { msg }));
    log.setLevel(cfg.logging.level);

    // API first, so the endpoints exist even when the engine is disabled (they
    // simply report an empty, disabled system — much easier to debug than 404s).
    const router = api.createRouter({ requireAdmin });
    if (typeof requireAuth === 'function') app.use('/api', requireAuth, router);
    else app.use('/api', router);

    // Saved locations feed the automatic radar-site selection when the operator
    // has not pinned sites explicitly. Read defensively — the file is owned by
    // the Critical Weather Alerts feature and may not exist.
    const path = require('path');
    const getSavedLocations = () => {
        try {
            if (!DATA_DIR || typeof opts.readJson !== 'function') return [];
            // Written by critical_alerts.js as { userId: [location, ...] }.
            const store = opts.readJson(path.join(DATA_DIR, 'crit_locations.json'), null) || {};
            const out = [];
            for (const key of Object.keys(store)) {
                const list = Array.isArray(store[key]) ? store[key] : (store[key] && store[key].locations) || [];
                for (const l of list) {
                    if (l && Number.isFinite(l.lat) && Number.isFinite(l.lon)) out.push({ lat: l.lat, lon: l.lon });
                }
            }
            return out;
        } catch { return []; }
    };

    try {
        engine.start(cfg, { dataDir: DATA_DIR, getSavedLocations });
    } catch (e) {
        log.error('engine.startFailed', { err: e.message });
    }

    // Retune a running system by editing the config file.
    configMod.watch((next) => {
        try { engine.reconfigure(next); }
        catch (e) { log.error('engine.reconfigureFailed', { err: e.message }); }
    });

    log.info('tornado.attached', {
        enabled: cfg.enabled,
        endpoints: '/api/tornado-potential, /api/storms, /api/rotation',
    });

    return { engine, config: configMod, router };
}

module.exports = { attachTornado, engine, config: configMod };
