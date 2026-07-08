/*
 * storm_impact.js
 * Given a tracked storm cell's projected path (its current position + the STI
 * forecast positions) and the user's live GPS location, work out how the storm
 * affects THAT spot: ETA, local arrival clock time, distance, closest approach,
 * whether it passes over you, which way it's trending, a confidence level, and
 * best-effort rain/core/strongest/exit phase times.
 *
 * Pure geometry (turf only) so it can be unit-tested off the map. The caller
 * (plot_storm_tracks) supplies coordinates because it has the radar station to
 * convert az/range → lng/lat; this module stays presentation- and DOM-free.
 *
 * Model: near the pass, the storm centroid's distance to the user is
 *   dist(t) = sqrt(closestApproach² + (v·(t − tClosest))²)
 * so the user is inside a radius R for  |t − tClosest| ≤ sqrt(R² − ca²)/v.
 * We use a precip radius and a smaller core radius to derive the phase times.
 */

const turf = require('@turf/turf');

const DEFAULTS = {
    precipRadiusMi: 15,   // radius of the precipitation shield around the centroid
    coreRadiusMi: 5,      // radius of the heavy core
    maxHorizonMin: 120,   // how far past the last forecast point we'll extrapolate
    strongestOffsetMin: 0, // strongest ≈ closest approach (overhead)
};

const MPM = (mph) => mph / 60; // miles per minute

