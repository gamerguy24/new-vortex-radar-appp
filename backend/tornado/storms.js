/*
 * backend/tornado/storms.js
 * Storm-cell identification, scan-to-scan tracking, and the multi-scan history
 * that turns isolated detections into a trend.
 *
 * Why tracking matters here: a single scan cannot tell you whether rotation is
 * organising or falling apart, and that difference is most of the signal. A
 * storm keeps its ID across volumes so the engine can say "this circulation has
 * persisted 14 minutes, is tightening, and its shear is increasing" instead of
 * "there is shear here" over and over.
 *
 * Cells are found by thresholding reflectivity onto a coarse geographic grid
 * and clustering the connected boxes. That is intentionally cheaper and blunter
 * than a full SCIT implementation — it runs in milliseconds, it is stable
 * enough to keep IDs attached, and every downstream consumer treats cell shape
 * as approximate.
 */

const geo = require('./geo');
const log = require('./logger');

let nextId = 1000;
const storms = new Map();      // id -> storm record

function newStormId() { return 'ST-' + (++nextId); }

/* ── cell identification ──────────────────────────────────────────────────── */

/**
 * Threshold the reflectivity sweep onto a ~gridKm grid and cluster it.
 * @returns {Array<{lat,lon,maxDbz,gates,areaKm2}>}
 */
function findCells(scan, cfg) {
    const ref = scan.ref;
    if (!ref || !ref.data || !ref.data.length) return [];
    const s = cfg.storms;
    const tilt = ref.elevationAngle || 0.5;
    const maxRange = cfg.detection.maxRangeKm;
    const minRange = cfg.detection.minRangeKm;

    const dLat = s.gridKm / 111.32;
    const boxes = new Map();  // "gx,gy" -> { sumLat, sumLon, w, maxDbz, n }

    // Stride the sweep: at 0.25 km gates a 2 km grid box holds ~8 gates, so
    // sampling every other gate loses nothing and halves the work.
    const gateStride = Math.max(1, Math.round((s.gridKm / 4) / Math.max(0.05, ref.ranges[1] - ref.ranges[0])));
    for (let i = 0; i < ref.data.length; i++) {
        const row = ref.data[i];
        if (!row) continue;
        const azDeg = ref.azimuths[i];
        for (let j = 0; j < row.length; j += gateStride) {
            const dbz = row[j];
            if (dbz == null || dbz < s.cellReflectivityDbz) continue;
            const rangeKm = ref.ranges[j];
            if (rangeKm == null || rangeKm < minRange || rangeKm > maxRange) continue;

            const p = geo.polarToLatLon(scan.radar.lat, scan.radar.lon, azDeg, rangeKm, tilt);
            const dLon = s.gridKm / (111.32 * Math.max(0.2, Math.cos(p.lat * Math.PI / 180)));
            const gx = Math.round(p.lon / dLon);
            const gy = Math.round(p.lat / dLat);
            const key = gx + ',' + gy;
            let b = boxes.get(key);
            if (!b) { b = { gx, gy, sumLat: 0, sumLon: 0, w: 0, maxDbz: -Infinity, n: 0 }; boxes.set(key, b); }
            // Weight the centroid by reflectivity above threshold so the cell
            // centre sits on the core, not the middle of the anvil.
            const w = dbz - s.cellReflectivityDbz + 1;
            b.sumLat += p.lat * w; b.sumLon += p.lon * w; b.w += w;
            if (dbz > b.maxDbz) b.maxDbz = dbz;
            b.n++;
        }
    }
    if (!boxes.size) return [];

    // Connected components over the grid (8-neighbour).
    const seen = new Set();
    const cells = [];
    for (const key of boxes.keys()) {
        if (seen.has(key)) continue;
        const queue = [key];
        seen.add(key);
        let sumLat = 0, sumLon = 0, w = 0, maxDbz = -Infinity, gates = 0, boxCount = 0;
        while (queue.length) {
            const k = queue.pop();
            const b = boxes.get(k);
            if (!b) continue;
            sumLat += b.sumLat; sumLon += b.sumLon; w += b.w;
            if (b.maxDbz > maxDbz) maxDbz = b.maxDbz;
            gates += b.n; boxCount++;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (!dx && !dy) continue;
                    const nk = (b.gx + dx) + ',' + (b.gy + dy);
                    if (boxes.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
                }
            }
        }
        if (gates < s.minCellGates || w <= 0) continue;
        cells.push({
            lat: sumLat / w,
            lon: sumLon / w,
            maxDbz,
            gates,
            areaKm2: boxCount * s.gridKm * s.gridKm,
        });
    }
    cells.sort((a, b) => b.maxDbz - a.maxDbz);
    return cells.slice(0, 120);
}

