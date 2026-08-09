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

// ── hodograph ─────────────────────────────────────────────────────────────────
function drawHodograph(ctx, rect, snd) {
    const { x, y, w, h } = rect;
    const cx = x + w / 2, cy = y + h / 2;
    const R = Math.min(w, h) / 2 - 16;

    const wl = snd.levels
        .filter((l) => l.wdir != null && l.wspd != null && l.z != null)
        .map((l) => ({ agl: l.z - snd.surfaceZ, dir: l.wdir, spd: l.wspd }))
        .filter((l) => l.agl >= -50 && l.agl <= 12000)
        .sort((a, b) => a.agl - b.agl);

    // auto-scale so light-wind cases still fill the plot
    const maxSpd = Math.max(20, ...wl.map((l) => l.spd));
    const ring = maxSpd <= 20 ? 5 : maxSpd <= 40 ? 10 : maxSpd <= 80 ? 20 : 30;
    const top = Math.ceil(maxSpd / ring) * ring;
    const sc = R / top;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.fillStyle = '#8398b0';
    ctx.font = '600 10px "Onest", system-ui, sans-serif'; ctx.textAlign = 'center';
    for (let s = ring; s <= top; s += ring) { ctx.beginPath(); ctx.arc(cx, cy, s * sc, 0, Math.PI * 2); ctx.stroke(); ctx.fillText(String(s), cx, cy - s * sc - 1); }
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.restore();

    const uv = (l) => { const r = (l.dir * Math.PI) / 180; return [cx + (-l.spd * Math.sin(r)) * sc, cy - (-l.spd * Math.cos(r)) * sc]; };
    const band = (agl) => (agl <= 1000 ? '#ff4136' : agl <= 3000 ? '#ff9f1c' : agl <= 6000 ? '#ffe14d' : '#4fc3ff');
    for (let i = 1; i < wl.length; i++) line(ctx, [uv(wl[i - 1]), uv(wl[i])], band(wl[i].agl), 2.6);
    if (wl.length) { const [sx, sy] = uv(wl[0]); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill(); }

    ctx.fillStyle = '#9fb2c9'; ctx.font = '700 12px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('Hodograph (kt)', x, y - 8);
}

// ── indices panel ─────────────────────────────────────────────────────────────
function drawIndices(ctx, rect, snd) {
    const { x, y, w } = rect;
    const rows = [
        ['CAPE', snd.cape == null ? '—' : snd.cape + ' J/kg', snd.cape > 1000 ? '#ff6b5b' : '#eaf1fb'],
        ['CIN', snd.cin == null ? '—' : snd.cin + ' J/kg', '#eaf1fb'],
        ['0-3 km SRH', snd.helic == null ? '—' : snd.helic + ' m²/s²', '#eaf1fb'],
        ['Precip. water', snd.pw == null ? '—' : (snd.pw / 10).toFixed(1) + ' mm', '#eaf1fb'],
    ];
    ctx.save();
    ctx.fillStyle = '#9fb2c9'; ctx.font = '700 12px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('Indices', x, y - 8);
    let yy = y + 14;
    for (const [k, v, col] of rows) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        roundRect(ctx, x, yy - 13, w, 28, 8); ctx.fill();
        ctx.fillStyle = '#9fb2c9'; ctx.font = '600 13px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(k, x + 12, yy + 2);
        ctx.fillStyle = col; ctx.font = '800 14px "Onest", system-ui, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(v, x + w - 12, yy + 2);
        yy += 34;
    }
    ctx.restore();
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
    // panel background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#111a2c'); g.addColorStop(1, '#0a0f1c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#eaf1fb'; ctx.font = '800 18px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(meta.title || 'Forecast Sounding', 22, 30);
    if (meta.sub) { ctx.fillStyle = '#8ea4bd'; ctx.font = '600 12.5px "Onest", system-ui, sans-serif'; ctx.fillText(meta.sub, 22, 50); }

    const T = makeTransforms({ x: 58, y: 72, w: 486, h: 590 });
    drawSkewT(ctx, T, snd);

    drawHodograph(ctx, { x: 662, y: 104, w: 300, h: 300 }, snd);
    drawIndices(ctx, { x: 662, y: 460, w: 300 }, snd);
}

module.exports = { renderSounding };
