/*
 * backend/tornado/logger.js
 * Structured, timestamped logging for the Tornado Potential engine.
 *
 * Every line carries an ISO timestamp, a level, an event name, and (where one
 * exists) the storm or site it belongs to, so a run can be reconstructed after
 * the fact:
 *
 *   2026-08-24T18:04:11.204Z [TORNADO] scan.received   site=KFFC vol=KFFC20260824_180352_V06 gates=1832
 *   2026-08-24T18:04:11.881Z [TORNADO] rotation.found  site=KFFC storm=ST-1024 dv=31.4 shear=0.0121
 *
 * A ring buffer of the most recent lines is kept in memory so the admin API can
 * show recent activity without shelling into the box for journalctl.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const TAG = '[TORNADO]';
const RING_MAX = 400;

let levelName = 'info';
const ring = [];

function setLevel(name) {
    if (Object.prototype.hasOwnProperty.call(LEVELS, name)) levelName = name;
}

function fmtFields(fields) {
    if (!fields) return '';
    const parts = [];
    for (const k of Object.keys(fields)) {
        const v = fields[k];
        if (v === undefined || v === null) continue;
        parts.push(k + '=' + (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')) : String(v)));
    }
    return parts.length ? ' ' + parts.join(' ') : '';
}

function emit(level, event, fields) {
    const line = {
        t: new Date().toISOString(),
        level,
        event,
        ...(fields || {}),
    };
    ring.push(line);
    if (ring.length > RING_MAX) ring.shift();

    if (LEVELS[level] > LEVELS[levelName]) return;
    const text = `${line.t} ${TAG} ${event}${fmtFields(fields)}`;
    if (level === 'error') console.error(text);
    else if (level === 'warn') console.warn(text);
    else console.log(text);
}

module.exports = {
    setLevel,
    error: (event, fields) => emit('error', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    info: (event, fields) => emit('info', event, fields),
    debug: (event, fields) => emit('debug', event, fields),
    /** Most recent log lines, newest last. For the admin/status endpoint. */
    recent: (n = 100) => ring.slice(-Math.max(1, Math.min(n, RING_MAX))),
};