function clockAt(now, minFromNow) {
    return new Date(now + minFromNow * 60000)
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Cumulative along-path distance (miles) and the matching time (min) at each vertex.
function cumulative(path, times) {
    const cumDist = [0];
    for (let i = 1; i < path.length; i++) {
        cumDist[i] = cumDist[i - 1] + turf.distance(turf.point(path[i - 1]), turf.point(path[i]), { units: 'miles' });
    }
    return { cumDist, cumTime: times.slice() };
}

// Interpolate the time (min from now) at a given distance along the path.
function timeAtDistance(distMi, cumDist, cumTime) {
    if (distMi <= 0) return cumTime[0];
    for (let i = 1; i < cumDist.length; i++) {
        if (distMi <= cumDist[i] + 1e-9) {
            const span = cumDist[i] - cumDist[i - 1] || 1e-9;
            const f = (distMi - cumDist[i - 1]) / span;
            return cumTime[i - 1] + f * (cumTime[i] - cumTime[i - 1]);
        }
    }
    return cumTime[cumTime.length - 1];
}

/**
 * @param {Object} o
 *  path      Array<[lng,lat]>  current + forecast positions (>=1)
 *  times     Array<number>     minutes-from-now for each path vertex (path[0]=0)
 *  speedMph  number            storm speed
 *  motionText string           preformatted e.g. "NE at 38 mph"
 *  user      [lng,lat]         user's location
 *  cell      Object            { error:{error}, graph_data:{dbzm}, hasRotation }
 *  now       number            Date.now() (injectable for tests)
 *  opts      Object            radius overrides
 * @returns {Object} impact summary (see fields below)
 */
function computeImpact(o) {
    const cfg = Object.assign({}, DEFAULTS, o.opts || {});
    const now = o.now || Date.now();
    const user = turf.point(o.user);
    const speed = Number(o.speedMph) || 0;
    const distanceMiles = turf.distance(turf.point(o.path[0]), user, { units: 'miles' });

    const base = {
        ok: true,
        distanceMiles,
        motionText: o.motionText || '',
        impactType: impactTypeFor(o.cell),
        confidence: 'Low',
    };

    // No usable motion → distance only.
    if (speed < 1 || o.path.length < 2) {
        return Object.assign(base, {
            hasEta: false,
            intersects: false,
            trend: 'stationary',
            message: 'Storm motion not yet established — showing distance only.',
        });
    }

    // Work on a copy of the path/times, extrapolated one vertex past the last
    // forecast so a closest approach just beyond the horizon is still found.
    let path = o.path.slice();
    let times = o.times.slice();
    const n = path.length;
    const lastT = times[n - 1];
    if (lastT < cfg.maxHorizonMin) {
        const brg = turf.bearing(turf.point(path[n - 2]), turf.point(path[n - 1]));
        const extraMin = cfg.maxHorizonMin - lastT;
        const ext = turf.getCoord(turf.destination(turf.point(path[n - 1]), MPM(speed) * extraMin, brg, { units: 'miles' }));
        path.push(ext);
        times.push(cfg.maxHorizonMin);
    }

    const line = turf.lineString(path);
    const near = turf.nearestPointOnLine(line, user, { units: 'miles' });
    const closestApproachMiles = near.properties.dist;
    const alongMi = near.properties.location;
    const { cumDist, cumTime } = cumulative(path, times);
    let tClosest = timeAtDistance(alongMi, cumDist, cumTime);

    const trend = tClosest > 0.5 ? 'closer' : (tClosest < -0.5 ? 'farther' : 'stationary');
    const confidence = confidenceFor({ distanceMiles, closestApproachMiles, speed, cell: o.cell, forecastPts: o.path.length });

    // Phase windows from the pass geometry.
    const v = MPM(speed);
    const halfWidth = (R) => (closestApproachMiles <= R ? Math.sqrt(R * R - closestApproachMiles * closestApproachMiles) / v : null);
    const precipHalf = halfWidth(cfg.precipRadiusMi);
    const coreHalf = halfWidth(cfg.coreRadiusMi);

    const passesCore = coreHalf != null && tClosest + coreHalf > 0;
    const passesPrecip = precipHalf != null && tClosest + precipHalf > 0;
    const intersects = passesPrecip; // storm meaningfully reaches the user

    const phase = (min) => (min == null ? null : { min: Math.round(min), clock: clockAt(now, min) });
    const rainStart = precipHalf != null ? tClosest - precipHalf : null;
    const coreStart = coreHalf != null ? tClosest - coreHalf : null;
    const strongest = tClosest + cfg.strongestOffsetMin;
    const exit = precipHalf != null ? tClosest + precipHalf : null;

    // Headline arrival = when the storm first reaches the user (core if it passes
    // over the core, else the precip edge). Clamp negative (already arrived) to 0.
    let arrivalMin = null;
    if (passesCore) arrivalMin = Math.max(0, coreStart);
    else if (passesPrecip) arrivalMin = Math.max(0, rainStart);

    const result = Object.assign(base, {
        hasEta: arrivalMin != null,
        etaMin: arrivalMin != null ? Math.round(arrivalMin) : null,
        arrivalClock: arrivalMin != null ? clockAt(now, arrivalMin) : null,
        closestApproachMiles,
        closestApproachClock: clockAt(now, Math.max(0, tClosest)),
        closestApproachMin: Math.round(tClosest),
        intersects,
        trend,
        confidence,
        phases: {
            rain: rainStart != null && rainStart >= -0.5 ? phase(Math.max(0, rainStart)) : null,
            core: passesCore ? phase(Math.max(0, coreStart)) : null,
            strongest: intersects ? phase(Math.max(0, strongest)) : null,
            exit: exit != null && exit > 0 ? phase(exit) : null,
        },
    });

    result.message = intersects
        ? null
        : `Storm no longer expected to directly impact your location. Closest approach: ${closestApproachMiles.toFixed(1)} mi at ${result.closestApproachClock}.`;
    return result;
}

function impactTypeFor(cell) {
    const parts = [];
    const dbzm = cell && cell.graph_data && cell.graph_data.dbzm;
    if (typeof dbzm === 'number') {
        if (dbzm >= 60) parts.push('Core / hail risk');
        else if (dbzm >= 50) parts.push('Heavy core');
        else if (dbzm >= 35) parts.push('Rain');
        else parts.push('Light rain');
    }
    if (cell && cell.hasRotation) parts.push('Rotation risk');
    return parts.join(' · ') || 'Rain';
}

function confidenceFor({ distanceMiles, closestApproachMiles, speed, cell, forecastPts }) {
    let score = 0;
    score += Math.min(Math.max(forecastPts - 1, 0), 4); // more forecast points = steadier track
    const errNM = cell && cell.error && cell.error.error;
    if (typeof errNM === 'number') score += errNM < 5 ? 2 : (errNM < 10 ? 1 : 0);
    else score += 1;
    if (distanceMiles < 25) score += 2; else if (distanceMiles < 60) score += 1;
    if (speed > 8) score += 1;
    if (closestApproachMiles < 5) score += 1;
    return score >= 8 ? 'High' : (score >= 5 ? 'Medium' : 'Low');
}

module.exports = { computeImpact };
