/*
 * skewt.js
 * Draws a broadcast-quality Skew-T / log-P diagram, a hodograph, and a severe-
 * weather index panel from a parsed sounding profile. Pure canvas 2D.
 *
 * Includes the full thermodynamic background (dry adiabats, moist adiabats,
 * mixing-ratio lines), a lifted surface-parcel path with shaded CAPE/CIN,
 * height labels, and wind barbs.
 */

// Skew-T frame + scaling.
const P_BOT = 1050, P_TOP = 100;      // pressure range (mb)
const T_MIN = -45, T_MAX = 50;        // temperature range at the baseline (°C)
const SKEW = 0.85;                    // isotherm tilt (px shift per px of height)

// ── thermodynamics ────────────────────────────────────────────────────────────
const RCP = 0.2854;                   // Rd/cp
function esat(Tc) { return 6.112 * Math.exp((17.67 * Tc) / (Tc + 243.5)); }        // hPa
function tdFromW(w, p) { const e = (w / 1000 * p) / (0.622 + w / 1000); const l = Math.log(e / 6.112); return (243.5 * l) / (17.67 - l); }
function dryAdiabatT(thetaC, p) { return (thetaC + 273.15) * Math.pow(p / 1000, RCP) - 273.15; }
// Moist-adiabat temperature step going UP by dp hPa (returns new T °C at p-dp).
function moistStep(Tc, p, dp) {
    const Tk = Tc + 273.15, Rd = 287.05, cpd = 1004, Lv = 2.5e6, eps = 0.622;
    const es = esat(Tc), ws = (eps * es) / (p - es);
    const dTdp = (1 / p) * ((Rd * Tk + Lv * ws) / (cpd + (Lv * Lv * ws * eps) / (Rd * Tk * Tk)));
    return Tc - dTdp * dp;            // going up (p → p−dp): T decreases
}
function lcl(Tc, Tdc, p) {
    const Tk = Tc + 273.15, Tdk = Tdc + 273.15;
    const Tl = 1 / (1 / (Tdk - 56) + Math.log(Tk / Tdk) / 800) + 56; // K
    return { Tlcl: Tl - 273.15, Plcl: p * Math.pow(Tl / Tk, 3.5) };
}

function makeTransforms(rect) {
    const { x, y, w, h } = rect;
    const bottom = y + h;
    const lp0 = Math.log(P_BOT), lp1 = Math.log(P_TOP);
    const yP = (p) => y + (lp0 - Math.log(p)) / (lp0 - lp1) * h;
    const xT = (tC, yy) => x + ((tC - T_MIN) / (T_MAX - T_MIN)) * w + (bottom - yy) * SKEW;
    const XY = (tC, p) => { const yy = yP(p); return [xT(tC, yy), yy]; };
    return { yP, xT, XY, bottom, x, y, w, h };
}

function line(ctx, pts, color, width, dash) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash(dash || []);
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
}

// Sample a curve function T(p) across the pressure range into screen points.
function curve(T, XY, pFrom, pTo, dp) {
    const pts = [];
    for (let p = pFrom; p >= pTo; p -= dp) pts.push(XY(T(p), p));
    return pts;
}

// ── wind barb (knots) ─────────────────────────────────────────────────────────
function drawBarb(ctx, x, y, dir, spd) {
    if (dir == null || spd == null) return;
    const rad = (dir * Math.PI) / 180;
    const dx = Math.sin(rad), dy = -Math.cos(rad);     // toward the source (upwind)
    const L = 30;
    const ex = x + dx * L, ey = y + dy * L;
    ctx.save();
    ctx.strokeStyle = '#e6eef8'; ctx.fillStyle = '#e6eef8'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    const px = -dy, py = dx;
    let s = Math.round(spd / 5) * 5;
    let pos = 0; const step = 6, barb = 12;
    const at = (d) => [ex - dx * d, ey - dy * d];
    if (s < 3) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return; }
    while (s >= 50) { const [bx, by] = at(pos); const [tx, ty] = at(pos + step); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px * barb, by + py * barb); ctx.lineTo(tx, ty); ctx.closePath(); ctx.fill(); pos += step; s -= 50; }
    while (s >= 10) { const [bx, by] = at(pos); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px * barb, by + py * barb); ctx.stroke(); pos += step; s -= 10; }
    if (s >= 5) { if (pos === 0) pos += step; const [bx, by] = at(pos); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px * barb * 0.5, by + py * barb * 0.5); ctx.stroke(); }
    ctx.restore();
}

