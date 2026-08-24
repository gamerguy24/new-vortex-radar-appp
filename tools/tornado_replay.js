#!/usr/bin/env node
/*
 * tools/tornado_replay.js
 * Run the Tornado Potential pipeline over real radar volumes, in sequence, and
 * print how each storm's score evolved.
 *
 * This is both the real-data test for the detector and the historical replay
 * driver: because it feeds volumes through the same rotation → tracking →
 * scoring path the live engine uses, what you see here is exactly what the
 * engine would have produced at the time.
 *
 * Usage:
 *   node tools/tornado_replay.js --site KTLX
 *   node tools/tornado_replay.js --site KFFC --day 2026-08-24 --limit 12
 *   node tools/tornado_replay.js --site KTLX --from 20:00 --to 21:00
 *   node tools/tornado_replay.js --files vol1.ar2v,vol2.ar2v --site KTLX
 *
 * Options:
 *   --site   NEXRAD id (required unless --files carries a parseable name)
 *   --day    UTC date YYYY-MM-DD (default: newest available)
 *   --from   UTC HH:MM lower bound
 *   --to     UTC HH:MM upper bound
 *   --limit  max volumes to process (default 8)
 *   --json   emit the per-scan records as JSON instead of a table
 *
 * Data source: Unidata THREDDS, which carries recent days. Older archives need
 * AWS credentials or NCEI; download those volumes yourself and pass --files.
 */

const fs = require('fs');
const path = require('path');

const l2 = require('../nws_radar_l2');
const radarSource = require('../backend/tornado/radar_source');
const rotation = require('../backend/tornado/rotation');
const storms = require('../backend/tornado/storms');
const score = require('../backend/tornado/score');
const environment = require('../backend/tornado/environment');
const cfgMod = require('../backend/tornado/config');
const log = require('../backend/tornado/logger');

const THREDDS = 'https://thredds.ucar.edu/thredds';
const UA = process.env.NWS_USER_AGENT || 'VortexRadar Tornado Replay (davidwallis17@gmail.com)';

function arg(name, fallback) {
    const i = process.argv.indexOf('--' + name);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
}

async function fetchText(url, ms = 20000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
    } finally { clearTimeout(t); }
}

async function fetchBuffer(url, ms = 60000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return Buffer.from(await r.arrayBuffer());
    } finally { clearTimeout(t); }
}

/** Volume file list for a site, newest day first unless --day is given. */
async function listVolumes(site, day) {
    const cat = await fetchText(`${THREDDS}/catalog/nexrad/level2/${site}/catalog.xml`);
    let days = [...cat.matchAll(/catalogRef\s+xlink:href="([^"]+)"/g)]
        .map((m) => m[1].replace('/catalog.xml', ''));
    if (!days.length) throw new Error('no day catalogs for ' + site);
    days.sort();
    const wanted = day ? days.filter((d) => d.replace(/-/g, '') === String(day).replace(/-/g, '')) : [days[days.length - 1]];
    if (!wanted.length) throw new Error(`no data for ${site} on ${day}. Available: ${days.slice(-6).join(', ')}`);

    const out = [];
    for (const d of wanted) {
        const dcat = await fetchText(`${THREDDS}/catalog/nexrad/level2/${site}/${d}/catalog.xml`);
        for (const m of dcat.matchAll(/urlPath="(nexrad\/level2\/[^"]+)"/g)) {
            const name = m[1].split('/').pop();
            out.push({ name, url: `${THREDDS}/fileServer/${m[1]}` });
        }
    }
    // Filenames are KXXX_YYYYMMDD_HHMMSS — sorting them sorts by time.
    out.sort((a, b) => (a.name < b.name ? -1 : 1));
    return out;
}

function timeFromName(name) {
    const m = String(name).match(/(\d{8})_(\d{2})(\d{2})(\d{2})/);
    if (!m) return null;
    return `${m[2]}:${m[3]}`;
}

function inWindow(name, from, to) {
    const hhmm = timeFromName(name);
    if (!hhmm) return true;
    if (from && hhmm < from) return false;
    if (to && hhmm > to) return false;
    return true;
}

