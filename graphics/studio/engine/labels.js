// City label layer. Broadcast-style navy pills with condensed white caps, a
// light rim and a soft drop shadow — matching on-air city labels.
import { placeCities } from './cities.js';
import { COLORS, caps, capsWidth, withShadow, panelPath } from './style.js';

function drawPill(ctx, cx, cy, text, fs) {
  const tw = capsWidth(ctx, text, fs, 800, 0.94);
  const padX = 15;
  const pillH = fs + 14;
  const pillW = tw + padX * 2;
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

export function cityLabelLayer({ maxRank = 3, fontSize = 22, bounds = null } = {}) {
  return {
    name: 'cities',
    draw(ctx, scene) {
      const b = bounds || { x0: 0, y0: 0, x1: scene.width, y1: scene.height };
      const cities = placeCities(scene.projection, b, { maxRank });
      for (const c of cities) {
        drawPill(ctx, c.x, c.y, c.name, c.rank === 1 ? fontSize + 3 : fontSize);
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
