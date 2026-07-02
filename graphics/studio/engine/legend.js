// Legend / scale layers, broadcast-styled: rounded navy container, crisp color
// segments, condensed bold caps, soft shadow and a bright rim.
//  - categorical chips (1..5 threat scale; RAIN/SNOW/…)
//  - gradient scale with numeric ticks or LIGHT/HEAVY/EXTREME anchors
import { COLORS, caps, capsWidth, withShadow, panelPath } from './style.js';

// items: [{ label, color, textColor? }]. Rendered as a contiguous chip strip.
export function categoricalLegendLayer(items, rect, opts = {}) {
  return {
    name: 'legend-categorical',
    draw(ctx) {
      const { x, y, w, h } = rect;
      const n = items.length;
      const cw = w / n;
      const r = opts.radius == null ? 8 : opts.radius;

      withShadow(ctx, () => { panelPath(ctx, x, y, w, h, r); ctx.fillStyle = COLORS.navyBot; ctx.fill(); }, { blur: 14, y: 4 });

      ctx.save();
      panelPath(ctx, x, y, w, h, r);
      ctx.clip();
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = items[i].color;
        ctx.fillRect(x + i * cw, y, cw + 0.5, h);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      for (let i = 1; i < n; i++) {
        ctx.beginPath(); ctx.moveTo(x + i * cw, y + 2); ctx.lineTo(x + i * cw, y + h - 2); ctx.stroke();
      }
      ctx.restore();

      const fs = opts.fontSize || Math.round(h * 0.44);
      for (let i = 0; i < n; i++) {
        caps(ctx, items[i].label, x + i * cw + cw / 2, y + h / 2 + 1, {
          size: fs, weight: 800, color: items[i].textColor || pickText(items[i].color),
          align: 'center', scaleX: 0.96, shadow: false,
        });
      }

      ctx.strokeStyle = opts.borderColor || 'rgba(255,255,255,0.85)';
      ctx.lineWidth = opts.border || 1.5;
      panelPath(ctx, x, y, w, h, r);
      ctx.stroke();
    },
  };
}

// stops: [{ value, color }] ascending. Discrete bands with tick labels, or
// LIGHT/HEAVY/EXTREME anchors when opts.anchors is provided.
export function gradientScaleLayer(stops, rect, opts = {}) {
  return {
    name: 'legend-gradient',
    draw(ctx) {
      const { x, y, w, h } = rect;
      const n = stops.length;
      const cw = w / n;
      const r = opts.radius == null ? 8 : opts.radius;

      withShadow(ctx, () => { panelPath(ctx, x, y, w, h, r); ctx.fillStyle = COLORS.navyBot; ctx.fill(); }, { blur: 14, y: 4 });

      ctx.save();
      panelPath(ctx, x, y, w, h, r);
      ctx.clip();
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = stops[i].color;
        ctx.fillRect(x + i * cw, y, cw + 0.5, h);
      }
      ctx.restore();

      ctx.strokeStyle = opts.borderColor || 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      panelPath(ctx, x, y, w, h, r);
      ctx.stroke();

      if (opts.anchors && opts.anchors.length) {
        const a = opts.anchors;
        const fs = opts.anchorSize || Math.round(h * 0.62);
        a.forEach((lbl, i) => {
          const t = a.length === 1 ? 0.5 : i / (a.length - 1);
          caps(ctx, lbl, x + t * w, y + h + fs * 0.9, {
            size: fs, weight: 800, color: COLORS.white, scaleX: 0.94,
            align: i === 0 ? 'left' : i === a.length - 1 ? 'right' : 'center',
          });
        });
      } else {
        const fs = opts.fontSize || Math.round(h * 0.7);
        for (let i = 0; i < n; i++) {
          caps(ctx, String(stops[i].value), x + i * cw + cw / 2, y - fs * 0.5, {
            size: fs, weight: 800, color: COLORS.white, align: 'center',
          });
        }
      }

      if (opts.unit) {
        const fs = Math.round((opts.fontSize || Math.round(h * 0.7)) * 0.9);
        const label = String(opts.unit).toUpperCase();
        const lw = capsWidth(ctx, label, fs, 800, 0.94) + 24;
        const bx = x + w / 2 - lw / 2;
        const by = y - h - 18;
        withShadow(ctx, () => { panelPath(ctx, bx, by, lw, fs + 12, 5); ctx.fillStyle = COLORS.red; ctx.fill(); }, { blur: 8, y: 3 });
        caps(ctx, label, x + w / 2, by + (fs + 12) / 2 + 1, { size: fs, color: COLORS.white, align: 'center', scaleX: 0.94, shadow: false });
      }
    },
  };
}

// Choose black/white text for contrast against a fill color.
export function pickText(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) return '#000';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#0a0a0a' : '#ffffff';
}
