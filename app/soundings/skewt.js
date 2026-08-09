/*
 * skewt.js
 * Draws a Skew-T / log-P diagram, a hodograph, and a severe-weather index panel
 * from a parsed rucsoundings profile (see rucsoundings.js). Pure canvas 2D — no
 * external plotting library.
 */

// Skew-T frame + scaling.
const P_BOT = 1050, P_TOP = 100;      // pressure range (mb)
const T_MIN = -40, T_MAX = 45;        // temperature range at the baseline (°C)
const SKEW = 0.9;                     // isotherm tilt (px shift per px of height)

function makeTransforms(rect) {
    const { x, y, w, h } = rect;
    const bottom = y + h;
    const lp0 = Math.log(P_BOT), lp1 = Math.log(P_TOP);
    const yP = (p) => y + (lp0 - Math.log(p)) / (lp0 - lp1) * h;
    const xT = (tC, yy) => x + ((tC - T_MIN) / (T_MAX - T_MIN)) * w + (bottom - yy) * SKEW;
    return { yP, xT, bottom, x, y, w, h };
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

// ── wind barb (knots) ─────────────────────────────────────────────────────────
function drawBarb(ctx, x, y, dir, spd) {
    if (dir == null || spd == null) return;
    const rad = (dir * Math.PI) / 180;
    const dx = Math.sin(rad), dy = -Math.cos(rad);     // toward the source (upwind)
    const L = 30;
    const ex = x + dx * L, ey = y + dy * L;
    ctx.save();
    ctx.strokeStyle = '#dfe8f5'; ctx.fillStyle = '#dfe8f5'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();

    // perpendicular direction for the barbs
    const px = -dy, py = dx;
    let s = Math.round(spd / 5) * 5;
    let pos = 0;                          // distance from the staff end (ex,ey), inward
    const step = 6, barb = 12;
    const at = (d) => [ex - dx * d, ey - dy * d];

    // calm
    if (s < 3) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return; }

    // 50-kt flags (filled triangles)
    while (s >= 50) {
        const [bx, by] = at(pos);
        const [tx, ty] = at(pos + step);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + px * barb, by + py * barb);
        ctx.lineTo(tx, ty);
        ctx.closePath(); ctx.fill();
        pos += step; s -= 50;
    }
    if (s >= 50) pos += step * 0.5;
    // 10-kt full barbs
    while (s >= 10) {
        const [bx, by] = at(pos);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px * barb, by + py * barb); ctx.stroke();
        pos += step; s -= 10;
    }
    // 5-kt half barb
    if (s >= 5) {
        if (pos === 0) pos += step; // don't put a half-barb at the very tip
        const [bx, by] = at(pos);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px * barb * 0.5, by + py * barb * 0.5); ctx.stroke();
    }
    ctx.restore();
}

// ── Skew-T ────────────────────────────────────────────────────────────────────
function drawSkewT(ctx, T, snd) {
    const { yP, xT, bottom, x, y, w, h } = T;

    // clip to the plot
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();

    // isotherms (skewed)
    for (let t = -100; t <= 50; t += 10) {
        const a = [xT(t, bottom), bottom];
        const b = [xT(t, y), y];
        line(ctx, [a, b], t === 0 ? 'rgba(80,160,255,0.55)' : 'rgba(255,255,255,0.12)', t === 0 ? 1.4 : 1);
    }
    ctx.restore();

    // isobars + labels
    const isobars = [1000, 850, 700, 500, 400, 300, 250, 200, 150, 100];
    ctx.save();
    ctx.font = '600 12px "Onest", system-ui, sans-serif';
    ctx.fillStyle = '#9fb2c9'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const p of isobars) {
        const yy = yP(p);
        line(ctx, [[x, yy], [x + w, yy]], 'rgba(255,255,255,0.14)', 1);
        ctx.fillText(String(p), x - 6, yy);
    }
    ctx.restore();

    // temperature-axis labels along the bottom
    ctx.save();
    ctx.font = '600 11px "Onest", system-ui, sans-serif';
    ctx.fillStyle = '#9fb2c9'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let t = -40; t <= 40; t += 10) {
        const xx = xT(t, bottom);
        if (xx >= x && xx <= x + w) ctx.fillText(String(t), xx, bottom + 4);
    }
    ctx.restore();

    // profiles (clipped)
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const tPts = snd.levels.filter((l) => l.p != null && l.t != null).map((l) => [xT(l.t, yP(l.p)), yP(l.p)]);
    const dPts = snd.levels.filter((l) => l.p != null && l.td != null).map((l) => [xT(l.td, yP(l.p)), yP(l.p)]);
    line(ctx, dPts, '#25c05a', 2.6);   // dewpoint (green)
    line(ctx, tPts, '#ff4136', 2.6);   // temperature (red)
    ctx.restore();

    // frame
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2; ctx.strokeRect(x, y, w, h);

    // wind barbs in the right gutter, thinned so they don't stack
    const bx = x + w + 22;
    let lastY = -1e9;
    for (const l of snd.levels) {
        if (l.p == null || l.wdir == null || l.wspd == null) continue;
        const yy = yP(l.p);
        if (yy < y || yy > bottom) continue;
        if (yy - lastY < 26) continue;    // vertical spacing
        drawBarb(ctx, bx, yy, l.wdir, l.wspd);
        lastY = yy;
    }
}

