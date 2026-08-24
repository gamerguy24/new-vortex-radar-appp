/*
 * app/radar/tornado/live_rotation.js
 * Live rotation detection on the radar volume the user is ALREADY LOOKING AT.
 *
 * This is the primary path for Tornado Potential. It does not poll a server, it
 * does not wait for a storm to be tracked across scans, and it does not fetch
 * anything: when the app decodes a Level 2 volume for display it leaves the
 * factory on window.vortexData.nexrad_factory, and that factory already holds
 * the super-res base velocity. We read the lowest velocity sweep straight out
 * of it and run the same detector the server engine uses.
 *
 * The practical effect: switch to a storm, and if there is a velocity couplet
 * inside it you are told immediately — on the actual super-res data for the
 * site you are viewing, not for whichever radars a background service happened
 * to be watching.
 *
 * The detector itself is backend/tornado/rotation.js, bundled in unchanged.
 * One implementation, two callers — a fix to the algorithm fixes both.
 *
 * NOT A WARNING. Everything here is labelled experimental, and official NWS
 * warnings are never produced or implied by this module.
 */

const rotation = require('../../../backend/tornado/rotation');
const scoreMod = require('../../../backend/tornado/score');
const geo = require('../../../backend/tornado/geo');
const DEFAULTS = require('../../../backend/tornado/defaults');

const CHECK_MS = 2000;          // how often we look for a newly displayed volume
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

let enabled = false;
let timer = null;
let lastSignature = '';
let markers = [];
let lastResults = [];
let alertedAt = new Map();      // rounded location -> last alert time
let cfg = JSON.parse(JSON.stringify(DEFAULTS));

function map() { return window.vortexMap && window.vortexMap.map; }
function GL() { return window.mapboxgl || window.maplibregl; }

/* ── reading the displayed volume ─────────────────────────────────────────── */

// Lowest-elevation sweep that actually carries this product. Split-cut VCPs
// scan reflectivity and velocity separately, so sweep 1 is not reliably VEL.
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

/*
 * Does this sweep actually contain values?
 *
 * This matters more than it looks. When dealiasing has NOT been run,
 * get_data(product, elevation, true) still returns a full-length array of
 * radials — every one of them empty. Checking `data.length` therefore passes
 * on an array with zero usable gates, and the detector silently analyses
 * nothing and reports no rotation. Sample the grid instead of trusting the
 * shape. Sampled sparsely so this costs nothing on a 375,000-gate sweep.
 */
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

    // Prefer dealiased velocity when the user has run it: unfolded data removes
    // the single biggest source of spurious couplets. Fall back to raw — which
    // is the normal case, since dealiasing is opt-in.
    let data = null;
    let dealiased = false;
    if (product === 'VEL') {
        try {
            const d = factory.get_data(product, elevation, true);
            if (hasData(d, 200)) { data = d; dealiased = true; }
        } catch (err) { /* not dealiased — expected */ }
    }
    if (!data) {
        try { data = factory.get_data(product, elevation); } catch (err) { return null; }
    }
    if (!hasData(data, 50)) return null;

    let elevationAngle = 0.5, nyquist = null;
    try { elevationAngle = factory.get_elevation_angle(elevation); } catch (err) { /* default */ }
    try {
        const n = factory.get_nyquist_vel(elevation);
        if (isFinite(n) && n > 0) nyquist = n;
    } catch (err) { /* optional */ }

    return {
        product,
        elevation,
        elevationAngle,
        // Dealiased data is not bounded by the Nyquist velocity, so passing it
        // would make the folding check reject legitimate strong couplets.
        nyquist: dealiased ? null : nyquist,
        dealiased,
        azimuths: factory.get_azimuth_angles(elevation),
        ranges: gateCentres(factory.get_ranges(product, elevation)),
        data,
    };
}

