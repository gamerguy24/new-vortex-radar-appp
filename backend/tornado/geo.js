/*
 * backend/tornado/geo.js
 * Geometry shared by the whole engine: radar polar coordinates → lat/lon,
 * distances, bearings, dead-reckoned projections, and radar beam height.
 *
 * Beam height matters more than it looks. A couplet 200 km from the radar sits
 * ~3.5 km above ground even on the 0.5° sweep, so it says nothing about
 * low-level rotation. The engine uses beamHeightKm() to decide how much a
 * detection is allowed to count toward the "low-level rotation" term rather
 * than pretending every detection is near the surface.
 */

const R_EARTH_KM = 6371.0088;
const IR = 4 / 3;                     // standard atmosphere refraction factor
const EFF_R = R_EARTH_KM * IR;        // effective earth radius for beam propagation
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const MS_TO_KT = 1.9438445;
const MS_TO_MPH = 2.2369363;
const KM_TO_MI = 0.6213712;

/** Height of the radar beam centre above the radar, km, for a slant range. */
function beamHeightKm(rangeKm, elevationDeg) {
    const e = (elevationDeg || 0.5) * D2R;
    // Doviak & Zrnić 4/3-earth approximation.
    return Math.sqrt(rangeKm * rangeKm + EFF_R * EFF_R + 2 * rangeKm * EFF_R * Math.sin(e)) - EFF_R;
}

/** Great-circle distance in km. */
function distanceKm(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * D2R;
    const dLon = (lon2 - lon1) * D2R;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north. */
function bearingDeg(lat1, lon1, lat2, lon2) {
    const y = Math.sin((lon2 - lon1) * D2R) * Math.cos(lat2 * D2R);
    const x = Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R)
        - Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos((lon2 - lon1) * D2R);
    return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point `distKm` from (lat,lon) along `bearing` degrees. */
function destination(lat, lon, bearing, distKm) {
    const d = distKm / R_EARTH_KM;
    const b = bearing * D2R;
    const la1 = lat * D2R, lo1 = lon * D2R;
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
    const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
    return { lat: la2 * R2D, lon: ((lo2 * R2D + 540) % 360) - 180 };
}

/**
 * Radar polar (azimuth°, slant range km) → lat/lon.
 * Ground range is the projection of slant range at the sweep's elevation angle;
 * at 0.5° the difference is tiny but it is free to be correct.
 */
function polarToLatLon(radarLat, radarLon, azimuthDeg, rangeKm, elevationDeg) {
    const groundKm = rangeKm * Math.cos((elevationDeg || 0.5) * D2R);
    return destination(radarLat, radarLon, azimuthDeg, groundKm);
}

/** Smallest signed difference between two bearings, in degrees (-180, 180]. */
function angleDiff(a, b) {
    let d = ((a - b + 540) % 360) - 180;
    if (d === -180) d = 180;
    return d;
}

/** Compass point for a bearing, e.g. 245 → "WSW". */
function compass(deg) {
    const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return pts[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** Ray-casting point-in-polygon. `ring` is [[lon,lat], ...] (GeoJSON order). */
function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const hit = ((yi > lat) !== (yj > lat))
            && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || Number.EPSILON) + xi);
        if (hit) inside = !inside;
    }
    return inside;
}

/** Point-in-polygon for GeoJSON Polygon / MultiPolygon geometry (holes honoured). */
function pointInGeometry(lon, lat, geometry) {
    if (!geometry) return false;
    const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates
        : geometry.type === 'Polygon' ? [geometry.coordinates] : [];
    for (const poly of polys) {
        if (!poly || !poly.length) continue;
        if (!pointInRing(lon, lat, poly[0])) continue;
        let inHole = false;
        for (let h = 1; h < poly.length; h++) if (pointInRing(lon, lat, poly[h])) { inHole = true; break; }
        if (!inHole) return true;
    }
    return false;
}

module.exports = {
    R_EARTH_KM, MS_TO_KT, MS_TO_MPH, KM_TO_MI,
    beamHeightKm, distanceKm, bearingDeg, destination, polarToLatLon,
    angleDiff, compass, pointInGeometry,
};
