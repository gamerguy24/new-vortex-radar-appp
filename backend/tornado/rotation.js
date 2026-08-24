/*
 * backend/tornado/rotation.js
 * Velocity-couplet detection and azimuthal shear from a Level 2 velocity sweep.
 *
 * ── What it looks for ────────────────────────────────────────────────────────
 * A rotation signature on Doppler radar is adjacent inbound (toward the radar,
 * negative) and outbound (away, positive) velocities that are close together in
 * space. In the Northern Hemisphere a CYCLONIC circulation puts the inbound
 * side at the lower azimuth and the outbound side at the higher azimuth, so
 * velocity INCREASING with azimuth is cyclonic shear. (Derivation: for
 * counter-clockwise rotation, the flow east of the centre — the higher azimuth
 * when looking outward from the radar — moves away from the radar.)
 *
 * Reported quantities:
 *   deltaV      ΔV, the full inbound→outbound velocity difference (m/s)
 *   vrot        rotational velocity, ΔV/2 — the number NWS nomograms use
 *   shear       azimuthal shear, ΔV / separation distance (s⁻¹)
 *   diameterKm  distance between the velocity extremes
 *
 * ── What it throws away ──────────────────────────────────────────────────────
 * Most of this file is quality control, because raw shear maxima are dominated
 * by junk. A candidate is rejected unless it survives, in order:
 *   range gating       too close = ground clutter; too far = beam overshoots
 *   reflectivity       no storm co-located → not a storm-scale circulation
 *   spatial tightness  extremes further apart than a mesocyclone can be
 *   aliasing           a ±Nyquist pair is a folding artifact, not rotation
 *   isolation          a one-gate spike with no supporting neighbours is noise
 *   non-max suppression collapses the many candidates inside one real couplet
 *
 * Nothing here is a tornado detection. It identifies places where the velocity
 * field is rotating, and says how confident it is that the measurement is real.
 */

const geo = require('./geo');
const log = require('./logger');

const D2R = Math.PI / 180;

/* ── reflectivity lookup ──────────────────────────────────────────────────────
 * REF and VEL live on different grids (different gate spacing, sometimes a
 * different radial count, and in split-cut VCPs a different sweep entirely).
 * This builds a nearest-neighbour sampler from the REF sweep so a velocity
 * candidate can ask "how much reflectivity is here?".
 */
function makeReflectivitySampler(ref) {
    if (!ref || !ref.data || !ref.data.length) return () => null;

    // Bucket radials by whole degree for O(1) azimuth lookup.
    const buckets = new Array(360);
    for (let i = 0; i < ref.azimuths.length; i++) {
        const a = ((ref.azimuths[i] % 360) + 360) % 360;
        const b = Math.floor(a);
        if (!buckets[b]) buckets[b] = [];
        buckets[b].push(i);
    }
    const r0 = ref.ranges[0];
    const dr = ref.ranges.length > 1 ? (ref.ranges[1] - ref.ranges[0]) : 1;

    /** Max dBZ within `searchKm` of (azimuth, range). null when no data. */
    return function sampleRef(azDeg, rangeKm, searchKm) {
        const a = ((azDeg % 360) + 360) % 360;
        // Convert the search radius to an azimuth half-width at this range.
        const halfDeg = Math.min(20, Math.max(1, (searchKm / Math.max(1, rangeKm)) / D2R));
        const gHalf = Math.max(1, Math.round(searchKm / Math.abs(dr || 1)));
        const jCentre = Math.round((rangeKm - r0) / (dr || 1));

        let best = null;
        for (let dB = -Math.ceil(halfDeg); dB <= Math.ceil(halfDeg); dB++) {
            const bucket = buckets[(((Math.floor(a) + dB) % 360) + 360) % 360];
            if (!bucket) continue;
            for (const i of bucket) {
                const row = ref.data[i];
                if (!row) continue;
                for (let j = Math.max(0, jCentre - gHalf); j <= Math.min(row.length - 1, jCentre + gHalf); j++) {
                    const v = row[j];
                    if (v == null) continue;
                    if (best === null || v > best) best = v;
                }
            }
        }
        return best;
    };
}

