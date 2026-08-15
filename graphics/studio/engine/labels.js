// City label layer. Clean broadcast style: a small city marker dot beside the
// name in crisp condensed caps with a dark halo + soft shadow — no heavy box, so
// it reads on satellite, radar, or dark basemaps like premium TV graphics.
import { CITIES } from './cities.js';
import { FONT, capsWidth, withShadow } from './style.js';

// A city marker: white core, dark ring, small blue center (reads on any bg).
function cityDot(ctx, x, y, r, accent = '#1c74d6') {
  withShadow(ctx, () => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
  }, { blur: 5, y: 1 });
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(8,16,28,0.9)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, Math.max(1, r - 2.4), 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
}

// Left-aligned condensed caps with a rounded dark halo (outline) + soft shadow.
function haloCaps(ctx, text, x, y, fs) {
  const t = String(text).toUpperCase();
  ctx.save();
  ctx.font = `800 ${fs}px ${FONT}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.translate(x, y); ctx.scale(0.94, 1);
  ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 1;
  ctx.lineWidth = Math.max(3, fs * 0.34); ctx.strokeStyle = 'rgba(4,10,18,0.9)';
  ctx.strokeText(t, 0, 0);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff'; ctx.fillText(t, 0, 0);
  ctx.restore();
}

// Footprint (dot + gap + text) so collision tests match what's drawn.
function labelBox(ctx, text, fs, rank) {
  const dotR = rank === 1 ? 5 : 4;
  const tw = capsWidth(ctx, text, fs, 800, 0.94);
  return { dotR, tw, textGap: 9, h: fs + 8 };
}

export function cityLabelLayer({ maxRank = 3, fontSize = 18, bounds = null, gap = 8 } = {}) {
  return {
    name: 'cities',
    draw(ctx, scene) {
      const b = bounds || { x0: 0, y0: 0, x1: scene.width, y1: scene.height };
      const cands = [];
      for (const [name, lat, lon, rank] of CITIES) {
        if (rank > maxRank) continue;
        const p = scene.projection([lon, lat]);
        if (!p) continue;
        const [x, y] = p;
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
        cands.push({ name, x, y, rank });
      }
      // Place major cities first so smaller ones yield to them.
      cands.sort((a, c) => a.rank - c.rank);

      const placed = [];
      for (const c of cands) {
        const fs = c.rank === 1 ? fontSize + 2 : fontSize;
        const { dotR, tw, textGap, h } = labelBox(ctx, c.name, fs, c.rank);
        // The label runs from the dot (at c.x) rightward through the text.
        const rect = {
          x0: c.x - dotR - gap, y0: c.y - h / 2 - gap,
          x1: c.x + dotR + textGap + tw + gap, y1: c.y + h / 2 + gap,
        };
        if (placed.some((r) => !(rect.x1 < r.x0 || rect.x0 > r.x1 || rect.y1 < r.y0 || rect.y0 > r.y1))) continue;
        placed.push(rect);
        cityDot(ctx, c.x, c.y, dotR);
        haloCaps(ctx, c.name, c.x + dotR + textGap, c.y + 1, fs);
      }
    },
  };
}

// Arbitrary point labels (user-placed markers): accent dot + haloed name.
export function pointLabelLayer(points, opts = {}) {
  return {
    name: 'point-labels',
    draw(ctx, scene) {
      const fs = opts.fontSize || 22;
      for (const pt of points) {
        const p = scene.projection([pt.lon, pt.lat]);
        if (!p) continue;
        const [x, y] = p;
        cityDot(ctx, x, y, 6, opts.dotColor || '#ffd54a');
        haloCaps(ctx, pt.name, x + 14, y + 1, fs);
      }
    },
  };
}