function buildScan(factory, site, volumeName) {
    const loc = radarSource.siteLocation(site);
    const vel = extract(factory, 'VEL');
    const ref = extract(factory, 'REF');
    let time = null;
    try { time = factory.get_date(); } catch { /* fall through */ }
    if (time && !(time instanceof Date)) time = new Date(time);
    if (!time || isNaN(time.getTime())) time = new Date();
    return { site, volume: volumeName, source: 'replay', radar: loc, time, vel, ref };
}

function extract(factory, product) {
    const e = radarSource.bestElevationFor(factory, product);
    if (e == null) return null;
    let elevationAngle = 0.5, nyquist = null;
    try { elevationAngle = factory.get_elevation_angle(e); } catch { /* default */ }
    try { const n = factory.get_nyquist_vel(e); if (Number.isFinite(n) && n > 0) nyquist = n; } catch { /* optional */ }
    const edges = factory.get_ranges(product, e);
    const centres = new Array(Math.max(0, edges.length - 1));
    for (let i = 0; i < centres.length; i++) centres[i] = (edges[i] + edges[i + 1]) / 2;
    return {
        product, elevation: e, elevationAngle, nyquist,
        azimuths: factory.get_azimuth_angles(e),
        ranges: centres,
        data: factory.get_data(product, e),
    };
}

