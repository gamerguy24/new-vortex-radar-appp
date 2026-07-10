/*
 * mst_geometry.js
 * Pure geometry for the Manual Storm Track tool (turf only, DOM-free so it can
 * be reasoned about / tested in isolation).
 *
 * Given a storm origin, a motion bearing and a user-entered speed it produces:
 *   - the projected centerline + arrow tip,
 *   - a forecast SWATH polygon:
 *        cellular  -> a cone that widens downstream (single-cell uncertainty),
 *        linear    -> a rectangle swept forward from a perpendicular leading
 *                     edge (a line of storms moving together),
 *   - ETA tick marks along the centerline,
 *   - the list of communities the swath crosses with each one's arrival time.
 */

const turf = require('@turf/turf');

const DEFAULTS = {
    horizonMin: 60,        // how far ahead to project
    tickMin: 15,           // spacing of ETA tick marks
    coreHalfMi: 4,         // half-width of the cell at the origin
    spreadDeg: 9,          // cellular cone half-angle (directional uncertainty)
    linearHalfLenMi: 30,   // linear leading-edge half-length
    samples: 24,           // polygon smoothness
};

const MPM = (mph) => mph / 60; // miles per minute

function clockAt(now, minFromNow) {
    return new Date(now + minFromNow * 60000)
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Offset a point perpendicular to `bearing` by `distMi` (right = +90°).
function perpOffset(coord, bearing, distMi) {
    if (distMi === 0) return coord;
    const side = distMi > 0 ? bearing + 90 : bearing - 90;
    return turf.getCoord(turf.destination(turf.point(coord), Math.abs(distMi), side, { units: 'miles' }));
}

/**
 * @param {Object} o
 *   origin   [lng,lat]
 *   bearing  degrees (direction of storm motion)
 *   speedMph number
 *   mode     'cellular' | 'linear'
 *   opts     overrides of DEFAULTS
 * @returns { totalMi, tipCoord, centerline(GeoJSON), swath(GeoJSON),
 *            arrow(GeoJSON), ticks:[{min,coord}] }
 */
function buildTrack(o) {
    const cfg = Object.assign({}, DEFAULTS, o.opts || {});
    const speed = Math.max(Number(o.speedMph) || 0, 0);
    const bearing = o.bearing;
    const origin = o.origin;
    const totalMi = MPM(speed) * cfg.horizonMin;

    const tipCoord = turf.getCoord(turf.destination(turf.point(origin), totalMi, bearing, { units: 'miles' }));
    const centerline = turf.lineString([origin, tipCoord]);

    // Sample points evenly along the centerline (0 .. totalMi).
    const step = totalMi / cfg.samples;
    const centers = [];
    for (let i = 0; i <= cfg.samples; i++) {
        const d = step * i;
        centers.push(turf.getCoord(turf.destination(turf.point(origin), d, bearing, { units: 'miles' })));
    }

    let swath;
    if (o.mode === 'linear') {
        // Rectangle: perpendicular leading edge of half-length L swept origin->tip.
        const L = cfg.linearHalfLenMi;
        const ring = [
            perpOffset(origin, bearing, -L),
            perpOffset(tipCoord, bearing, -L),
            perpOffset(tipCoord, bearing, L),
            perpOffset(origin, bearing, L),
        ];
        ring.push(ring[0]);
        swath = turf.polygon([ring]);
    } else {
        // Cone: half-width grows with downstream distance.
        const tan = Math.tan(cfg.spreadDeg * Math.PI / 180);
        const left = [];
        const right = [];
        for (let i = 0; i <= cfg.samples; i++) {
            const d = step * i;
            const half = cfg.coreHalfMi + d * tan;
            left.push(perpOffset(centers[i], bearing, -half));
            right.push(perpOffset(centers[i], bearing, half));
        }
        const ring = left.concat(right.reverse());
        ring.push(ring[0]);
        swath = turf.polygon([ring]);
    }

    // Arrow (centerline + a small two-segment head at the tip).
    const headMi = Math.max(totalMi * 0.12, 3);
    const headL = turf.getCoord(turf.destination(turf.point(tipCoord), headMi, bearing + 150, { units: 'miles' }));
    const headR = turf.getCoord(turf.destination(turf.point(tipCoord), headMi, bearing - 150, { units: 'miles' }));
    const arrow = turf.multiLineString([
        [origin, tipCoord],
        [headL, tipCoord, headR],
    ]);

    // ETA tick marks along the centerline.
    const ticks = [];
    for (let m = cfg.tickMin; m <= cfg.horizonMin + 1e-6; m += cfg.tickMin) {
        const d = MPM(speed) * m;
        if (d > totalMi + 1e-6) break;
        ticks.push({ min: m, coord: turf.getCoord(turf.destination(turf.point(origin), d, bearing, { units: 'miles' })) });
    }

    return { totalMi, tipCoord, centerline, swath, arrow, ticks, horizonMin: cfg.horizonMin };
}

/**
 * Which communities does the swath cross, and when does the storm reach each?
 * @param {Object} track  result of buildTrack
 * @param {Array}  cities [{name,lat,lon,population}]
 * @param {Object} o      { origin, speedMph, now }
 * @returns { rows:[{name,etaMin,clock,population,alongMi}], totalPopulation,
 *            countedPopulation, listedCount }
 */
function computeImpacts(track, cities, o) {
    const now = o.now || Date.now();
    const speed = Math.max(Number(o.speedMph) || 0, 0);
    const vpm = MPM(speed);
    const rows = [];

    for (const c of cities) {
        const pt = turf.point([c.lon, c.lat]);
        if (!turf.booleanPointInPolygon(pt, track.swath)) continue;
        // Distance from origin measured ALONG the direction of travel.
        const near = turf.nearestPointOnLine(track.centerline, pt, { units: 'miles' });
        const alongMi = near.properties.location;
        const etaMin = vpm > 0 ? alongMi / vpm : null;
        rows.push({
            name: c.name,
            population: c.population || 0,
            alongMi,
            etaMin: etaMin != null ? Math.max(0, Math.round(etaMin)) : null,
            clock: etaMin != null ? clockAt(now, Math.max(0, etaMin)) : null,
        });
    }

    // Nearest first. De-dup by name keeping the earliest ETA.
    rows.sort((a, b) => a.alongMi - b.alongMi);
    const seen = new Set();
    const deduped = [];
    for (const r of rows) {
        const k = r.name.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        deduped.push(r);
    }

    const countedPopulation = deduped.reduce((s, r) => s + (r.population > 0 ? r.population : 0), 0);
    return {
        rows: deduped,
        totalPopulation: countedPopulation,
        countedPopulation,
        listedCount: deduped.length,
    };
}

module.exports = { buildTrack, computeImpacts, clockAt };
