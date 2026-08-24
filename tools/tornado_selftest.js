#!/usr/bin/env node
/*
 * tools/tornado_selftest.js
 * Ground-truth tests for the rotation detector.
 *
 * Real radar data has no labels — you cannot tell from a volume alone whether a
 * detection was correct. So the detector is tested against synthetic sweeps
 * containing a Rankine vortex placed at a known azimuth, range and strength.
 * We know exactly what the answer should be, so we can check that the reported
 * position, ΔV and azimuthal shear are right, and that each QC filter rejects
 * what it is supposed to reject.
 *
 * Run:  node tools/tornado_selftest.js
 * Exit code 0 = all passed, 1 = something regressed.
 */

const rotation = require('../backend/tornado/rotation');
const storms = require('../backend/tornado/storms');
const score = require('../backend/tornado/score');
const geo = require('../backend/tornado/geo');
const cfgMod = require('../backend/tornado/config');

const cfg = cfgMod.load();
cfg.logging.logDetections = false;

const RADAR = { lat: 35.3331, lon: -97.2778, elevM: 370 };  // KTLX
const N_RADIALS = 720;      // 0.5° spacing
const N_GATES = 900;        // 0.25 km gates
const GATE0 = 2.125;
const GATE_SPACING = 0.25;

let passed = 0, failed = 0;
function check(name, ok, detail) {
    if (ok) { passed++; console.log('  PASS  ' + name); }
    else { failed++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}

function emptySweep(product) {
    const azimuths = new Array(N_RADIALS);
    for (let i = 0; i < N_RADIALS; i++) azimuths[i] = (i * 0.5) % 360;
    const ranges = new Array(N_GATES);
    for (let j = 0; j < N_GATES; j++) ranges[j] = GATE0 + j * GATE_SPACING;
    const data = new Array(N_RADIALS);
    for (let i = 0; i < N_RADIALS; i++) data[i] = new Array(N_GATES).fill(null);
    return { product, elevation: 1, elevationAngle: 0.5, nyquist: 32, azimuths, ranges, data };
}

/**
 * Paint a storm: reflectivity blob plus a Rankine vortex in velocity.
 * Doppler velocity of a cyclonic (CCW) vortex is proportional to the
 * CROSS-RANGE offset — outbound at higher azimuth. That is the signature the
 * detector is built to find.
 */
function paintStorm(vel, ref, opts) {
    const { azC, rC, vmax, coreKm, dbz, halfWidthKm } = opts;
    const hw = halfWidthKm || 12;
    for (let i = 0; i < N_RADIALS; i++) {
        const az = vel.azimuths[i];
        const dAz = geo.angleDiff(az, azC);
        for (let j = 0; j < N_GATES; j++) {
            const r = vel.ranges[j];
            const y = r - rC;                                   // along-beam offset, km
            const x = (dAz * Math.PI / 180) * rC;               // cross-range offset, km
            if (Math.abs(x) > hw || Math.abs(y) > hw) continue;
            const dist = Math.hypot(x, y);
            if (dist > hw) continue;

            if (ref) ref.data[i][j] = Math.max(ref.data[i][j] ?? -30, dbz * Math.max(0.35, 1 - dist / (hw * 1.4)));

            if (opts.noVelocity) continue;
            // Rankine combined vortex, projected onto the beam.
            let v;
            if (dist <= coreKm) v = vmax * (x / coreKm);
            else v = vmax * coreKm * x / (dist * dist);
            vel.data[i][j] = v;
        }
    }
}

function makeScan(build) {
    const vel = emptySweep('VEL');
    const ref = emptySweep('REF');
    build(vel, ref);
    return {
        site: 'KTLX', volume: 'SYNTHETIC', source: 'test',
        radar: RADAR, time: new Date(), vel, ref,
    };
}

console.log('\nVortex Radar — Tornado Potential self-test\n' + '='.repeat(46));

/* ── 1. a clean, strong couplet must be found, in the right place ───────────── */
console.log('\n[1] Strong cyclonic couplet at 90.0°, 60 km (Vmax 25 m/s, 1 km core)');
{
    const scan = makeScan((vel, ref) => paintStorm(vel, ref, { azC: 90, rC: 60, vmax: 25, coreKm: 1.0, dbz: 55 }));
    const dets = rotation.detectCirculations(scan, cfg);
    check('detects a circulation', dets.length > 0, `got ${dets.length}`);
    if (dets.length) {
        const d = dets[0];
        const truth = geo.polarToLatLon(RADAR.lat, RADAR.lon, 90, 60, 0.5);
        const errKm = geo.distanceKm(d.lat, d.lon, truth.lat, truth.lon);
        check('position within 3 km of truth', errKm < 3, errKm.toFixed(2) + ' km');
        check('ΔV in a physical range (30-60 m/s)', d.deltaV >= 30 && d.deltaV <= 60, d.deltaV.toFixed(1) + ' m/s');
        check('identified as cyclonic', d.cyclonic === true);
        check('azimuthal shear > 0.005 s⁻¹', d.shear > 0.005, d.shear.toFixed(5));
        check('confidence is not LOW', d.confidence.label !== 'LOW', d.confidence.label + ' ' + d.confidence.value.toFixed(2));
        check('collapses to few detections (NMS works)', dets.length <= 4, `${dets.length} detections`);
        console.log(`        reported: ΔV=${d.deltaV.toFixed(1)} m/s  Vrot=${d.vrot.toFixed(1)}  shear=${d.shear.toFixed(5)} s⁻¹  dia=${d.diameterKm.toFixed(2)} km  beam=${d.beamHeightKm.toFixed(2)} km`);
    }
}

/* ── 2. QC: rotation with no storm over it must be rejected ─────────────────── */
console.log('\n[2] Same couplet, but no reflectivity (clutter / clear-air case)');
{
    const scan = makeScan((vel) => paintStorm(vel, null, { azC: 90, rC: 60, vmax: 25, coreKm: 1.0, dbz: 0 }));
    const dets = rotation.detectCirculations(scan, cfg);
    check('rejected — no co-located storm', dets.length === 0, `got ${dets.length}`);
}

/* ── 3. QC: an isolated velocity spike must be rejected ─────────────────────── */
console.log('\n[3] Single-gate velocity spike inside a storm (noise case)');
{
    const scan = makeScan((vel, ref) => {
        paintStorm(vel, ref, { azC: 90, rC: 60, vmax: 0.0001, coreKm: 1, dbz: 55 });
        // one lone gate pair with a huge difference
        vel.data[180][231] = -30;
        vel.data[181][231] = 30;
    });
    const dets = rotation.detectCirculations(scan, cfg);
    check('rejected — no supporting gates', dets.length === 0, `got ${dets.length}`);
}

/* ── 4. QC: a ±Nyquist pair is aliasing, not rotation ───────────────────────── */
console.log('\n[4] Velocity folding at ±Nyquist (aliasing artifact)');
{
    const scan = makeScan((vel, ref) => {
        paintStorm(vel, ref, { azC: 90, rC: 60, vmax: 0.0001, coreKm: 1, dbz: 55 });
        // A broad patch pinned at both Nyquist limits — the classic fold.
        for (let i = 178; i <= 182; i++) {
            for (let j = 228; j <= 234; j++) {
                vel.data[i][j] = (i <= 180) ? -31.5 : 31.5;
            }
        }
    });
    const dets = rotation.detectCirculations(scan, cfg);
    check('rejected — recognised as folded', dets.length === 0, `got ${dets.length}`);
}

/* ── 5. weak, broad shear should not look like a mesocyclone ────────────────── */
console.log('\n[5] Weak broad shear (Vmax 6 m/s, 6 km core)');
{
    const scan = makeScan((vel, ref) => paintStorm(vel, ref, { azC: 90, rC: 60, vmax: 6, coreKm: 6, dbz: 50 }));
    const dets = rotation.detectCirculations(scan, cfg);
    check('rejected or weak only', dets.length === 0 || dets[0].vrot < cfg.detection.minRotationalVelocityMs + 4,
        dets.length ? `vrot=${dets[0].vrot.toFixed(1)}` : 'none');
}

/* ── 6. range dependence: same vortex far away is harder to see ─────────────── */
console.log('\n[6] Identical vortex at 200 km (beam is high and broad)');
{
    const near = makeScan((vel, ref) => paintStorm(vel, ref, { azC: 90, rC: 40, vmax: 25, coreKm: 1.0, dbz: 55 }));
    const far = makeScan((vel, ref) => paintStorm(vel, ref, { azC: 90, rC: 200, vmax: 25, coreKm: 1.0, dbz: 55, halfWidthKm: 16 }));
    const dn = rotation.detectCirculations(near, cfg);
    const df = rotation.detectCirculations(far, cfg);
    check('near vortex detected', dn.length > 0);
    if (dn.length && df.length) {
        check('far detection has lower confidence', df[0].confidence.value < dn[0].confidence.value,
            `${df[0].confidence.value.toFixed(2)} vs ${dn[0].confidence.value.toFixed(2)}`);
        check('far detection beam height > 3 km', df[0].beamHeightKm > 3, df[0].beamHeightKm.toFixed(2) + ' km');
    } else {
        check('far vortex handled without crashing', true);
    }
}

/* ── 7. multi-scan: strengthening rotation must raise the score ─────────────── */
console.log('\n[7] Five scans: weak → moderate → strong → strong+tightening');
{
    storms.clearAll();
    const sequence = [
        { vmax: 11, coreKm: 3.0 },
        { vmax: 15, coreKm: 2.5 },
        { vmax: 20, coreKm: 2.0 },
        { vmax: 24, coreKm: 1.2 },
        { vmax: 26, coreKm: 1.0 },
    ];
    const scores = [];
    let lastStorm = null;
    for (let k = 0; k < sequence.length; k++) {
        const scan = makeScan((vel, ref) => paintStorm(vel, ref, { azC: 90, rC: 60, vmax: sequence[k].vmax, coreKm: sequence[k].coreKm, dbz: 58 }));
        scan.time = new Date(Date.now() - (sequence.length - 1 - k) * 5 * 60000); // 5 min apart
        const dets = rotation.detectCirculations(scan, cfg);
        const cells = storms.findCells(scan, cfg);
        let tracked = storms.trackCells(cells, scan, cfg);
        tracked = storms.attachCirculations(dets, tracked, scan, cfg);
        const target = tracked.find((s) => s.circulation) || tracked[0];
        if (!target) continue;
        const rot = storms.analyzeRotation(target, cfg);
        const rec = score.computeScore(target, rot, null, cfg);
        target.score = rec;
        target.scoreHistory.push({ t: scan.time.getTime(), score: rec.score, category: rec.category });
        scores.push({ score: rec.score, cat: rec.category, trend: rot.trend, persist: Math.round(rot.persistenceMinutes), id: target.id });
        lastStorm = target;
    }
    scores.forEach((s, i) => console.log(`        scan ${i + 1}: score=${String(s.score).padStart(3)} ${s.cat.padEnd(9)} trend=${(s.trend || '').padEnd(10)} persistence=${s.persist}min ${s.id}`));
    check('produced a score for every scan', scores.length === sequence.length, `${scores.length}/${sequence.length}`);
    if (scores.length === sequence.length) {
        check('score rises as rotation strengthens', scores[4].score > scores[0].score, `${scores[0].score} → ${scores[4].score}`);
        check('storm ID stayed consistent', new Set(scores.map((s) => s.id)).size === 1, [...new Set(scores.map((s) => s.id))].join(','));
        check('persistence accumulated', scores[4].persist >= 15, scores[4].persist + ' min');
        check('score is within 0-100', scores.every((s) => s.score >= 0 && s.score <= 100));
    }

    /* ── 8. decay: rotation disappears → score must drop ── */
    console.log('\n[8] Rotation collapses on the next scan');
    if (lastStorm) {
        const before = lastStorm.score.score;
        const scan = makeScan((vel, ref) => paintStorm(vel, ref, { azC: 90, rC: 60, vmax: 0.0001, coreKm: 1, dbz: 50 }));
        scan.time = new Date(Date.now() + 5 * 60000);
        const dets = rotation.detectCirculations(scan, cfg);
        const cells = storms.findCells(scan, cfg);
        let tracked = storms.trackCells(cells, scan, cfg);
        tracked = storms.attachCirculations(dets, tracked, scan, cfg);
        const same = storms.getStorm(lastStorm.id);
        if (same) {
            const rot = storms.analyzeRotation(same, cfg);
            const rec = score.computeScore(same, rot, null, cfg);
            console.log(`        score ${before} → ${rec.score} (trend=${rot.trend})`);
            check('score dropped when rotation ended', rec.score < before, `${before} → ${rec.score}`);
        } else {
            check('storm survived to the decay scan', false, 'track was lost');
        }
    }
}

/* ── 9. missing data must never throw ───────────────────────────────────────── */
console.log('\n[9] Degenerate inputs (missing velocity, missing reflectivity, empty sweep)');
{
    let threw = null;
    try {
        rotation.detectCirculations({ site: 'X', radar: RADAR, time: new Date(), vel: null, ref: null }, cfg);
        rotation.detectCirculations(makeScan(() => {}), cfg);
        const noRef = makeScan((vel) => paintStorm(vel, null, { azC: 45, rC: 50, vmax: 25, coreKm: 1, dbz: 0 }));
        noRef.ref = null;
        rotation.detectCirculations(noRef, cfg);
        storms.findCells({ site: 'X', radar: RADAR, time: new Date(), ref: null }, cfg);
        score.computeScore({ id: 'ST-0', maxDbz: null, areaKm2: 0, circulation: null, rotationHistory: [], scoreHistory: [] },
            { trend: 'NONE', persistenceMinutes: 0, tightening: null, shearChange: 0, previousVrot: 0, currentVrot: 0, strength: 'NONE' }, null, cfg);
    } catch (e) { threw = e; }
    check('no exception on missing/empty data', !threw, threw ? threw.message : '');
}

/* ── 10. scoring sanity ─────────────────────────────────────────────────────── */
console.log('\n[10] Score boundaries and category mapping');
{
    check('0 → VERY LOW', score.categoryFor(0) === 'VERY LOW');
    check('19 → VERY LOW', score.categoryFor(19) === 'VERY LOW');
    check('20 → LOW', score.categoryFor(20) === 'LOW');
    check('40 → ELEVATED', score.categoryFor(40) === 'ELEVATED');
    check('60 → HIGH', score.categoryFor(60) === 'HIGH');
    check('80 → EXTREME', score.categoryFor(80) === 'EXTREME');
    check('100 → EXTREME', score.categoryFor(100) === 'EXTREME');
    const w = cfg.weights;
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    check('configured weights sum to 1', Math.abs(sum - 1) < 0.001, sum.toFixed(4));
}

console.log('\n' + '='.repeat(46));
console.log(`${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
