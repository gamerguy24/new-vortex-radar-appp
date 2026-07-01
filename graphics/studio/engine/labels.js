// City label layer. Draws the rounded "pill" labels with a dot marker, like
// broadcast maps. Uses the bundled city DB and simple collision avoidance.
import { placeCities } from './cities.js';
import { roundRect } from './scene.js';

export function cityLabelLayer({ maxRank = 3, fontSize = 22, bounds = null } = {}) {
  return {
    name: 'cities',
    draw(ctx, scene) {
      const b = bounds || { x0: 0, y0: 0, x1: scene.width, y1: scene.height };
      const cities = placeCities(scene.projection, b, { maxRank });
      ctx.textBaseline = 'middle';
      for (const c of cities) {
        const fs = c.rank === 1 ? fontSize + 2 : fontSize;
        ctx.font = `700 ${fs}px "Segoe UI", Arial, sans-serif`;
        const tw = ctx.measureText(c.name).width;
        const padX = 12;
        const pillH = fs + 12;
        const dotR = 5;
        const pillX = c.x + dotR + 6;
        const pillY = c.y - pillH / 2;
        const pillW = tw + padX * 2;
        // marker dot
        ctx.beginPath();
        ctx.arc(c.x, c.y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.stroke();
        // pill background
        roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
        ctx.fillStyle = 'rgba(15,18,24,0.82)';
        ctx.fill();
        // text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(c.name, pillX + padX, c.y + 1);
      }
    },
  };
}

// Draw arbitrary point labels (e.g. user-placed markers).
export function pointLabelLayer(points, opts = {}) {
  return {
    name: 'point-labels',
    draw(ctx, scene) {
      const fs = opts.fontSize || 22;
      ctx.textBaseline = 'middle';
      for (const pt of points) {
        const p = scene.projection([pt.lon, pt.lat]);
        if (!p) continue;
        const [x, y] = p;
        ctx.font = `700 ${fs}px "Segoe UI", Arial, sans-serif`;
        const tw = ctx.measureText(pt.name).width;
        roundRect(ctx, x + 10, y - (fs + 10) / 2, tw + 22, fs + 10, (fs + 10) / 2);
        ctx.fillStyle = 'rgba(15,18,24,0.82)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd54a';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(pt.name, x + 21, y + 1);
      }
    },
  };
}