// ── hodograph ─────────────────────────────────────────────────────────────────
function drawHodograph(ctx, rect, snd) {
    const { x, y, w, h } = rect;
    const cx = x + w / 2, cy = y + h / 2;
    const R = Math.min(w, h) / 2 - 14;

    // wind levels 0–9 km AGL with speed
    const wl = snd.levels
        .filter((l) => l.wdir != null && l.wspd != null && l.z != null)
        .map((l) => ({ agl: l.z - snd.surfaceZ, dir: l.wdir, spd: l.wspd }))
        .filter((l) => l.agl >= -50 && l.agl <= 9000)
        .sort((a, b) => a.agl - b.agl);

    const maxSpd = Math.max(40, ...wl.map((l) => l.spd));
    const ring = maxSpd <= 40 ? 10 : maxSpd <= 80 ? 20 : 30;
    const sc = R / (Math.ceil(maxSpd / ring) * ring);

    // rings + labels
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.fillStyle = '#8398b0';
    ctx.font = '600 10px "Onest", system-ui, sans-serif'; ctx.textAlign = 'center';
    for (let s = ring; s <= Math.ceil(maxSpd / ring) * ring; s += ring) {
        ctx.beginPath(); ctx.arc(cx, cy, s * sc, 0, Math.PI * 2); ctx.stroke();
        ctx.fillText(String(s), cx, cy - s * sc - 1);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.restore();

    // u,v (met convention, dir = FROM) → screen
    const uv = (l) => {
        const rad = (l.dir * Math.PI) / 180;
        const u = -l.spd * Math.sin(rad);   // east +
        const v = -l.spd * Math.cos(rad);   // north +
        return [cx + u * sc, cy - v * sc];
    };

    // color by height band
    const band = (agl) => (agl <= 1000 ? '#ff4136' : agl <= 3000 ? '#ff9f1c' : agl <= 6000 ? '#ffe14d' : '#4fc3ff');
    for (let i = 1; i < wl.length; i++) {
        line(ctx, [uv(wl[i - 1]), uv(wl[i])], band(wl[i].agl), 2.4);
    }
    // surface dot
    if (wl.length) {
        const [sx, sy] = uv(wl[0]);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = '#9fb2c9'; ctx.font = '700 12px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('Hodograph (kt)', x, y - 6);
}

// ── indices panel ─────────────────────────────────────────────────────────────
function drawIndices(ctx, rect, snd) {
    const { x, y, w } = rect;
    const rows = [
        ['CAPE', snd.cape == null ? '—' : snd.cape + ' J/kg'],
        ['CIN', snd.cin == null ? '—' : snd.cin + ' J/kg'],
        ['0-3 km SRH', snd.helic == null ? '—' : snd.helic + ' m²/s²'],
        ['Precip. water', snd.pw == null ? '—' : (snd.pw / 10).toFixed(1) + ' mm'],
    ];
    ctx.save();
    ctx.fillStyle = '#9fb2c9'; ctx.font = '700 12px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('Indices', x, y - 6);
    let yy = y + 14;
    for (const [k, v] of rows) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, yy - 12, w, 26);
        ctx.fillStyle = '#9fb2c9'; ctx.font = '600 13px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(k, x + 10, yy + 2);
        ctx.fillStyle = '#eaf1fb'; ctx.font = '800 14px "Onest", system-ui, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(v, x + w - 10, yy + 2);
        yy += 30;
    }
    ctx.restore();
}

// Render everything to `canvas` (sized here for a crisp export).
function renderSounding(canvas, snd, meta) {
    const W = 980, H = 720;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, W, H);

    // title
    ctx.fillStyle = '#eaf1fb'; ctx.font = '800 18px "Onest", system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(meta.title || 'Forecast Sounding', 20, 28);
    if (meta.sub) { ctx.fillStyle = '#9fb2c9'; ctx.font = '600 13px "Onest", system-ui, sans-serif'; ctx.fillText(meta.sub, 20, 48); }

    const T = makeTransforms({ x: 60, y: 70, w: 500, h: 590 });
    drawSkewT(ctx, T, snd);

    drawHodograph(ctx, { x: 650, y: 96, w: 300, h: 300 }, snd);
    drawIndices(ctx, { x: 650, y: 450, w: 300 }, snd);
}

module.exports = { renderSounding };
