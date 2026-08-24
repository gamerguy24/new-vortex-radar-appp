/*
 * backend/tornado/history.js
 * Append-only observation log — the training set a future ML model would learn
 * from, written now so that by the time a model is wanted the data already
 * exists. Retro-fitting a dataset after the fact is impossible; radar volumes
 * age out of the free mirrors.
 *
 * One JSON object per line (JSONL), one file per UTC day:
 *   data/historical/tornado-YYYY-MM-DD.jsonl
 *
 * Each record is a complete feature vector plus the labels a supervised model
 * needs: whether an official NWS tornado warning was in force at that place and
 * time, and (filled in later, see labelReports) whether a tornado was actually
 * confirmed there.
 *
 * The pipeline this feeds:
 *   Rule-Based Detection → Feature Extraction → Historical Dataset →
 *   ML Model → Probability Calibration → Tornado Potential Score
 * Only the first three stages exist today. Nothing here claims otherwise.
 */

const fs = require('fs');
const path = require('path');
const log = require('./logger');

let DIR = null;
let writeQueue = Promise.resolve();

function init(dataDir) {
    DIR = path.join(dataDir, 'historical');
    try {
        fs.mkdirSync(DIR, { recursive: true });
    } catch (e) {
        log.warn('history.mkdirFailed', { dir: DIR, err: e.message });
        DIR = null;
    }
}

function fileFor(date) {
    const d = date || new Date();
    const stamp = d.toISOString().slice(0, 10);
    return path.join(DIR, `tornado-${stamp}.jsonl`);
}

/**
 * Flatten one storm's state at one scan into a single feature row.
 * Keep this stable — every column change splits the dataset.
 */
function buildRecord(storm, rot, env, scoreRec, official, scan) {
    const c = storm.circulation;
    return {
        // identity / time
        t: new Date(scan.time).toISOString(),
        stormId: storm.id,
        site: scan.site,
        volume: scan.volume,

        // geometry
        radarLat: scan.radar.lat,
        radarLon: scan.radar.lon,
        lat: storm.lat,
        lon: storm.lon,
        rangeKm: c ? c.rangeKm : null,
        azimuth: c ? c.azimuth : null,
        beamHeightKm: c ? c.beamHeightKm : null,
        tiltDeg: scan.vel ? scan.vel.elevationAngle : null,

        // reflectivity / structure
        maxDbz: storm.maxDbz,
        areaKm2: storm.areaKm2,

        // velocity / rotation
        deltaVMs: c ? c.deltaV : 0,
        vrotMs: c ? c.vrot : 0,
        azimuthalShear: c ? c.shear : 0,
        coupletDiameterKm: c ? c.diameterKm : null,
        cyclonic: c ? c.cyclonic : null,
        aliasSuspect: c ? c.aliasSuspect : null,
        supportingGates: c ? c.supportingGates : 0,
        detectionConfidence: c ? c.confidence.value : 0,

        // multi-scan
        trend: rot.trend,
        persistenceMinutes: Number(rot.persistenceMinutes.toFixed(2)),
        tightening: Number.isFinite(rot.tightening) ? Number(rot.tightening.toFixed(4)) : null,
        shearChange: Number.isFinite(rot.shearChange) ? Number(rot.shearChange.toFixed(6)) : null,
        rotationStrength: rot.strength,

        // motion
        motionDirection: storm.motion ? Number(storm.motion.direction.toFixed(1)) : null,
        motionSpeedKmh: storm.motion ? Number(storm.motion.speedKmh.toFixed(1)) : null,

        // environment (nulls are meaningful — they mark radar-only rows)
        cape: env ? env.cape : null,
        cin: env ? env.cin : null,
        liftedIndex: env ? env.liftedIndex : null,
        shear01Ms: env ? env.shear01Ms : null,
        shear03Ms: env ? env.shear03Ms : null,
        shear06Ms: env ? env.shear06Ms : null,
        srh01: env ? env.srh01 : null,
        srh03: env ? env.srh03 : null,
        lclHeightM: env ? env.lclHeightM : null,
        temperatureC: env ? env.temperatureC : null,
        dewPointC: env ? env.dewPointC : null,

        // engine output
        score: scoreRec.score,
        category: scoreRec.category,
        confidence: scoreRec.confidence,
        scoreComponents: scoreRec.components,
        scorePartial: scoreRec.partial,

        // ── labels ──
        officialTornadoWarning: !!(official && official.tornadoWarning),
        officialSevereWarning: !!(official && official.severeWarning),
        officialTornadoWatch: !!(official && official.tornadoWatch),
        officialTornadoDetection: official && official.tornadoWarning ? official.tornadoWarning.tornadoDetection : null,
        // Filled in later by labelReports(); null = not yet labelled, which is
        // NOT the same as "no tornado".
        confirmedTornado: null,
    };
}