/** Build the scan object the shared detector expects, from the live factory. */
function scanFromFactory(factory) {
    const vel = extractSweep(factory, 'VEL');
    if (!vel) return null;
    const ref = extractSweep(factory, 'REF');

    let loc = [0, 0, 0];
    try { loc = factory.get_location(); } catch (err) { /* fall through */ }
    if (!loc || !isFinite(loc[0]) || !isFinite(loc[1])) return null;

    let time = null;
    try { time = factory.get_date(); } catch (err) { /* optional */ }
    if (time && !(time instanceof Date)) time = new Date(time);
    if (!time || isNaN(time.getTime())) time = new Date();

    return {
        site: factory.station || 'RADAR',
        volume: factory.filename || 'displayed-volume',
        source: 'browser',
        radar: { lat: loc[0], lon: loc[1], elevM: loc[2] || 0 },
        time,
        vel,
        ref,
    };
}

/* ── analysis ─────────────────────────────────────────────────────────────── */

function analyse() {
    if (!enabled) return;
    const factory = window.vortexData && window.vortexData.nexrad_factory;
    if (!factory || typeof factory.get_data !== 'function') return;

    // Only re-run when the displayed volume actually changes.
    const sig = [
        window.vortexData.L2_file_id,
        factory.station,
        factory.filename,
    ].join('|');
    if (sig === lastSignature) return;

    const scan = scanFromFactory(factory);
    if (!scan) { lastSignature = sig; return; }
    lastSignature = sig;

    let detections = [];
    const t0 = Date.now();
    try {
        detections = rotation.detectCirculations(scan, cfg);
    } catch (e) {
        console.warn('[tornado-live] detection failed:', e && e.message);
        return;
    }

    // Score each detection on its own. There is no cross-scan history here, so
    // trend, persistence and tightening are genuinely unknown — they are
    // reported as such rather than guessed, and the scorer redistributes their
    // weight instead of inventing a value.
    const rot = {
        trend: 'NEW', persistenceMinutes: 0, tightening: null,
        shearChange: 0, previousVrot: 0, currentVrot: 0, strength: 'NONE',
    };
    const results = detections.map((d, i) => {
        const v = d.vrot;
        const storm = {
            id: scan.site + '-L' + (i + 1),
            maxDbz: d.dbz,
            areaKm2: 0,
            motion: null,
            circulation: d,
            rotationHistory: [],
            scoreHistory: [],
        };
        const r = { ...rot, currentVrot: v, strength: v <= 0 ? 'NONE' : v < 12 ? 'WEAK' : v < 18 ? 'MODERATE' : v < 25 ? 'STRONG' : 'VIOLENT' };
        const rec = scoreMod.computeScore(storm, r, null, cfg);
        return {
            id: storm.id,
            site: scan.site,
            lat: d.lat,
            lon: d.lon,
            deltaV: d.deltaV,
            vrot: d.vrot,
            shear: d.shear,
            diameterKm: d.diameterKm,
            radiusKm: d.radiusKm,
            cyclonic: d.cyclonic,
            dbz: d.dbz,
            rangeKm: d.rangeKm,
            beamHeightKm: d.beamHeightKm,
            confidence: d.confidence,
            aliasSuspect: d.aliasSuspect,
            score: rec.score,
            category: rec.category,
            scoreConfidence: rec.confidence,
            strength: r.strength,
            tiltDeg: scan.vel.elevationAngle,
            dealiased: scan.vel.dealiased,
            time: scan.time.toISOString(),
            volume: scan.volume,
        };
    }).sort((a, b) => b.score - a.score);

    lastResults = results;
    console.log(`[tornado-live] ${scan.site} ${scan.volume}: ${results.length} circulation(s) in ${Date.now() - t0}ms`
        + (scan.vel.dealiased ? ' (dealiased velocity)' : ''));

    render();
    notify(results);

    // Let the UI component pick this up without polling.
    try {
        window.dispatchEvent(new CustomEvent('vortexliverotation', {
            detail: { site: scan.site, time: scan.time.toISOString(), results },
        }));
    } catch (e) { /* CustomEvent unsupported */ }
}

/* ── map rendering ────────────────────────────────────────────────────────── */