// ── parcel + CAPE/CIN ─────────────────────────────────────────────────────────
// Build the surface-parcel temperature path (°C) at a set of pressures.
function parcelPath(sfc, pTop) {
    const { p: p0, t: t0, td: td0 } = sfc;
    const thetaC = (t0 + 273.15) * Math.pow(1000 / p0, RCP) - 273.15;
    const { Plcl, Tlcl } = lcl(t0, td0, p0);
    const out = []; const dp = 5;
    // dry adiabat, surface -> LCL
    for (let p = p0; p > Plcl; p -= dp) out.push({ p, t: dryAdiabatT(thetaC, p) });
    // moist adiabat, LCL -> top
    let Tc = Tlcl;
    for (let p = Plcl; p >= pTop; p -= dp) { out.push({ p, t: Tc }); Tc = moistStep(Tc, p, dp); }
    return out;
}

// Environment temperature interpolated to pressure p.
function makeEnvT(levels) {
    const L = levels.filter((l) => l.p != null && l.t != null).sort((a, b) => b.p - a.p);
    return (p) => {
        if (!L.length) return null;
        if (p >= L[0].p) return L[0].t;
        if (p <= L[L.length - 1].p) return L[L.length - 1].t;
        for (let i = 0; i < L.length - 1; i++) {
            if (p <= L[i].p && p >= L[i + 1].p) {
                const f = (L[i].p - p) / (L[i].p - L[i + 1].p);
                return L[i].t + (L[i + 1].t - L[i].t) * f;
            }
        }
        return null;
    };
}