/* ── main detector ────────────────────────────────────────────────────────── */

/**
 * @param {object} scan  from radar_source.fetchLatestScan()
 * @param {object} cfg   full tornado config
 * @returns {Array} detections, strongest first
 */
function detectCirculations(scan, cfg) {
    const d = cfg.detection;
    const vel = scan.vel;
    if (!vel || !vel.data || !vel.data.length) return [];

    const az = vel.azimuths;
    const ranges = vel.ranges;
    const data = vel.data;
    const nRad = data.length;
    const tilt = vel.elevationAngle || 0.5;
    const nyquist = vel.nyquist;
    const sampleRef = makeReflectivitySampler(scan.ref);

    // Gate index bounds for the configured analysis annulus.
    let jMin = 0, jMax = ranges.length - 1;
    while (jMin < ranges.length && ranges[jMin] < d.minRangeKm) jMin++;
    while (jMax > 0 && ranges[jMax] > d.maxRangeKm) jMax--;
    if (jMax <= jMin) return [];

    // Radial ordering: azimuths are in scan order and wrap through 360. Use the
    // next index as "next azimuth" and compute the true angular delta, so the
    // wrap point needs no special case.
    const nextIdx = (i) => (i + 1) % nRad;

    /* Pass 1 — cheap cross-radial scan at several azimuthal lags.
     * Find places worth a full window search. Without this prefilter the window
     * search would run ~40M times per volume; with it, a few thousand. This is
     * what makes the engine affordable to run 24/7.
     *
     * Multiple lags matter more than they look. A couplet's gradient is spread
     * across however many radials its core spans, so comparing only ADJACENT
     * radials silently misses broad circulations: at 60 km a 40 m/s ΔV
     * mesocyclone with a 2 km core puts just 5 m/s between neighbouring
     * radials — well under any sensible threshold — while a tight tornadic
     * couplet puts 10+ m/s there. Sampling a few lags catches both the tight
     * and the broad cases at negligible extra cost. */
    const seedThreshold = d.minDeltaVMs * 0.6;
    const lags = (Array.isArray(d.seedLags) && d.seedLags.length) ? d.seedLags : [1, 3, 6];
    const seedSet = new Set();
    for (const lag of lags) {
        const step = Math.max(1, Math.round(lag));
        for (let i = 0; i < nRad; i++) {
            const iB = (i + step) % nRad;
            const rowA = data[i];
            const rowB = data[iB];
            if (!rowA || !rowB) continue;
            const dAz = Math.abs(geo.angleDiff(az[iB], az[i]));
            if (dAz < 0.05 || dAz > 3 * step) continue;    // duplicate or gap radials
            for (let j = jMin; j <= jMax; j++) {
                const a = rowA[j], b = rowB[j];
                if (a == null || b == null) continue;
                if (Math.abs(b - a) < seedThreshold) continue;
                // Seed at the midpoint of the pair — that is where the
                // circulation centre is, and the window search is centred there.
                const iMid = (i + Math.floor(step / 2)) % nRad;
                seedSet.add(iMid * 100000 + j);
            }
        }
    }
    const seeds = [...seedSet];
    if (!seeds.length) return [];

    /* Pass 2 — window analysis at each seed.
     *
     * The search window is sized in KILOMETRES, not in radials. A couplet is
     * separated in azimuth, and one degree of azimuth is 0.5 km at 30 km range
     * and 3.5 km at 200 km — so a fixed radial count would search a different
     * physical area at every range. The configured azimuthWindow acts as the
     * floor, and the window is capped so the cost stays bounded. */
    const candidates = [];
    const gWin = Math.max(d.gateWindow, 4);
    const radialDeg = Math.max(0.1, Math.abs(geo.angleDiff(az[1 % nRad], az[0])) || 0.5);

    for (const seed of seeds) {
        const i0 = Math.floor(seed / 100000);
        const j0 = seed % 100000;

        // Radials needed to cover half a maximum-diameter couplet at this range.
        const crossKmPerRadial = Math.max(0.02, ranges[j0] * radialDeg * D2R);
        const azWin = Math.max(d.azimuthWindow,
            Math.min(24, Math.round((d.maxCoupletDiameterKm / 2) / crossKmPerRadial)));

        let vMax = -Infinity, vMin = Infinity;
        let iMax = -1, jMaxIdx = -1, iMin = -1, jMinIdx = -1;
        let samples = 0;

        for (let di = -azWin; di <= azWin; di++) {
            const i = ((i0 + di) % nRad + nRad) % nRad;
            const row = data[i];
            if (!row) continue;
            for (let dj = -gWin; dj <= gWin; dj++) {
                const j = j0 + dj;
                if (j < jMin || j > jMax) continue;
                const v = row[j];
                if (v == null) continue;
                samples++;
                if (v > vMax) { vMax = v; iMax = i; jMaxIdx = j; }
                if (v < vMin) { vMin = v; iMin = i; jMinIdx = j; }
            }
        }
        if (iMax < 0 || iMin < 0 || samples < 6) continue;

        const deltaV = vMax - vMin;
        if (deltaV < d.minDeltaVMs) continue;
        const vrot = deltaV / 2;
        if (vrot < d.minRotationalVelocityMs) continue;

        // ── aliasing rejection ──
        // Range folding puts a strong outbound next to a strong inbound at the
        // ±Nyquist boundary. That is an artifact of the measurement, not rotation.
        let aliasSuspect = false;
        if (nyquist) {
            const lim = nyquist * d.nyquistAliasFactor;
            if (vMax >= lim && vMin <= -lim) continue;               // textbook fold — drop it
            if (vMax >= lim || vMin <= -lim) aliasSuspect = true;    // near the limit — keep, but say so
        }

        // ── geometry of the couplet ──
        const posMax = geo.polarToLatLon(scan.radar.lat, scan.radar.lon, az[iMax], ranges[jMaxIdx], tilt);
        const posMin = geo.polarToLatLon(scan.radar.lat, scan.radar.lon, az[iMin], ranges[jMinIdx], tilt);
        const diameterKm = geo.distanceKm(posMax.lat, posMax.lon, posMin.lat, posMin.lon);
        if (diameterKm > d.maxCoupletDiameterKm) continue;   // too diffuse to be one circulation
        if (diameterKm < 0.05) continue;                     // same gate: nothing to divide by

        // Azimuthal shear across the couplet, s⁻¹.
        const shear = deltaV / (diameterKm * 1000);

        // Cyclonic if the outbound extreme sits at the higher azimuth.
        const cyclonic = geo.angleDiff(az[iMax], az[iMin]) > 0;

        // Centre of the circulation: midway between the extremes.
        const centreRangeKm = (ranges[jMaxIdx] + ranges[jMinIdx]) / 2;
        const centre = {
            lat: (posMax.lat + posMin.lat) / 2,
            lon: (posMax.lon + posMin.lon) / 2,
        };

        // ── reflectivity co-location ──
        // A velocity couplet with no storm over it is clutter, birds, chaff, or
        // a dealiasing artifact — not a mesocyclone.
        const dbz = sampleRef(az[i0], ranges[j0], d.reflectivitySearchKm);
        if (dbz == null || dbz < d.minReflectivityDbz) continue;

        // ── isolation test ──
        // Count neighbouring gates that share the sign of this shear. A real
        // circulation is coherent across several gates; a spike is not.
        // The comparison lag has to scale with the couplet, for the same reason
        // the seed pass uses several lags: across a broad circulation, adjacent
        // radials differ by almost nothing, and testing them would throw out
        // every wide mesocyclone as "unsupported".
        let supporting = 0;
        const supportStep = Math.max(1, Math.round(azWin / 3));
        for (let di = -azWin; di <= azWin; di++) {
            const i = ((i0 + di) % nRad + nRad) % nRad;
            const rowA = data[i], rowB = data[(i + supportStep) % nRad];
            if (!rowA || !rowB) continue;
            for (let dj = -gWin; dj <= gWin; dj++) {
                const j = j0 + dj;
                if (j < jMin || j > jMax) continue;
                const a = rowA[j], b = rowB[j];
                if (a == null || b == null) continue;
                const dv = b - a;
                if (Math.sign(dv) === (cyclonic ? 1 : -1) && Math.abs(dv) >= seedThreshold * 0.5) supporting++;
            }
        }
        if (supporting < d.minSupportingGates) continue;

        const beamKm = geo.beamHeightKm(centreRangeKm, tilt);

        candidates.push({
            lat: centre.lat,
            lon: centre.lon,
            rangeKm: centreRangeKm,
            azimuth: az[i0],
            deltaV,
            vMax,
            vMin,
            vrot,
            shear,
            diameterKm,
            cyclonic,
            dbz,
            beamHeightKm: beamKm,
            supportingGates: supporting,
            aliasSuspect,
            radiusKm: diameterKm / 2,
        });
    }
    if (!candidates.length) return [];

    /* Pass 3 — non-maximum suppression.
     * One real couplet seeds dozens of overlapping candidates. Keep the
     * strongest and absorb everything within a couplet-width of it. */
    candidates.sort((a, b) => b.deltaV - a.deltaV);
    const kept = [];
    for (const c of candidates) {
        let merged = false;
        for (const k of kept) {
            if (geo.distanceKm(c.lat, c.lon, k.lat, k.lon) <= Math.max(k.diameterKm, 3)) {
                k.mergedCount = (k.mergedCount || 1) + 1;
                merged = true;
                break;
            }
        }
        if (!merged) { c.mergedCount = 1; kept.push(c); }
        if (kept.length >= 60) break;                 // hard cap: a squall line is not 500 mesocyclones
    }

    // Confidence, now that merge counts are known.
    for (const c of kept) c.confidence = scoreConfidence(c, cfg);

    if (cfg.logging.logDetections) {
        for (const c of kept) {
            log.debug('rotation.detected', {
                site: scan.site, lat: c.lat.toFixed(3), lon: c.lon.toFixed(3),
                dv: c.deltaV, vrot: c.vrot, shear: c.shear, dia: c.diameterKm,
                dbz: c.dbz, beam: c.beamHeightKm, conf: c.confidence.value,
            });
        }
    }
    return kept;
}