const CATEGORY_TOKEN = {
    'VERY LOW': '--vx-text-3',
    LOW: '--vx-sev-minor',
    ELEVATED: '--vx-sev-moderate',
    HIGH: '--vx-sev-severe',
    EXTREME: '--vx-sev-extreme',
};

function clearMarkers() {
    for (const m of markers) { try { m.remove(); } catch (e) { /* gone */ } }
    markers = [];
}

function render() {
    const m = map(), g = GL();
    if (!m || !g) return;
    clearMarkers();
    if (!enabled) return;

    for (const r of lastResults) {
        const el = document.createElement('div');
        el.className = 'vtp-live-marker';
        el.style.color = `var(${CATEGORY_TOKEN[r.category] || '--vx-text-3'})`;
        el.innerHTML = '<div class="vtp-live-ring"><span>' + r.score + '</span></div>';
        el.title = `${r.site} — experimental radar-derived rotation\n`
            + `Potential ${r.score}/100 (${r.category}), confidence ${r.scoreConfidence}\n`
            + `ΔV ${r.deltaV.toFixed(1)} m/s · shear ${r.shear.toFixed(4)} /s · ${r.diameterKm.toFixed(1)} km wide\n`
            + `Beam ${r.beamHeightKm.toFixed(2)} km AGL at ${r.rangeKm.toFixed(0)} km`;
        el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (window.VortexTornado && window.VortexTornado.showLive) window.VortexTornado.showLive(r);
        });
        try {
            markers.push(new g.Marker({ element: el }).setLngLat([r.lon, r.lat]).addTo(m));
        } catch (e) { /* map not ready */ }
    }
}

/* ── alerting ─────────────────────────────────────────────────────────────── */

function notify(results) {
    if (!results.length) return;
    const m = map();
    const prefsRaw = (() => {
        try { return JSON.parse(localStorage.getItem('vortexTornadoPrefs')) || {}; } catch (e) { return {}; }
    })();
    const minScore = prefsRaw.minScore != null ? prefsRaw.minScore : 60;

    for (const r of results) {
        if (r.score < minScore) continue;

        // Only alert for what the user can actually see — this is meant to tell
        // you about the cell you are looking at, not every couplet in the state.
        if (m && typeof m.getBounds === 'function') {
            try {
                const b = m.getBounds();
                if (!b.contains([r.lon, r.lat])) continue;
            } catch (e) { /* bounds unavailable: alert anyway */ }
        }

        const key = r.lat.toFixed(2) + ',' + r.lon.toFixed(2);
        const last = alertedAt.get(key) || 0;
        if (Date.now() - last < ALERT_COOLDOWN_MS) continue;
        alertedAt.set(key, Date.now());

        if (window.VortexTornado && window.VortexTornado.liveAlert) {
            window.VortexTornado.liveAlert(r);
        }
    }
}

/* ── lifecycle ────────────────────────────────────────────────────────────── */

function setEnabled(on) {
    enabled = !!on;
    if (enabled) {
        lastSignature = '';                 // force a fresh analysis
        if (!timer) timer = setInterval(analyse, CHECK_MS);
        analyse();
    } else {
        if (timer) { clearInterval(timer); timer = null; }
        clearMarkers();
        lastResults = [];
    }
}

/** Re-run against the currently displayed volume right now. */
function refresh() { lastSignature = ''; analyse(); }

/** Merge server-side config (thresholds) so both paths agree. */
function configure(partial) {
    if (!partial) return;
    if (partial.detection) cfg.detection = Object.assign({}, cfg.detection, partial.detection);
    if (partial.weights) cfg.weights = Object.assign({}, cfg.weights, partial.weights);
    if (partial.modifiers) cfg.modifiers = Object.assign({}, cfg.modifiers, partial.modifiers);
    refresh();
}

const api = {
    setEnabled,
    refresh,
    configure,
    results: () => lastResults.slice(),
    isEnabled: () => enabled,
    config: () => cfg,
};

if (typeof window !== 'undefined') window.VortexLiveRotation = api;

module.exports = api;
