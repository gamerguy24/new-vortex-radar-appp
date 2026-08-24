/*
 * backend/tornado/radar_source.js
 * Radar ingest for the Tornado Potential engine.
 *
 * This deliberately does NOT reimplement any NEXRAD decoding. Vortex Radar
 * already decodes Level 2 in Node (nws_radar_l2.js, which reuses the browser
 * app's own libnexrad parser against the free THREDDS/AWS Open Data mirrors);
 * this module drives that machinery per radar site and hands the engine a
 * plain, product-agnostic sweep object.
 *
 * Two things it adds on top:
 *   1. Scan de-duplication — a volume filename is processed exactly once, so a
 *      60 s poll against a 4-6 minute volume cadence costs one cheap directory
 *      listing and nothing else. This is the single most important performance
 *      property of the whole system.
 *   2. Per-site isolation — a site that fails to list, download or decode is
 *      recorded and skipped. It can never take down other sites or the app.
 *
 * Both REF and VEL come out of ONE decode of ONE volume. Split-cut VCPs put
 * them in different sweeps at the same elevation, which is handled here.
 */

const l2 = require('../../nws_radar_l2');
const { NEXRAD_LOCATIONS } = require('../../app/radar/libnexrad/nexrad_locations');
const log = require('./logger');

const USER_AGENT = process.env.NWS_USER_AGENT
    || 'VortexRadar Tornado Potential (davidwallis17@gmail.com)';

// site -> { lastVolume, lastOkAt, lastError, failures }
const siteState = new Map();

function stateFor(site) {
    if (!siteState.has(site)) siteState.set(site, { lastVolume: null, lastOkAt: 0, lastError: null, failures: 0 });
    return siteState.get(site);
}

/** Known lat/lon/elevation for a NEXRAD site id, or null. */
function siteLocation(site) {
    const v = NEXRAD_LOCATIONS[String(site || '').toUpperCase()];
    if (!v || typeof v.lat !== 'number' || typeof v.lon !== 'number') return null;
    return { lat: v.lat, lon: v.lon, elevM: v.elev || 0 };
}

function allSites() { return Object.keys(NEXRAD_LOCATIONS); }

async function fetchBuffer(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return Buffer.from(await res.arrayBuffer());
    } finally { clearTimeout(t); }
}

// Lowest-elevation sweep that actually carries this product. Split-cut VCPs
// scan reflectivity and velocity separately at the same nominal tilt, so
// "sweep 1" is not reliably the one holding VEL.
function bestElevationFor(factory, product) {
    let best = null, bestAng = Infinity;
    for (let e = 1; e <= factory.nscans; e++) {
        const sweep = factory.grouped_sweeps[e];
        if (!sweep || !sweep[0] || !sweep[0][product] || !sweep[0][product].ngates) continue;
        let ang;
        try { ang = factory.get_elevation_angle(e); } catch { continue; }
        if (ang < bestAng) { bestAng = ang; best = e; }
    }
    return best;
}

// get_ranges() returns ngates+1 edge values in km; convert to gate centres so a
// gate index maps to one distance.
function gateCentres(edges) {
    const out = new Array(Math.max(0, edges.length - 1));
    for (let i = 0; i < out.length; i++) out[i] = (edges[i] + edges[i + 1]) / 2;
    return out;
}

function extractSweep(factory, product) {
    const elevation = bestElevationFor(factory, product);
    if (elevation == null) return null;
    const data = factory.get_data(product, elevation);
    if (!data || !data.length) return null;

    let elevationAngle = 0.5, nyquist = null;
    try { elevationAngle = factory.get_elevation_angle(elevation); } catch { /* default */ }
    try { const n = factory.get_nyquist_vel(elevation); if (Number.isFinite(n) && n > 0) nyquist = n; } catch { /* optional */ }

    return {
        product,
        elevation,
        elevationAngle,
        nyquist,                                   // m/s, for aliasing rejection
        azimuths: factory.get_azimuth_angles(elevation), // degrees, per radial
        ranges: gateCentres(factory.get_ranges(product, elevation)), // km, per gate
        data,                                      // data[radial][gate], m/s (VEL) or dBZ (REF), null = no echo
    };
}