// ── Skew-T ────────────────────────────────────────────────────────────────────
function drawSkewT(ctx, T, snd) {
    const { yP, xT, XY, bottom, x, y, w, h } = T;

    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();

    // dry adiabats (potential temperature) — warm tan
    for (let th = -30; th <= 200; th += 10) {
        line(ctx, curve((p) => dryAdiabatT(th, p), XY, P_BOT, P_TOP, 12), 'rgba(220,150,90,0.16)', 1);
    }
    // moist adiabats — teal, from a range of surface wet-bulb temps
    for (let t0 = -20; t0 <= 34; t0 += 6) {
        const pts = []; let Tc = t0; const dp = 8;
        for (let p = 1000; p >= P_TOP; p -= dp) { pts.push(XY(Tc, p)); Tc = moistStep(Tc, p, dp); }
        line(ctx, pts, 'rgba(80,200,170,0.16)', 1);
    }
    // mixing-ratio lines — dashed green, lower troposphere
    for (const wv of [1, 2, 4, 7, 10, 16, 24, 32]) {
        line(ctx, curve((p) => tdFromW(wv, p), XY, P_BOT, 480, 10), 'rgba(120,200,120,0.22)', 1, [3, 4]);
    }
    // isotherms (skewed) — subtle, 0°C emphasized
    for (let t = -120; t <= 60; t += 10) {
        line(ctx, [XY(t, P_BOT), XY(t, P_TOP)], t === 0 ? 'rgba(90,170,255,0.5)' : 'rgba(255,255,255,0.09)', t === 0 ? 1.3 : 1);
    }
    ctx.restore();

    // isobars + labels + height
    const isobars = [1000, 850, 700, 500, 400, 300, 250, 200, 150, 100];
    const envT = makeEnvT(snd.levels);
    ctx.save();
    ctx.font = '600 12px "Onest", system-ui, sans-serif';
    for (const p of isobars) {
        const yy = yP(p);
        line(ctx, [[x, yy], [x + w, yy]], 'rgba(255,255,255,0.13)', 1);
        ctx.fillStyle = '#9fb2c9'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(String(p), x - 7, yy);
    }
    ctx.restore();

    // temperature-axis labels
    ctx.save();
    ctx.font = '600 11px "Onest", system-ui, sans-serif';
    ctx.fillStyle = '#9fb2c9'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let t = -40; t <= 50; t += 10) { const xx = xT(t, bottom); if (xx >= x - 2 && xx <= x + w + 2) ctx.fillText(String(t), xx, bottom + 5); }
    ctx.restore();

    // parcel path + CAPE (red) / CIN (blue) shading
    const sfc = snd.levels.filter((l) => l.p != null && l.t != null && l.td != null).sort((a, b) => b.p - a.p)[0];
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (sfc) {
        const path = parcelPath(sfc, P_TOP);
        // shade area between parcel and environment
        for (let i = 0; i < path.length - 1; i++) {
            const a = path[i], b = path[i + 1];
            const ea = envT(a.p), eb = envT(b.p);
            if (ea == null || eb == null) continue;
            const warm = (a.t - ea) + (b.t - eb) >= 0;
            if (a.p > sfc.p) continue;
            ctx.beginPath();
            const [pax, pay] = XY(a.t, a.p), [pbx, pby] = XY(b.t, b.p);
            const [eax, eay] = XY(ea, a.p), [ebx, eby] = XY(eb, b.p);
            ctx.moveTo(pax, pay); ctx.lineTo(pbx, pby); ctx.lineTo(ebx, eby); ctx.lineTo(eax, eay); ctx.closePath();
            ctx.fillStyle = warm ? 'rgba(230,70,60,0.22)' : 'rgba(70,130,235,0.20)';
            ctx.fill();
        }
        // parcel line (dashed white)
        line(ctx, path.map((q) => XY(q.t, q.p)), 'rgba(255,255,255,0.72)', 1.6, [5, 4]);
    }
    // dewpoint (green) + temperature (red)
    const tPts = snd.levels.filter((l) => l.p != null && l.t != null).map((l) => XY(l.t, l.p));
    const dPts = snd.levels.filter((l) => l.p != null && l.td != null).map((l) => XY(l.td, l.p));
    line(ctx, dPts, '#2ecc71', 3);
    line(ctx, tPts, '#ff4136', 3);
    ctx.restore();

    // frame
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2; ctx.strokeRect(x, y, w, h);

    // wind-barb gutter (with a light separator)
    const bx = x + w + 30;
    line(ctx, [[x + w + 12, y], [x + w + 12, bottom]], 'rgba(255,255,255,0.10)', 1);
    let lastY = -1e9;
    for (const l of snd.levels) {
        if (l.p == null || l.wdir == null || l.wspd == null) continue;
        const yy = yP(l.p);
        if (yy < y || yy > bottom) continue;
        if (yy - lastY < 24) continue;
        drawBarb(ctx, bx, yy, l.wdir, l.wspd);
        lastY = yy;
    }

    // small legend for the profile lines
    ctx.save();
    ctx.font = '700 11px "Onest", system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const leg = [['Temp', '#ff4136'], ['Dewpt', '#2ecc71'], ['Parcel', 'rgba(255,255,255,0.8)']];
    let lx = x + 8;
    for (const [lab, col] of leg) {
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(lx, y + 12); ctx.lineTo(lx + 16, y + 12); ctx.stroke();
        ctx.fillStyle = '#cdd9e6'; ctx.textAlign = 'left'; ctx.fillText(lab, lx + 21, y + 12);
        lx += 21 + ctx.measureText(lab).width + 16;
    }
    ctx.restore();
}

