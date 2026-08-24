#!/usr/bin/env node
/*
 * tools/tornado_live_test.js
 * Exercise the BROWSER path: analyse a decoded volume exactly the way
 * app/radar/tornado/live_rotation.js does when a user is looking at a storm.
 *
 * It decodes a real volume, then pulls the lowest velocity sweep straight out
 * of the factory — the same object the browser leaves on
 * window.vortexData.nexrad_factory — and runs the shared detector on it. No
 * storm tracking, no server engine: one volume in, circulations out.
 *
 *   node tools/tornado_live_test.js --site KTLX
 *   node tools/tornado_live_test.js --site KFFC --day 2026-08-24
 */

const l2 = require('../nws_radar_l2');
const rotation = require('../backend/tornado/rotation');
const scoreMod = require('../backend/tornado/score');
const DEFAULTS = require('../backend/tornado/defaults');
const log = require('../backend/tornado/logger');

log.setLevel('warn');
const cfg = JSON.parse(JSON.stringify(DEFAULTS));

function arg(n, d) {
    const i = process.argv.indexOf('--' + n);
    return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true);
}

// ── the exact logic live_rotation.js uses, so this tests the real path ──
function bestElevationFor(factory, product) {
    let best = null, bestAng = Infinity;
    for (let e = 1; e <= factory.nscans; e++) {
        const sweep = factory.grouped_sweeps[e];
        if (!sweep || !sweep[0] || !sweep[0][product] || !sweep[0][product].ngates) continue;
        let ang;
        try { ang = factory.get_elevation_angle(e); } catch (err) { continue; }
        if (ang < bestAng) { bestAng = ang; best = e; }
    }
    return best;
}
function gateCentres(edges) {
    const out = new Array(Math.max(0, edges.length - 1));
    for (let i = 0; i < out.length; i++) out[i] = (edges[i] + edges[i + 1]) / 2;
    return out;
}
// Mirrors live_rotation.js: an un-run dealias returns full-length but EMPTY
// radials, so verify real values exist rather than trusting array length.
function hasData(data, minGates) {
    if (!data || !data.length) return false;
    let found = 0;
    for (let i = 0; i < data.length; i += 8) {
        const row = data[i];
        if (!row || !row.length) continue;
        for (let j = 0; j < row.length; j += 8) {
            if (row[j] != null) { found++; if (found >= minGates) return true; }
        }
    }
    return false;
}

function extractSweep(factory, product) {
    const elevation = bestElevationFor(factory, product);
    if (elevation == null) return null;
    let data = null, dealiased = false;
    if (product === 'VEL') {
        try { const d = factory.get_data(product, elevation, true); if (hasData(d, 200)) { data = d; dealiased = true; } }
        catch (err) { /* not dealiased */ }
    }
    if (!data) { try { data = factory.get_data(product, elevation); } catch (err) { return null; } }
    if (!hasData(data, 50)) return null;
    let elevationAngle = 0.5, nyquist = null;
    try { elevationAngle = factory.get_elevation_angle(elevation); } catch (err) { /* default */ }
    try { const n = factory.get_nyquist_vel(elevation); if (isFinite(n) && n > 0) nyquist = n; } catch (err) { /* optional */ }
    return {
        product, elevation, elevationAngle,
        nyquist: dealiased ? null : nyquist, dealiased,
        azimuths: factory.get_azimuth_angles(elevation),
        ranges: gateCentres(factory.get_ranges(product, elevation)),
        data,
    };
}