async function main() {
    const cfg = cfgMod.load();
    cfg.logging.logDetections = false;
    log.setLevel(arg('verbose', false) ? 'debug' : 'warn');

    const site = String(arg('site', '') || '').toUpperCase();
    const day = arg('day', null);
    const from = arg('from', null);
    const to = arg('to', null);
    const limit = parseInt(arg('limit', 8), 10) || 8;
    const asJson = !!arg('json', false);
    const files = arg('files', null);

    if (!site) {
        console.error('--site is required, e.g. --site KTLX');
        process.exit(2);
    }
    if (!radarSource.siteLocation(site)) {
        console.error('Unknown radar site: ' + site);
        process.exit(2);
    }

    let volumes;
    if (files && typeof files === 'string') {
        volumes = files.split(',').map((f) => ({ name: path.basename(f.trim()), local: f.trim() }));
    } else {
        process.stderr.write(`Listing volumes for ${site}${day ? ' on ' + day : ' (newest day)'}…\n`);
        volumes = (await listVolumes(site, day)).filter((v) => inWindow(v.name, from, to));
        // Take the LAST `limit` volumes in the window — the most recent weather.
        if (volumes.length > limit) volumes = volumes.slice(-limit);
    }
    if (!volumes.length) { console.error('No volumes matched.'); process.exit(1); }

    process.stderr.write(`Processing ${volumes.length} volume(s)…\n\n`);
    storms.clearAll();
    const rows = [];

    for (const v of volumes) {
        let buf;
        try {
            buf = v.local ? fs.readFileSync(v.local) : await fetchBuffer(v.url);
        } catch (e) {
            process.stderr.write(`  ${v.name}: download failed (${e.message})\n`);
            continue;
        }
        let factory;
        try {
            factory = l2.decodeVolume(buf, v.name);
        } catch (e) {
            process.stderr.write(`  ${v.name}: decode failed (${e.message})\n`);
            continue;
        }
        if (!factory) { process.stderr.write(`  ${v.name}: decode produced nothing\n`); continue; }

        const scan = buildScan(factory, site, v.name);
        if (!scan.vel) { process.stderr.write(`  ${v.name}: no velocity sweep (clear-air cut?)\n`); continue; }

        const t0 = Date.now();
        const dets = rotation.detectCirculations(scan, cfg);
        const cells = storms.findCells(scan, cfg);
        let tracked = storms.trackCells(cells, scan, cfg);
        tracked = storms.attachCirculations(dets, tracked, scan, cfg);

        const scanRows = [];
        for (const st of tracked) {
            const rot = storms.analyzeRotation(st, cfg);
            const rec = score.computeScore(st, rot, st.environment, cfg);
            st.score = rec;
            st.rotationAnalysis = rot;
            st.scoreHistory.push({ t: scan.time.getTime(), score: rec.score, category: rec.category });
            if (rec.score > 0 || st.circulation) {
                scanRows.push({
                    time: scan.time.toISOString().slice(11, 19),
                    volume: v.name,
                    stormId: st.id,
                    lat: Number(st.lat.toFixed(3)),
                    lon: Number(st.lon.toFixed(3)),
                    score: rec.score,
                    category: rec.category,
                    confidence: rec.confidence,
                    rotation: rot.strength,
                    trend: rot.trend,
                    persistMin: Math.round(rot.persistenceMinutes),
                    deltaV: st.circulation ? Number(st.circulation.deltaV.toFixed(1)) : 0,
                    shear: st.circulation ? Number(st.circulation.shear.toFixed(5)) : 0,
                    dbz: st.maxDbz != null ? Number(st.maxDbz.toFixed(0)) : null,
                    motion: st.motion ? `${Math.round(st.motion.direction)}° ${Math.round(st.motion.speedKmh * 0.621371)}mph` : '—',
                });
            }
        }
        rows.push(...scanRows);

        if (!asJson) {
            const top = scanRows.slice().sort((a, b) => b.score - a.score)[0];
            process.stderr.write(
                `  ${scan.time.toISOString().slice(11, 16)}Z  ${v.name.padEnd(30)} `
                + `cells=${String(cells.length).padStart(3)} circ=${String(dets.length).padStart(2)} `
                + `storms=${String(tracked.length).padStart(3)} `
                + `top=${top ? top.score + ' ' + top.category : '—'} `
                + `(${Date.now() - t0}ms)\n`);
        }
    }

    if (asJson) {
        console.log(JSON.stringify({ site, volumes: volumes.length, observations: rows }, null, 2));
        return;
    }

    const scored = rows.filter((r) => r.score > 0);
    console.log('\n' + '='.repeat(112));
    console.log(`REPLAY — ${site}   (experimental radar-derived analysis; not an official warning product)`);
    console.log('='.repeat(112));
    if (!scored.length) {
        console.log('\nNo scored circulations in this window. That is the expected result for a quiet or');
        console.log('clear-air period — the detector requires a velocity couplet co-located with a storm.\n');
        return;
    }
    console.log('TIME      STORM     SCORE CATEGORY  CONF    ROTATION  TREND       PERSIST  ΔV(m/s)  SHEAR     dBZ  MOTION');
    console.log('-'.repeat(112));
    for (const r of scored.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : b.score - a.score))) {
        console.log(
            `${r.time}  ${r.stormId.padEnd(9)} ${String(r.score).padStart(4)}  ${r.category.padEnd(9)} `
            + `${r.confidence.padEnd(6)}  ${r.rotation.padEnd(8)}  ${(r.trend || '').padEnd(10)}  `
            + `${String(r.persistMin).padStart(5)}m  ${String(r.deltaV).padStart(6)}  ${String(r.shear).padStart(7)}  `
            + `${String(r.dbz == null ? '—' : r.dbz).padStart(3)}  ${r.motion}`);
    }

    const byStorm = new Map();
    for (const r of scored) {
        if (!byStorm.has(r.stormId)) byStorm.set(r.stormId, []);
        byStorm.get(r.stormId).push(r);
    }
    console.log('\nPER-STORM SCORE EVOLUTION');
    console.log('-'.repeat(112));
    for (const [id, list] of byStorm) {
        const peak = Math.max(...list.map((x) => x.score));
        console.log(`${id.padEnd(9)} scans=${String(list.length).padStart(2)}  peak=${String(peak).padStart(3)}  `
            + `path: ${list.map((x) => x.score).join(' → ')}`);
    }
    console.log('\nDisclaimer: Vortex Radar Tornado Potential is an experimental radar-derived analysis');
    console.log('tool. It is not an official warning system and does not replace alerts or warnings');
    console.log('issued by the National Weather Service.\n');
}

main().catch((e) => { console.error('replay failed:', e.message); process.exit(1); });