// ── severe parameters (computed from the profile) ─────────────────────────────
const KT2MS = 0.514444;
function toUV(dir, spd) { const r = dir * Math.PI / 180; return { u: -spd * Math.sin(r), v: -spd * Math.cos(r) }; } // kt
function uvToDirSpd(u, v) { const spd = Math.hypot(u, v); let dir = Math.atan2(-u, -v) * 180 / Math.PI; if (dir < 0) dir += 360; return { dir: Math.round(dir), spd: Math.round(spd) }; }
function windProfile(snd) {
    return snd.levels
        .filter((l) => l.wdir != null && l.wspd != null && l.z != null)
        .map((l) => ({ agl: l.z - snd.surfaceZ, ...toUV(l.wdir, l.wspd) }))
        .filter((l) => l.agl >= -50 && l.agl <= 15000)
        .sort((a, b) => a.agl - b.agl);
}
function interpUV(wp, agl) {
    if (!wp.length) return null;
    if (agl <= wp[0].agl) return { u: wp[0].u, v: wp[0].v };
    for (let i = 1; i < wp.length; i++) if (agl <= wp[i].agl) { const t = (agl - wp[i - 1].agl) / ((wp[i].agl - wp[i - 1].agl) || 1); return { u: wp[i - 1].u + t * (wp[i].u - wp[i - 1].u), v: wp[i - 1].v + t * (wp[i].v - wp[i - 1].v) }; }
    return { u: wp[wp.length - 1].u, v: wp[wp.length - 1].v };
}
function meanWind(wp, z0, z1) { let su = 0, sv = 0, n = 0; for (const l of wp) if (l.agl >= z0 && l.agl <= z1) { su += l.u; sv += l.v; n++; } if (!n) { const a = interpUV(wp, z0), b = interpUV(wp, z1); return { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 }; } return { u: su / n, v: sv / n }; }
function shearMag(wp, z0, z1) { const a = interpUV(wp, z0), b = interpUV(wp, z1); if (!a || !b) return null; return Math.hypot(b.u - a.u, b.v - a.v); } // kt
function srhRel(wp, z0, z1, C) {
    let s = 0; const seg = wp.filter((l) => l.agl >= -20 && l.agl <= z1 + 300).sort((a, b) => a.agl - b.agl);
    for (let i = 1; i < seg.length; i++) {
        const a = seg[i - 1], b = seg[i]; if (b.agl < z0 || a.agl > z1) continue;
        const au = (a.u - C.u) * KT2MS, av = (a.v - C.v) * KT2MS, bu = (b.u - C.u) * KT2MS, bv = (b.v - C.v) * KT2MS;
        s += (bu * av - au * bv);
    }
    return s; // m²/s²
}
function bunkers(wp) {
    if (wp.length < 2) return null;
    const mean = meanWind(wp, 0, 6000);
    const lo = interpUV(wp, 0), hi = interpUV(wp, 6000);
    const shu = hi.u - lo.u, shv = hi.v - lo.v, mag = Math.hypot(shu, shv) || 1;
    const dev = 7.5 / KT2MS; // 7.5 m/s in kt
    const pu = (shv / mag) * dev, pv = (-shu / mag) * dev;
    return { mean, RM: { u: mean.u + pu, v: mean.v + pv }, LM: { u: mean.u - pu, v: mean.v - pv } };
}
function heightAtP(snd, p) {
    const L = snd.levels.filter((l) => l.p != null && l.z != null).sort((a, b) => b.p - a.p);
    if (!L.length) return null;
    if (p >= L[0].p) return L[0].z; if (p <= L[L.length - 1].p) return L[L.length - 1].z;
    for (let i = 0; i < L.length - 1; i++) if (p <= L[i].p && p >= L[i + 1].p) { const f = (L[i].p - p) / (L[i].p - L[i + 1].p); return L[i].z + (L[i + 1].z - L[i].z) * f; }
    return null;
}
function computeParams(snd) {
    const P = { cape: snd.cape, cin: snd.cin, pw: snd.pw, surfaceZ: snd.surfaceZ };
    const wp = windProfile(snd); P.wp = wp;
    const bk = bunkers(wp); P.storm = bk;
    if (bk) {
        P.shr01 = shearMag(wp, 0, 1000); P.shr06 = shearMag(wp, 0, 6000);
        P.srh01 = srhRel(wp, 0, 1000, bk.RM); P.srh03 = srhRel(wp, 0, 3000, bk.RM);
    }
    const lv = snd.levels.filter((l) => l.p != null && l.t != null).sort((a, b) => b.p - a.p);
    const sfc = lv.find((l) => l.type === 9) || lv[0];
    if (sfc && sfc.td != null) {
        const { Plcl } = lcl(sfc.t, sfc.td, sfc.p); P.lclP = Plcl; P.lclZ = heightAtP(snd, Plcl) - snd.surfaceZ;
        const env = makeEnvT(lv), par = parcelPath(sfc, P_TOP);
        let lfcP = null, elP = null, wasPos = false;
        for (const pt of par) { if (pt.p > Plcl) continue; const e = env(pt.p); if (e == null) continue; const pos = pt.t > e; if (pos && !wasPos && lfcP == null) lfcP = pt.p; if (!pos && wasPos && lfcP != null) elP = pt.p; wasPos = pos; }
        P.lfcP = lfcP; P.lfcZ = lfcP != null ? heightAtP(snd, lfcP) - snd.surfaceZ : null;
        P.elP = elP; P.elZ = elP != null ? heightAtP(snd, elP) - snd.surfaceZ : null;
    }
    const cape = snd.cape || 0;
    if (bk && P.srh03 != null && P.shr06 != null) { const e = P.shr06 * KT2MS, et = e < 10 ? 0 : (e > 20 ? 1 : e / 20); P.scp = (cape / 1000) * (Math.max(0, P.srh03) / 50) * et; }
    if (bk && P.srh01 != null && P.lclZ != null && P.shr06 != null) { const s = P.shr06 * KT2MS, st = s < 12.5 ? 0 : (s > 30 ? 1.5 : s / 20), lt = P.lclZ < 1000 ? 1 : (P.lclZ > 2000 ? 0 : (2000 - P.lclZ) / 1000); P.stp = (cape / 1500) * lt * (Math.max(0, P.srh01) / 150) * st; }
    if (P.srh03 != null) P.ehi = (cape * Math.max(0, P.srh03)) / 160000;
    P.hazard = hazardOf(P);
    return P;
}
function hazardOf(P) {
    const stp = P.stp || 0, scp = P.scp || 0, cape = P.cape || 0;
    if (stp >= 3) return { text: 'PDS TORNADO', color: '#ff2d78' };
    if (stp >= 1) return { text: 'TORNADO', color: '#ff5b5b' };
    if (scp >= 2) return { text: 'SUPERCELL', color: '#ff9f1c' };
    if (cape >= 1000 || scp >= 0.5) return { text: 'SEVERE STORMS', color: '#ffd24a' };
    if (cape >= 250) return { text: 'THUNDERSTORMS', color: '#4fc3ff' };
    return { text: 'GENERAL', color: '#8ea4bd' };
}

