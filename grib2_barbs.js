/*
 * grib2_barbs.js
 * Wind barbs drawn as glyphs into the same transparent PNG overlay the shaded
 * fields use.
 *
 * A colour ramp can show wind SPEED but not direction, and direction is half
 * the information — a 40 kt southerly and a 40 kt northerly are the same pixel
 * on a shaded map and completely different forecasts. Barbs carry both, in the
 * notation every forecaster already reads.
 *
 * Convention (WMO): the staff points along the wind vector toward where the
 * wind is coming FROM, and the ticks sit on the staff's end:
 *   - a pennant (filled triangle) is 50 kt
 *   - a full barb is 10 kt
 *   - a half barb is 5 kt
 *   - calm (< 2.5 kt) is drawn as an open circle with no staff
 * Speed is rounded to the nearest 5 kt before decomposition, which is what the
 * notation can express.
 *
 * Drawing is deliberately plain: solid lines with a dark halo so the barbs read
 * over any basemap or shaded field beneath them. Everything is in output-image
 * pixels, so barb size does not change with zoom.
 */

const { PNG } = require('pngjs');
const { decodeGrib2Message } = require('./grib2_decode');
const { makeSampler } = require('./grib2_render');

const MS_TO_KT = 1.943844;

// Barb geometry, in pixels of the output image.
const STAFF = 26;          // length of the shaft
const TICK = 10;           // length of a full barb
const TICK_GAP = 5;        // spacing between ticks along the shaft
const TICK_LEAN = 0.6;     // how far the tick leans back along the staff

function plot(png, x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const i = ((y | 0) * png.width + (x | 0)) * 4;
    const d = png.data;
    if (a >= 255) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; return; }
    // Source-over: barbs overlap their own halo, and a plain write would punch
    // holes in the outline where the shaft crosses it.
    const sa = a / 255, da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    d[i] = Math.round((r * sa + d[i] * da * (1 - sa)) / oa);
    d[i + 1] = Math.round((g * sa + d[i + 1] * da * (1 - sa)) / oa);
    d[i + 2] = Math.round((b * sa + d[i + 2] * da * (1 - sa)) / oa);
    d[i + 3] = Math.round(oa * 255);
}

/*
 * Bresenham with a width, so a barb stays visible against busy shading.
 *
 * The endpoints are rounded to integers BEFORE the deltas are computed. Taking
 * dx/dy from the float endpoints while stepping in integers means the walk can
 * step past the target without ever landing on it, and the loop then runs to
 * its guard — which drew a streak clean across the image for the short,
 * fractional segments that make up the calm-wind circle.
 */
function line(png, fx0, fy0, fx1, fy1, col, width) {
    let x = Math.round(fx0), y = Math.round(fy0);
    const ex = Math.round(fx1), ey = Math.round(fy1);
    const dx = Math.abs(ex - x), dy = Math.abs(ey - y);
    const sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1;
    let err = dx - dy;
    const half = Math.max(0, Math.floor((width - 1) / 2));
    for (let guard = 0; guard < 4096; guard++) {
        for (let oy = -half; oy <= half; oy++) {
            for (let ox = -half; ox <= half; ox++) plot(png, x + ox, y + oy, col[0], col[1], col[2], col[3]);
        }
        if (x === ex && y === ey) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
    }
}

function circle(png, cx, cy, r, col, width) {
    const steps = Math.max(12, Math.round(2 * Math.PI * r));
    let px = cx + r, py = cy;
    for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * 2 * Math.PI;
        const nx = cx + r * Math.cos(t), ny = cy + r * Math.sin(t);
        line(png, px, py, nx, ny, col, width);
        px = nx; py = ny;
    }
}

function triangle(png, ax, ay, bx, by, cx, cy, col) {
    // Small solid pennant: scanline fill over the triangle's bounding box.
    const minX = Math.floor(Math.min(ax, bx, cx)), maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy)), maxY = Math.ceil(Math.max(ay, by, cy));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-6) return;
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const w0 = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / area;
            const w1 = ((cx - bx) * (y - by) - (x - bx) * (cy - by)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) plot(png, x, y, col[0], col[1], col[2], col[3]);
        }
    }
}

/**
 * Break a wind speed into the pennants / full / half barbs that represent it.
 * Rounded to 5 kt first, because the notation has no finer increment.
 */
function decompose(kt) {
    let rem = Math.round(kt / 5) * 5;
    const pennants = Math.floor(rem / 50); rem -= pennants * 50;
    const fulls = Math.floor(rem / 10); rem -= fulls * 10;
    const halves = rem >= 5 ? 1 : 0;
    return { pennants, fulls, halves };
}

/*
 * Draw one barb at (x, y) for a wind blowing toward (u, v) in m/s.
 *
 * Screen y grows downward while a northward wind component is positive, so the
 * v component is negated when converting to a screen direction — getting that
 * backwards mirrors every barb about the horizontal and is easy to miss on a
 * map with no reference.
 */