/** Append one record. Serialised through a promise chain so lines never interleave. */
function append(record, cfg) {
    if (!DIR || !cfg.history.enabled) return Promise.resolve();
    writeQueue = writeQueue.then(() => new Promise((resolve) => {
        const file = fileFor(new Date(record.t));
        fs.appendFile(file, JSON.stringify(record) + '\n', (err) => {
            if (err) log.warn('history.writeFailed', { err: err.message });
            resolve();
        });
    })).catch(() => { /* never let the chain die */ });
    return writeQueue;
}

/** Read records for a UTC day, optionally filtered. */
function readDay(dayIso, filter) {
    if (!DIR) return [];
    const file = path.join(DIR, `tornado-${dayIso}.jsonl`);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
    const out = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
            const rec = JSON.parse(line);
            if (!filter || filter(rec)) out.push(rec);
        } catch { /* skip a torn line rather than failing the read */ }
    }
    return out;
}

/** Every UTC day that has data, newest first. */
function availableDays() {
    if (!DIR) return [];
    try {
        return fs.readdirSync(DIR)
            .filter((f) => /^tornado-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
            .map((f) => f.slice(8, 18))
            .sort()
            .reverse();
    } catch { return []; }
}

/** Delete files past the retention window. */
function prune(cfg) {
    if (!DIR || !cfg.history.enabled) return;
    const cutoff = Date.now() - cfg.history.retainDays * 86400000;
    for (const day of availableDays()) {
        if (Date.parse(day + 'T00:00:00Z') < cutoff) {
            try {
                fs.unlinkSync(path.join(DIR, `tornado-${day}.jsonl`));
                log.info('history.pruned', { day });
            } catch (e) { log.warn('history.pruneFailed', { day, err: e.message }); }
        }
    }
}

/**
 * Attach confirmed-tornado labels to a past day, rewriting the file in place.
 * `reports` is [{lat, lon, timeIso}] — e.g. from the SPC storm reports CSV.
 * A record is labelled true when a report falls within `radiusKm` and
 * `windowMinutes` of it.
 *
 * This is the step that turns the log into supervised training data. It is
 * deliberately manual: automatic labelling from unverified reports would bake
 * bad labels into the dataset permanently.
 */
function labelReports(dayIso, reports, radiusKm = 15, windowMinutes = 30) {
    if (!DIR) return { updated: 0 };
    const geo = require('./geo');
    const rows = readDay(dayIso);
    if (!rows.length) return { updated: 0 };
    let updated = 0;
    for (const r of rows) {
        const t = Date.parse(r.t);
        let hit = false;
        for (const rep of reports || []) {
            const rt = Date.parse(rep.timeIso);
            if (!Number.isFinite(rt) || Math.abs(rt - t) > windowMinutes * 60000) continue;
            if (geo.distanceKm(r.lat, r.lon, rep.lat, rep.lon) <= radiusKm) { hit = true; break; }
        }
        const next = !!hit;
        if (r.confirmedTornado !== next) { r.confirmedTornado = next; updated++; }
    }
    try {
        fs.writeFileSync(path.join(DIR, `tornado-${dayIso}.jsonl`),
            rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } catch (e) {
        log.warn('history.labelWriteFailed', { day: dayIso, err: e.message });
        return { updated: 0, error: e.message };
    }
    log.info('history.labelled', { day: dayIso, updated, reports: (reports || []).length });
    return { updated, rows: rows.length };
}

module.exports = { init, append, buildRecord, readDay, availableDays, prune, labelReports };