// ── hodograph (with Bunkers storm motion) ─────────────────────────────────────
function drawHodograph(ctx, rect, P) {
    const { x, y, w, h } = rect;
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) / 2 - 18;
    const wp = P.wp;
    const spds = wp.map((l) => Math.hypot(l.u, l.v));
    const rmSpd = P.storm ? Math.hypot(P.storm.RM.u, P.storm.RM.v) : 0;
    const maxSpd = Math.max(20, ...spds, rmSpd);
    const ring = maxSpd <= 20 ? 5 : maxSpd <= 40 ? 10 : maxSpd <= 80 ? 20 : 30;
    const top = Math.ceil(maxSpd / ring) * ring, sc = R / top;
    const plot = (u, v) => [cx + u * sc, cy - v * sc];

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.fillStyle = '#7f93ab';
    ctx.font = '600 10px "Onest", system-ui, sans-serif'; ctx.textAlign = 'center';
    for (let s = ring; s <= top; s += ring) { ctx.beginPath(); ctx.arc(cx, cy, s * sc, 0, Math.PI * 2); ctx.stroke(); ctx.fillText(String(s), cx, cy - s * sc - 1); }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.restore();

    const band = (agl) => (agl <= 1000 ? '#ff4136' : agl <= 3000 ? '#ff9f1c' : agl <= 6000 ? '#ffe14d' : '#4fc3ff');
    for (let i = 1; i < wp.length; i++) line(ctx, [plot(wp[i - 1].u, wp[i - 1].v), plot(wp[i].u, wp[i].v)], band(wp[i].agl), 2.6);
    if (wp.length) { const [sx, sy] = plot(wp[0].u, wp[0].v); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill(); }

    if (P.storm) {
        const mk = (pt, col, lab) => { const [mx, my] = plot(pt.u, pt.v); ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = '#0a0f1c'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = col; ctx.font = '800 11px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(lab, mx + 8, my + 4); };
        mk(P.storm.mean, '#c9d6e6', 'MW'); mk(P.storm.LM, '#4fc3ff', 'LM'); mk(P.storm.RM, '#ff5b5b', 'RM');
    }
    ctx.fillStyle = '#9fb2c9'; ctx.font = '700 12px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Hodograph (kt)', x, y - 8);
}

