// Legend / scale layers. Two kinds match the reference graphics:
//  - categorical chips (e.g. 1.Low 2.Limited ... 5.Extreme; or RAIN/SNOW/...)
//  - gradient scale with numeric ticks (e.g. ICE ACCUMULATION inches)
import { roundRect } from './scene.js';

// items: [{ label, color, textColor? }]. Rendered as a contiguous chip strip.
export function categoricalLegendLayer(items, rect, opts = {}) {
  return {
    name: 'legend-categorical',
    draw(ctx) {
      const { x, y, w, h } = rect;
      const n = items.length;
      const cw = w / n;
      const fs = opts.fontSize || Math.round(h * 0.42);
      ctx.font = `800 ${fs}px "Segoe UI", Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (let i = 0; i < n; i++) {
        const cx = x + i * cw;
        ctx.fillStyle = items[i].color;
        ctx.fillRect(cx, y, cw + 0.5, h);
        ctx.fillStyle = items[i].textColor || pickText(items[i].color);
        ctx.fillText(items[i].label, cx + cw / 2, y + h / 2 + 1);
      }
      if (opts.border) {
        ctx.lineWidth = opts.border;
        ctx.strokeStyle = opts.borderColor || '#ffffff';
        ctx.strokeRect(x, y, w, h);
      }
      ctx.textAlign = 'left';
    },
  };
}

// stops: [{ value, color }] ascending. Draws a gradient bar with tick labels
// centered under each band boundary (broadcast inch/amount scale style).
export function gradientScaleLayer(stops, rect, opts = {}) {
  return {
    name: 'legend-gradient',
    draw(ctx) {
      const { x, y, w, h } = rect;
      const n = stops.length;
      const cw = w / n;
      // discrete color bands (broadcast scales are usually stepped)
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = stops[i].color;
        ctx.fillRect(x + i * cw, y, cw + 0.5, h);
      }
      ctx.strokeStyle = opts.borderColor || 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      // tick labels at band boundaries
      const fs = opts.fontSize || Math.round(h * 0.7);
      ctx.font = `800 ${fs}px "Segoe UI", Arial, sans-serif`;
      ctx.fillStyle = opts.textColor || '#ffffff';
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'center';
      for (let i = 0; i < n; i++) {
        ctx.fillText(String(stops[i].value), x + i * cw + cw / 2, y - 6);
      }
      if (opts.unit) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = `800 ${Math.round(fs * 0.9)}px "Segoe UI", Arial, sans-serif`;
        // unit chip centered above the bar
        const label = opts.unit.toUpperCase();
        const lw = ctx.measureText(label).width + 24;
        roundRect(ctx, x + w / 2 - lw / 2, y - fs - 30, lw, fs + 10, 4);
        ctx.fillStyle = '#000';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + w / 2, y - fs - 30 + (fs + 10) / 2 + 1);
      }
      ctx.textAlign = 'left';
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