/**
 * How much should we trust that this measurement is a real circulation?
 * Returns { value: 0..1, label, factors } — factors are kept so the UI can
 * explain a low confidence instead of just asserting it.
 */
function scoreConfidence(c, cfg) {
    const d = cfg.detection;
    const factors = {};

    // Closer to the radar = better sampled. Degrades toward the max range.
    factors.range = clamp01(1 - (c.rangeKm - d.minRangeKm) / Math.max(1, d.maxRangeKm - d.minRangeKm));

    // Beam height: at/below the low-level threshold this is a surface-relevant
    // measurement; well above it, the radar simply cannot see low-level rotation.
    factors.beamHeight = clamp01(1 - c.beamHeightKm / Math.max(0.5, d.maxBeamHeightKmForLowLevel * 2));

    // Storm support — more reflectivity means a better-defined storm.
    factors.reflectivity = clamp01((c.dbz - d.minReflectivityDbz) / 30);

    // Spatial coherence.
    factors.support = clamp01(c.supportingGates / Math.max(2, d.minSupportingGates * 4));
    factors.consensus = clamp01((c.mergedCount || 1) / 8);

    // Tightness: a 2 km couplet is far more convincing than a 10 km one.
    factors.tightness = clamp01(1 - c.diameterKm / Math.max(1, d.maxCoupletDiameterKm));

    let value = 0.22 * factors.range
        + 0.24 * factors.beamHeight
        + 0.16 * factors.reflectivity
        + 0.14 * factors.support
        + 0.10 * factors.consensus
        + 0.14 * factors.tightness;

    if (c.aliasSuspect) value *= 0.75;      // measurement may be folded
    if (!c.cyclonic) value *= 0.85;         // anticyclonic couplets are real but rarely tornadic

    value = clamp01(value);
    return { value, label: value >= 0.66 ? 'HIGH' : value >= 0.38 ? 'MEDIUM' : 'LOW', factors };
}

function clamp01(x) { return !Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 1 ? 1 : x; }

module.exports = { detectCirculations, scoreConfidence, makeReflectivitySampler };