/* ── tracking ─────────────────────────────────────────────────────────────── */

/** Where a storm should be now, given where it was and how it was moving. */
function predictPosition(storm, atMs) {
    if (!storm.motion || !storm.motion.speedKmh || !storm.lastSeenMs) {
        return { lat: storm.lat, lon: storm.lon };
    }
    const hours = (atMs - storm.lastSeenMs) / 3600000;
    if (hours <= 0) return { lat: storm.lat, lon: storm.lon };
    return geo.destination(storm.lat, storm.lon, storm.motion.direction, storm.motion.speedKmh * hours);
}

/**
 * Match this scan's cells to existing storm tracks, create tracks for new
 * cells, and expire tracks that have not been seen for a while.
 */
function trackCells(cells, scan, cfg) {
    const s = cfg.storms;
    const nowMs = scan.time.getTime();
    const site = scan.site;

    const active = [...storms.values()].filter((st) => st.site === site);
    const usedTracks = new Set();
    const matched = [];

    // Greedy nearest-match, strongest cells first (they are the most reliable
    // anchors, and a weak cell stealing a track would break ID continuity).
    for (const cell of cells) {
        let best = null, bestD = Infinity;
        for (const st of active) {
            if (usedTracks.has(st.id)) continue;
            const p = predictPosition(st, nowMs);
            const dist = geo.distanceKm(cell.lat, cell.lon, p.lat, p.lon);
            if (dist < bestD) { bestD = dist; best = st; }
        }
        if (best && bestD <= s.maxTrackDistanceKm) {
            usedTracks.add(best.id);
            updateTrack(best, cell, nowMs, cfg);
            matched.push(best);
        } else {
            const st = createTrack(cell, scan, nowMs);
            matched.push(st);
        }
    }

    // Coast then expire unmatched tracks.
    for (const st of active) {
        if (usedTracks.has(st.id)) continue;
        const ageMin = (nowMs - st.lastSeenMs) / 60000;
        if (ageMin > s.maxCoastMinutes) {
            storms.delete(st.id);
            log.info('storm.expired', { storm: st.id, site, ageMin: Number(ageMin.toFixed(1)) });
        }
    }
    return matched;
}

function createTrack(cell, scan, nowMs) {
    const st = {
        id: newStormId(),
        site: scan.site,
        lat: cell.lat,
        lon: cell.lon,
        firstSeenMs: nowMs,
        lastSeenMs: nowMs,
        maxDbz: cell.maxDbz,
        areaKm2: cell.areaKm2,
        motion: null,
        positions: [{ t: nowMs, lat: cell.lat, lon: cell.lon }],
        rotationHistory: [],
        circulation: null,
        environment: null,
        score: null,
        scoreHistory: [],
        nwsWarning: null,
    };
    storms.set(st.id, st);
    log.info('storm.detected', { storm: st.id, site: scan.site, lat: cell.lat.toFixed(3), lon: cell.lon.toFixed(3), dbz: cell.maxDbz });
    return st;
}