/**
 * Fetch + decode this site's newest volume, if it is one we have not already
 * processed.
 *
 * @returns {Promise<null | {
 *   site, volume, source, radar: {lat,lon,elevM}, time: Date|null,
 *   vel: sweep|null, ref: sweep|null
 * }>}  null means "nothing new" or "this site failed" — never an exception.
 */
async function fetchLatestScan(site, cfg) {
    const st = stateFor(site);
    const loc = siteLocation(site);
    if (!loc) { st.lastError = 'unknown site'; return null; }

    let found = null;
    try {
        found = await l2.latestVolume(site);
    } catch (e) {
        st.failures++; st.lastError = 'list: ' + e.message;
        log.warn('scan.listFailed', { site, err: e.message, failures: st.failures });
        return null;
    }
    if (!found) {
        st.failures++; st.lastError = 'no volume listed';
        log.warn('scan.noVolume', { site });
        return null;
    }

    // Already analysed this volume — the cheap path, hit most polls.
    if (st.lastVolume === found.name) return null;

    let buf;
    try {
        buf = await fetchBuffer(found.url, cfg.scan.siteTimeoutMs);
    } catch (e) {
        st.failures++; st.lastError = 'download: ' + e.message;
        log.warn('scan.downloadFailed', { site, vol: found.name, err: e.message });
        return null;
    }

    let factory = null;
    try {
        factory = l2.decodeVolume(buf, found.name);
    } catch (e) {
        st.failures++; st.lastError = 'decode: ' + e.message;
        log.warn('scan.decodeFailed', { site, vol: found.name, err: e.message });
        return null;
    }
    if (!factory) {
        st.failures++; st.lastError = 'decode produced nothing';
        log.warn('scan.decodeEmpty', { site, vol: found.name });
        return null;
    }

    const vel = extractSweep(factory, 'VEL');
    const ref = extractSweep(factory, 'REF');
    let time = null;
    try { time = factory.get_date(); } catch { /* optional */ }
    if (time && !(time instanceof Date)) time = new Date(time);
    if (!time || isNaN(time.getTime())) time = new Date();

    // A volume with no velocity sweep (clear-air REF-only cuts happen) is not an
    // error — there is simply nothing to analyse. Mark it processed so we don't
    // re-download it every poll.
    st.lastVolume = found.name;
    st.lastOkAt = Date.now();
    st.lastError = null;
    st.failures = 0;

    const ageMin = (Date.now() - time.getTime()) / 60000;
    log.info('scan.received', {
        site, vol: found.name, src: found.source, bytes: buf.length,
        ageMin: Number(ageMin.toFixed(1)),
        velGates: vel ? vel.ranges.length : 0, refGates: ref ? ref.ranges.length : 0,
        tilt: vel ? Number(vel.elevationAngle.toFixed(2)) : null,
    });

    if (ageMin > cfg.scan.staleVolumeMinutes) {
        log.warn('scan.stale', { site, vol: found.name, ageMin: Number(ageMin.toFixed(1)) });
        return null;
    }
    if (!vel) { log.warn('scan.noVelocity', { site, vol: found.name }); return null; }

    return { site, volume: found.name, source: found.source, radar: loc, time, vel, ref };
}

/** Health snapshot for the status endpoint. */
function siteHealth() {
    const out = {};
    for (const [site, st] of siteState) {
        out[site] = {
            lastVolume: st.lastVolume,
            lastOkAt: st.lastOkAt ? new Date(st.lastOkAt).toISOString() : null,
            lastError: st.lastError,
            consecutiveFailures: st.failures,
        };
    }
    return out;
}

function resetSite(site) { siteState.delete(site); }

module.exports = { fetchLatestScan, siteLocation, allSites, siteHealth, resetSite, bestElevationFor };