async function main() {
    const site = String(arg('site', 'KTLX')).toUpperCase();
    process.stderr.write(`Fetching the newest ${site} volume…\n`);

    const found = await l2.latestVolume(site);
    if (!found) { console.error('no volume available for ' + site); process.exit(1); }
    const res = await fetch(found.url, { headers: { 'User-Agent': 'VortexRadar live test' } });
    const buf = Buffer.from(await res.arrayBuffer());
    process.stderr.write(`Decoding ${found.name} (${(buf.length / 1048576).toFixed(1)} MB)…\n`);

    const factory = l2.decodeVolume(buf, found.name);
    if (!factory) { console.error('decode failed'); process.exit(1); }

    // From here on: exactly what the browser does with the displayed volume.
    const vel = extractSweep(factory, 'VEL');
    const ref = extractSweep(factory, 'REF');
    if (!vel) { console.error('no velocity sweep in this volume'); process.exit(1); }

    const loc = factory.get_location();
    let time = null;
    try { time = factory.get_date(); } catch (e) { /* optional */ }
    if (time && !(time instanceof Date)) time = new Date(time);
    if (!time || isNaN(time)) time = new Date();

    const scan = {
        site: factory.station || site, volume: found.name, source: 'browser',
        radar: { lat: loc[0], lon: loc[1], elevM: loc[2] || 0 }, time, vel, ref,
    };

    const gateSpacingKm = vel.ranges.length > 1 ? (vel.ranges[1] - vel.ranges[0]) : null;
    const azSpacing = vel.azimuths.length > 1 ? Math.abs(vel.azimuths[1] - vel.azimuths[0]) : null;

    console.log('\n' + '='.repeat(92));
    console.log(`LIVE ROTATION — ${scan.site}  (what the browser computes for the volume on screen)`);
    console.log('='.repeat(92));
    console.log(`volume        ${found.name}`);
    console.log(`scan time     ${time.toISOString()}`);
    console.log(`sweep         ${vel.elevationAngle.toFixed(2)}°  (elevation index ${vel.elevation})`);
    console.log(`resolution    ${vel.ranges.length} gates @ ${gateSpacingKm ? gateSpacingKm.toFixed(3) : '?'} km`
        + `, ${vel.azimuths.length} radials @ ${azSpacing ? azSpacing.toFixed(2) : '?'}°`
        + `${gateSpacingKm && gateSpacingKm <= 0.26 && azSpacing && azSpacing <= 0.6 ? '   ← SUPER-RES' : ''}`);
    console.log(`velocity      ${vel.dealiased ? 'dealiased' : 'raw'}${vel.nyquist ? `, Nyquist ±${vel.nyquist.toFixed(1)} m/s` : ''}`);
    console.log(`reflectivity  ${ref ? ref.ranges.length + ' gates @ ' + (ref.ranges[1] - ref.ranges[0]).toFixed(3) + ' km' : 'not in this volume'}`);

    const t0 = Date.now();
    const dets = rotation.detectCirculations(scan, cfg);
    const ms = Date.now() - t0;
    console.log(`\nanalysed in   ${ms} ms   →   ${dets.length} circulation(s)\n`);

    if (!dets.length) {
        console.log('No velocity couplet met the thresholds in this volume.');
        console.log('That is the expected result for a storm-free or non-rotating scene.\n');
        return;
    }

    const rot = { trend: 'NEW', persistenceMinutes: 0, tightening: null, shearChange: 0, previousVrot: 0, currentVrot: 0, strength: 'NONE' };
    console.log('SCORE CATEGORY  CONF    ΔV(m/s)  Vrot   SHEAR      DIA(km)  dBZ  RANGE  BEAM(km)  CYC  LOCATION');
    console.log('-'.repeat(92));
    for (const d of dets.slice(0, 15)) {
        const v = d.vrot;
        const r = { ...rot, currentVrot: v, strength: v < 12 ? 'WEAK' : v < 18 ? 'MODERATE' : v < 25 ? 'STRONG' : 'VIOLENT' };
        const rec = scoreMod.computeScore(
            { id: 'L', maxDbz: d.dbz, areaKm2: 0, motion: null, circulation: d, rotationHistory: [], scoreHistory: [] },
            r, null, cfg,
        );
        console.log(
            `${String(rec.score).padStart(4)}  ${rec.category.padEnd(9)} ${rec.confidence.padEnd(6)} `
            + `${d.deltaV.toFixed(1).padStart(7)}  ${d.vrot.toFixed(1).padStart(4)}  `
            + `${d.shear.toFixed(5).padStart(8)}  ${d.diameterKm.toFixed(1).padStart(6)}   `
            + `${String(Math.round(d.dbz)).padStart(3)}  ${d.rangeKm.toFixed(0).padStart(4)}km  `
            + `${d.beamHeightKm.toFixed(2).padStart(7)}  ${d.cyclonic ? ' Y ' : ' N '}  `
            + `${d.lat.toFixed(3)}, ${d.lon.toFixed(3)}`);
    }
    console.log('\nExperimental radar-derived analysis. Not an official warning product.\n');
}

main().catch((e) => { console.error('failed:', e.message); process.exit(1); });