function updateTrack(st, cell, nowMs, cfg) {
    const dtHours = (nowMs - st.lastSeenMs) / 3600000;
    if (dtHours > 0.0005) {                       // ~2 s guard against duplicate volumes
        const distKm = geo.distanceKm(st.lat, st.lon, cell.lat, cell.lon);
        const dir = geo.bearingDeg(st.lat, st.lon, cell.lat, cell.lon);
        const speedKmh = distKm / dtHours;
        // Smooth motion — single-scan displacement is noisy because the centroid
        // wobbles with the reflectivity field.
        if (!st.motion) {
            st.motion = { direction: dir, speedKmh };
        } else if (speedKmh < 160) {              // reject implausible jumps
            const a = 0.4;
            const prev = st.motion;
            // Average headings as vectors so 350°/10° averages to 0°, not 180°.
            const x = (1 - a) * Math.cos(prev.direction * Math.PI / 180) + a * Math.cos(dir * Math.PI / 180);
            const y = (1 - a) * Math.sin(prev.direction * Math.PI / 180) + a * Math.sin(dir * Math.PI / 180);
            st.motion = {
                direction: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360,
                speedKmh: (1 - a) * prev.speedKmh + a * speedKmh,
            };
        }
    }
    st.lat = cell.lat;
    st.lon = cell.lon;
    st.maxDbz = cell.maxDbz;
    st.areaKm2 = cell.areaKm2;
    st.lastSeenMs = nowMs;
    st.positions.push({ t: nowMs, lat: cell.lat, lon: cell.lon });
    if (st.positions.length > 40) st.positions.shift();
    log.debug('storm.trackUpdated', {
        storm: st.id, dbz: st.maxDbz,
        dir: st.motion ? Math.round(st.motion.direction) : null,
        kmh: st.motion ? Number(st.motion.speedKmh.toFixed(1)) : null,
    });
}

/* ── circulation attachment + multi-scan rotation analysis ────────────────── */

/**
 * Attach this scan's circulations to storms, and update each storm's rotation
 * history. A circulation with no reflectivity cell nearby gets its own track —
 * losing a real couplet because cell clustering missed the storm would be worse
 * than carrying an extra track.
 */
function attachCirculations(detections, tracked, scan, cfg) {
    const nowMs = scan.time.getTime();
    const s = cfg.storms;
    const touched = new Set();

    // Match against EVERY live track for this site, not just the ones a
    // reflectivity cell matched this scan. A circulation that never coincides
    // with a >40 dBZ cell still gets its own track, and on the next scan that
    // track is only in the storms map — not in `tracked`. Searching just
    // `tracked` made those invisible, so every scan minted a fresh ID and
    // nothing ever accumulated persistence. This is what keeps IDs stable.
    const candidates = () => {
        const seen = new Set(tracked.map((t) => t.id));
        const extra = [...storms.values()].filter((st) => st.site === scan.site && !seen.has(st.id));
        return tracked.concat(extra);
    };

    for (const det of detections) {
        let best = null, bestD = Infinity;
        for (const st of candidates()) {
            // Compare against where the storm should be now, not where it was.
            const p = predictPosition(st, nowMs);
            const dist = geo.distanceKm(det.lat, det.lon, p.lat, p.lon);
            if (dist < bestD) { bestD = dist; best = st; }
        }
        let storm;
        if (best && bestD <= s.circulationAttachKm) {
            storm = best;
            if (!tracked.includes(storm)) {
                // Revived a circulation-only track: move it to the detection and
                // keep its motion history going.
                updateTrack(storm, { lat: det.lat, lon: det.lon, maxDbz: det.dbz, areaKm2: storm.areaKm2 || 0 }, nowMs, cfg);
                tracked.push(storm);
            }
        } else {
            storm = createTrack({ lat: det.lat, lon: det.lon, maxDbz: det.dbz, areaKm2: 0 }, scan, nowMs);
            tracked.push(storm);
        }
        // Strongest circulation wins the storm this scan.
        if (!touched.has(storm.id) || (storm.circulation && det.deltaV > storm.circulation.deltaV)) {
            storm.circulation = det;
            touched.add(storm.id);
        }
    }

    // Record rotation state for every tracked storm — including "no rotation
    // this scan", which is how persistence correctly resets.
    for (const st of tracked) {
        const det = touched.has(st.id) ? st.circulation : null;
        if (!touched.has(st.id)) st.circulation = null;
        st.rotationHistory.push({
            t: nowMs,
            deltaV: det ? det.deltaV : 0,
            vrot: det ? det.vrot : 0,
            shear: det ? det.shear : 0,
            diameterKm: det ? det.diameterKm : null,
            confidence: det ? det.confidence.value : 0,
            beamHeightKm: det ? det.beamHeightKm : null,
        });
        if (st.rotationHistory.length > 40) st.rotationHistory.shift();
    }
    return tracked;
}