// ── LCL / LFC / EL markers on the Skew-T ──────────────────────────────────────
function drawParcelMarkers(ctx, T, P) {
    const { yP, x, w } = T;
    const mark = (p, lab, col) => { if (p == null) return; const yy = yP(p); ctx.strokeStyle = col; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + w - 66, yy); ctx.lineTo(x + w, yy); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; ctx.font = '800 11px "Onest", system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(lab, x + w - 2, yy - 3); };
    mark(P.lclP, 'LCL', '#69d2ff'); mark(P.lfcP, 'LFC', '#ffd24a'); mark(P.elP, 'EL', '#c9d6e6');
}

// ── parameter table (one titled column) ───────────────────────────────────────
function drawIndicesCol(ctx, x, y, w, title, rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7f93ab'; ctx.font = '800 10px "Onest", system-ui, sans-serif'; ctx.fillText(title, x, y);
    let yy = y + 8;
    for (const [k, v, col] of rows) {
        ctx.fillStyle = 'rgba(255,255,255,0.045)'; roundRect(ctx, x, yy, w, 22, 6); ctx.fill();
        ctx.fillStyle = '#9fb2c9'; ctx.font = '600 11.5px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(k, x + 10, yy + 15);
        ctx.fillStyle = col; ctx.font = '800 12px "Onest", system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(v, x + w - 10, yy + 15);
        yy += 26;
    }
    return yy + 8;
}
const _fmt = (v, d, suf) => (v == null || isNaN(v)) ? '—' : ((Math.abs(v) >= 100 ? Math.round(v) : (+v).toFixed(d == null ? 0 : d)) + (suf || ''));
const _km = (z) => z == null ? '—' : (z / 1000).toFixed(1) + ' km';
function thermoRows(P) {
    return [
        ['SB CAPE', _fmt(P.cape, 0, ' J/kg'), (P.cape || 0) >= 1000 ? '#ff6b5b' : '#eaf1fb'],
        ['SB CIN', _fmt(P.cin, 0, ' J/kg'), '#eaf1fb'],
        ['LCL height', _km(P.lclZ), '#69d2ff'],
        ['LFC height', _km(P.lfcZ), '#ffd24a'],
        ['EL height', _km(P.elZ), '#c9d6e6'],
        ['PWAT', P.pw == null ? '—' : (P.pw / 10).toFixed(1) + ' mm', '#eaf1fb'],
    ];
}
function kinRows(P) {
    return [
        ['0–1 km SRH', _fmt(P.srh01, 0, ' m²/s²'), (P.srh01 || 0) >= 150 ? '#ff9f1c' : '#eaf1fb'],
        ['0–3 km SRH', _fmt(P.srh03, 0, ' m²/s²'), (P.srh03 || 0) >= 250 ? '#ff9f1c' : '#eaf1fb'],
        ['0–1 km shear', _fmt(P.shr01, 0, ' kt'), '#eaf1fb'],
        ['0–6 km shear', _fmt(P.shr06, 0, ' kt'), (P.shr06 || 0) >= 35 ? '#ff9f1c' : '#eaf1fb'],
    ];
}
function compRows(P) {
    return [
        ['Supercell (SCP)', _fmt(P.scp, 1), (P.scp || 0) >= 2 ? '#ff9f1c' : '#eaf1fb'],
        ['Sig. Tornado (STP)', _fmt(P.stp, 1), (P.stp || 0) >= 1 ? '#ff5b5b' : '#eaf1fb'],
        ['0–3 km EHI', _fmt(P.ehi, 1), (P.ehi || 0) >= 1 ? '#ff9f1c' : '#eaf1fb'],
    ];
}
function drawStormReadout(ctx, x, y, P) {
    ctx.textAlign = 'left'; ctx.fillStyle = '#7f93ab'; ctx.font = '800 10px "Onest", system-ui, sans-serif';
    ctx.fillText('STORM MOTION', x, y);
    if (!P.storm) return;
    const rows = [['RM', P.storm.RM, '#ff5b5b'], ['LM', P.storm.LM, '#4fc3ff'], ['MW', P.storm.mean, '#c9d6e6']];
    let yy = y + 18;
    for (const [lab, m, col] of rows) {
        const d = uvToDirSpd(m.u, m.v);
        ctx.fillStyle = col; ctx.font = '800 12px "Onest", system-ui, sans-serif'; ctx.fillText(lab, x, yy);
        ctx.fillStyle = '#cdd9ea'; ctx.font = '600 12px "Onest", system-ui, sans-serif'; ctx.fillText(`${d.dir}° @ ${d.spd} kt`, x + 34, yy);
        yy += 18;
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Render everything to `canvas`.
function renderSounding(canvas, snd, meta) {
    const W = 1000, H = 720;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0f1728'); g.addColorStop(1, '#080d18');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#eaf1fb'; ctx.font = '800 18px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(meta.title || 'Forecast Sounding', 22, 30);
    if (meta.sub) { ctx.fillStyle = '#8ea4bd'; ctx.font = '600 12.5px "Onest", system-ui, sans-serif'; ctx.fillText(meta.sub, 22, 50); }

    const P = computeParams(snd);

    // hazard chip (top-right)
    if (P.hazard) {
        const t = P.hazard.text; ctx.font = '800 13px "Onest", system-ui, sans-serif';
        const bw = ctx.measureText(t).width + 26, bx = W - 22 - bw, by = 14;
        ctx.fillStyle = P.hazard.color; roundRect(ctx, bx, by, bw, 26, 13); ctx.fill();
        ctx.fillStyle = '#0a0f1c'; ctx.textAlign = 'center'; ctx.fillText(t, bx + bw / 2, by + 18);
    }

    const T = makeTransforms({ x: 54, y: 72, w: 470, h: 596 });
    drawSkewT(ctx, T, snd);
    drawParcelMarkers(ctx, T, P);

    drawHodograph(ctx, { x: 604, y: 92, w: 276, h: 276 }, P);
    drawStormReadout(ctx, 900, 110, P);

    // parameter tables (two columns)
    drawIndicesCol(ctx, 548, 452, 190, 'THERMODYNAMIC', thermoRows(P));
    const ky = drawIndicesCol(ctx, 762, 452, 218, 'KINEMATIC', kinRows(P));
    drawIndicesCol(ctx, 762, ky + 6, 218, 'COMPOSITE', compRows(P));
}

module.exports = { renderSounding };
