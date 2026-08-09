// City label layer. Broadcast-style navy pills with condensed white caps, a
// light rim and a soft drop shadow — matching on-air city labels.
import { CITIES } from './cities.js';
import { COLORS, caps, capsWidth, withShadow, panelPath } from './style.js';

// Actual pill footprint for a label at font size `fs` (keeps collision tests and
// drawing in sync).
function pillSize(ctx, text, fs) {
  const tw = capsWidth(ctx, text, fs, 800, 0.94);
  return { w: tw + 22, h: fs + 11 };
}

function drawPill(ctx, cx, cy, text, fs) {
  const { w: pillW, h: pillH } = pillSize(ctx, text, fs);
  const px = cx - pillW / 2;
  const py = cy - pillH / 2;
  withShadow(ctx, () => {
    panelPath(ctx, px, py, pillW, pillH, pillH / 2);
    const g = ctx.createLinearGradient(px, py, px, py + pillH);
    g.addColorStop(0, '#14406e');
    g.addColorStop(1, COLORS.navyPill);
    ctx.fillStyle = g;
    ctx.fill();
  }, { blur: 8, y: 3 });
  ctx.strokeStyle = COLORS.pillBorder;
  ctx.lineWidth = 1.5;
  panelPath(ctx, px, py, pillW, pillH, pillH / 2);
  ctx.stroke();
  caps(ctx, text, cx, cy + 1, { size: fs, weight: 800, color: COLORS.white, align: 'center', scaleX: 0.94, shadow: false });
}

export function cityLabelLayer({ maxRank = 3, fontSize = 18, bounds = null, gap = 8 } = {}) {
  return {
    name: 'cities',
    draw(ctx, scene) {
      const b = bounds || { x0: 0, y0: 0, x1: scene.width, y1: scene.height };
      // Candidate cities: projected, in-bounds, within the rank limit.
      const cands = [];
      for (const [name, lat, lon, rank] of CITIES) {
        if (rank > maxRank) continue;
        const p = scene.projection([lon, lat]);
        if (!p) continue;
        const [x, y] = p;
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
        cands.push({ name, x, y, rank });
      }
      // Place bigger/major cities first so smaller ones yield to them.
      cands.sort((a, c) => a.rank - c.rank);

      // Real, measured collision: skip any pill that would touch a placed one
      // (expanded by `gap`), so labels never overlap.
      const placed = [];
      for (const c of cands) {
        const fs = c.rank === 1 ? fontSize + 2 : fontSize;
        const { w, h } = pillSize(ctx, c.name, fs);
        const rect = {
          x0: c.x - w / 2 - gap, y0: c.y - h / 2 - gap,
          x1: c.x + w / 2 + gap, y1: c.y + h / 2 + gap,
        };
        if (placed.some((r) => !(rect.x1 < r.x0 || rect.x0 > r.x1 || rect.y1 < r.y0 || rect.y0 > r.y1))) continue;
        placed.push(rect);
        drawPill(ctx, c.x, c.y, c.name, fs);
      }
    },
  };
}

// Draw arbitrary point labels (e.g. user-placed markers) with an accent dot.
export function pointLabelLayer(points, opts = {}) {
  return {
    name: 'point-labels',
    draw(ctx, scene) {
      const fs = opts.fontSize || 22;
      for (const pt of points) {
        const p = scene.projection([pt.lon, pt.lat]);
        if (!p) continue;
        const [x, y] = p;
        withShadow(ctx, () => {
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fillStyle = opts.dotColor || '#ffd54a';
          ctx.fill();
        }, { blur: 6, y: 2 });
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.stroke();
        const half = capsWidth(ctx, pt.name, fs, 800, 0.94) / 2;
        drawPill(ctx, x + 25 + half, y, pt.name, fs);
      }
    },
  };
}
