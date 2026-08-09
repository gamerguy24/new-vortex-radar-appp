/*
 * sounding_math.js
 * Derived-quantity helpers for soundings, shared by the server GRIB assembler
 * (soundings_grib.js). Pure functions, no I/O.
 *
 * Profile level shape: { p (mb), z (m MSL), t (°C), td (°C), wdir (deg), wspd (kt) }
 */

// Dewpoint (°C) from temperature (°C) + relative humidity (%), Magnus formula.
function dewpoint(tC, rh) {
    if (tC == null || rh == null) return null;
    rh = Math.max(1, Math.min(100, rh));
    const a = 17.625, b = 243.04;
    const g = Math.log(rh / 100) + (a * tC) / (b + tC);
    return (b * g) / (a - g);
}

// RH (%) from temperature and dewpoint (both °C).
function rhFromTd(tC, tdC) {
    if (tC == null || tdC == null) return null;
    const es = (T) => 6.112 * Math.exp((17.67 * T) / (T + 243.5));
    return Math.max(1, Math.min(100, 100 * es(tdC) / es(tC)));
}

// Wind direction (deg, FROM) + speed (kt) from u/v components (m/s).
function windFromUV(u, v) {
    if (u == null || v == null) return { wdir: null, wspd: null };
    const spd = Math.hypot(u, v) * 1.943844;            // m/s -> kt
    let dir = (Math.atan2(-u, -v) * 180) / Math.PI;     // meteorological FROM
    if (dir < 0) dir += 360;
    return { wdir: Math.round(dir), wspd: Math.round(spd) };
}

// Precipitable water (mm) by integrating specific humidity over pressure.
function precipWater(levels) {
    const L = levels.filter((l) => l.p != null && l.td != null).sort((a, b) => b.p - a.p);
    if (L.length < 2) return null;
    const g = 9.80665;
    const q = (td, p) => { const e = 6.112 * Math.exp((17.67 * td) / (td + 243.5)); return (0.622 * e) / (p - 0.378 * e); };
    let pw = 0;
    for (let i = 0; i < L.length - 1; i++) {
        const q1 = q(L[i].td, L[i].p), q2 = q(L[i + 1].td, L[i + 1].p);
        const dP = (L[i].p - L[i + 1].p) * 100; // Pa
        pw += 0.5 * (q1 + q2) * dP / g;         // kg/m² = mm
    }
    return pw > 0 ? pw : null;
}

// 0–3 km storm-relative helicity (m²/s²), Bunkers right-mover storm motion.
function srh03(levels, surfaceZ) {
    const W = levels
        .filter((l) => l.wdir != null && l.wspd != null && l.z != null)
        .map((l) => {
            const r = (l.wdir * Math.PI) / 180;
            const spd = l.wspd * 0.514444;      // kt -> m/s
            return { agl: l.z - surfaceZ, u: -spd * Math.sin(r), v: -spd * Math.cos(r) };
        })
        .filter((l) => l.agl >= -50 && l.agl <= 8000)
        .sort((a, b) => a.agl - b.agl);
    if (W.length < 3) return null;

    let su = 0, sv = 0, n = 0;
    for (const w of W) { if (w.agl <= 6000) { su += w.u; sv += w.v; n++; } }
    if (!n) return null;
    const mu = su / n, mv = sv / n;

    const sfc = W[0];
    let top = W[W.length - 1];
    for (const w of W) { if (w.agl >= 6000) { top = w; break; } }
    const shu = top.u - sfc.u, shv = top.v - sfc.v;
    const smag = Math.hypot(shu, shv) || 1;

    const D = 7.5; // Bunkers deviation (m/s), right-mover
    const cx = mu + D * (shv / smag);
    const cy = mv - D * (shu / smag);

    let srh = 0;
    for (let i = 0; i < W.length - 1; i++) {
        if (W[i].agl > 3000) break;
        const u1 = W[i].u - cx, v1 = W[i].v - cy;
        const u2 = W[i + 1].u - cx, v2 = W[i + 1].v - cy;
        srh += (u2 * v1) - (u1 * v2);
    }
    return srh;
}

module.exports = { dewpoint, rhFromTd, windFromUV, precipWater, srh03 };