/**
 * Derive the trend quantities the score and the UI both need.
 * Returns { trend, persistenceMinutes, tightening, shearChange, previousVrot, currentVrot }
 */
function analyzeRotation(storm, cfg) {
    const h = storm.rotationHistory;
    const out = {
        trend: 'NONE',
        persistenceMinutes: 0,
        tightening: 0,
        shearChange: 0,
        previousVrot: 0,
        currentVrot: 0,
        strength: 'NONE',
    };
    if (!h.length) return out;

    const cur = h[h.length - 1];
    out.currentVrot = cur.vrot;

    // Persistence: unbroken run of scans with rotation, ending now.
    if (cur.vrot > 0) {
        let startT = cur.t;
        for (let i = h.length - 1; i >= 0; i--) {
            if (h[i].vrot <= 0) break;
            startT = h[i].t;
        }
        out.persistenceMinutes = Math.max(0, (cur.t - startT) / 60000);
    }

    // Compare against the mean of the previous up-to-3 scans rather than a
    // single one, so one noisy volume cannot flip the trend.
    const prev = h.slice(Math.max(0, h.length - 4), h.length - 1).filter((x) => x.vrot > 0);
    if (prev.length) {
        const meanVrot = prev.reduce((a, x) => a + x.vrot, 0) / prev.length;
        const meanShear = prev.reduce((a, x) => a + x.shear, 0) / prev.length;
        out.previousVrot = meanVrot;
        out.shearChange = cur.shear - meanShear;
        const rel = meanVrot > 0 ? (cur.vrot - meanVrot) / meanVrot : 0;
        out.trend = cur.vrot <= 0 ? 'ENDED'
            : rel > 0.12 ? 'INCREASING'
            : rel < -0.12 ? 'DECREASING'
            : 'STEADY';

        // Tightening: same-or-stronger rotation packed into a smaller diameter.
        const prevDia = prev.filter((x) => x.diameterKm).map((x) => x.diameterKm);
        if (prevDia.length && cur.diameterKm) {
            const meanDia = prevDia.reduce((a, x) => a + x, 0) / prevDia.length;
            if (meanDia > 0) out.tightening = (meanDia - cur.diameterKm) / meanDia; // + = tightening
        }
    } else if (cur.vrot > 0) {
        out.trend = 'NEW';
    }

    const v = cur.vrot;
    out.strength = v <= 0 ? 'NONE' : v < 12 ? 'WEAK' : v < 18 ? 'MODERATE' : v < 25 ? 'STRONG' : 'VIOLENT';
    return out;
}

/* ── projections ──────────────────────────────────────────────────────────── */

/**
 * Dead-reckoned positions at the configured lead times. This is Projected Storm
 * Motion — where the CELL is expected to be if it keeps moving as it has been.
 * It is explicitly not a tornado path.
 */
function projectPath(storm, cfg) {
    if (!storm.motion || !(storm.motion.speedKmh > 0)) return [];
    return cfg.storms.projectionMinutes.map((min) => {
        const p = geo.destination(storm.lat, storm.lon, storm.motion.direction, storm.motion.speedKmh * (min / 60));
        return { minutes: min, lat: p.lat, lon: p.lon };
    });
}

/* ── access ───────────────────────────────────────────────────────────────── */

function getStorm(id) { return storms.get(id) || null; }
function allStorms() { return [...storms.values()]; }
function stormsForSite(site) { return [...storms.values()].filter((s) => s.site === site); }
function clearAll() { storms.clear(); }

/** Restore tracks after a restart (see engine's state persistence). */
function hydrate(list) {
    if (!Array.isArray(list)) return;
    for (const st of list) {
        if (!st || !st.id) continue;
        storms.set(st.id, st);
        const n = parseInt(String(st.id).replace(/\D/g, ''), 10);
        if (Number.isFinite(n) && n > nextId) nextId = n;
    }
}

module.exports = {
    findCells, trackCells, attachCirculations, analyzeRotation, projectPath,
    getStorm, allStorms, stormsForSite, clearAll, hydrate, predictPosition,
};