function drawBarb(png, x, y, u, v, col, halo) {
    const kt = Math.hypot(u, v) * MS_TO_KT;

    if (kt < 2.5) {
        circle(png, x, y, 3.5, halo, 3);
        circle(png, x, y, 3.5, col, 1);
        return;
    }

    // Unit vector pointing back along the wind, i.e. toward its source.
    const len = Math.hypot(u, v) || 1;
    const dx = -(u / len), dy = (v / len);        // +v is northward, screen y is down
    const tipX = x + dx * STAFF, tipY = y + dy * STAFF;
    // Perpendicular, for the ticks.
    const px = -dy, py = dx;

    const { pennants, fulls, halves } = decompose(kt);

    for (const pass of [0, 1]) {
        const c = pass === 0 ? halo : col;
        const w = pass === 0 ? 4 : 2;
        line(png, x, y, tipX, tipY, c, w);

        let along = 0;
        const at = (d) => [x + dx * (STAFF - d), y + dy * (STAFF - d)];

        for (let i = 0; i < pennants; i++) {
            const [bx, by] = at(along);
            const [ex, ey] = at(along + TICK_GAP * 1.4);
            if (pass === 1) {
                triangle(png, bx, by, ex, ey, bx + px * TICK, by + py * TICK, col);
            } else {
                line(png, bx, by, bx + px * TICK, by + py * TICK, c, w);
                line(png, ex, ey, bx + px * TICK, by + py * TICK, c, w);
            }
            along += TICK_GAP * 1.8;
        }
        // A pennant butts against the next tick without this gap.
        if (pennants && (fulls || halves)) along += TICK_GAP * 0.4;

        for (let i = 0; i < fulls; i++) {
            const [bx, by] = at(along);
            line(png, bx, by, bx + px * TICK - dx * TICK * TICK_LEAN, by + py * TICK - dy * TICK * TICK_LEAN, c, w);
            along += TICK_GAP;
        }
        if (halves) {
            // A lone half barb sits one slot in from the tip, so it cannot be
            // mistaken for a full barb drawn short.
            if (!pennants && !fulls) along += TICK_GAP;
            const [bx, by] = at(along);
            const h = TICK / 2;
            line(png, bx, by, bx + px * h - dx * h * TICK_LEAN, by + py * h - dy * h * TICK_LEAN, c, w);
        }
    }
}

/**
 * Render a barb field over bbox [W,S,E,N].
 *
 * Barbs are placed on a fixed grid in OUTPUT pixels rather than at every model
 * grid point: at continental scale a 3 km model would put millions of barbs on
 * the image and draw solid ink. `spacing` is that pixel pitch.
 */
function renderBarbs(uBytes, vBytes, bbox, maxW = 1400, spacing = 46, subU = 1, subV = 1) {
    const [W, S, E, N] = bbox;
    const OW = Math.min(maxW, 1600);
    const OH = Math.max(1, Math.round(OW * (N - S) / (E - W)));
    const png = new PNG({ width: OW, height: OH });
    png.data.fill(0);
    drawBarbsOnto(png, uBytes, vBytes, bbox, spacing, subU, subV);
    return { png: PNG.sync.write(png), width: OW, height: OH, kind: 'barb' };
}

/**
 * Draw barbs onto an EXISTING canvas.
 *
 * Separated from renderBarbs so a combination plot can lay barbs over a shaded
 * field in one image: two products a forecaster would otherwise have to flip
 * between, and the whole reason wind direction is worth plotting at all is to
 * read it against something else.
 *
 * The canvas dimensions define the geography — the caller has already sized it
 * from the same bbox — so nothing here needs to agree with the base renderer
 * beyond being handed the same rectangle.
 */
function drawBarbsOnto(png, uBytes, vBytes, bbox, spacing = 46, subU = 1, subV = 1) {
    const u = decodeGrib2Message(uBytes, subU);
    const v = decodeGrib2Message(vBytes, subV);
    const su = makeSampler(u.grid), sv = makeSampler(v.grid);

    const [W, S, E, N] = bbox;
    const OW = png.width, OH = png.height;

    const col = [245, 248, 252, 255];
    const halo = [10, 14, 20, 190];

    // Half a step of inset keeps barbs from being clipped at the edges.
    const start = Math.round(spacing / 2);
    for (let py = start; py < OH; py += spacing) {
        const lat = N - (py + 0.5) / OH * (N - S);
        for (let px = start; px < OW; px += spacing) {
            const lon = W + (px + 0.5) / OW * (E - W);
            const iu = su(lon, lat); if (iu < 0) continue;
            const iv = sv(lon, lat); if (iv < 0) continue;
            const a = u.values[iu], b = v.values[iv];
            if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
            drawBarb(png, px, py, a, b, col, halo);
        }
    }
    return png;
}

module.exports = { renderBarbs, drawBarbsOnto, decompose, drawBarb };
