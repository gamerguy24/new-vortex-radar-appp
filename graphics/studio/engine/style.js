// Shared broadcast design system for the studio's chrome, labels and legends.
// Tuned to read like on-air weather graphics: deep-navy furniture, a crimson
// accent bar, condensed bold caps, and soft depth shadows.

export const COLORS = {
  navyTop: '#123d70',
  navyBot: '#0a2444',
  navyPill: '#0c2340',
  red: '#c8102e',
  redDark: '#9d0c24',
  white: '#ffffff',
  sub: '#cfe0f5',
  border: 'rgba(150,185,235,0.55)',
  pillBorder: 'rgba(150,185,235,0.6)',
};

// A strong, widely-available sans. Weight + caps + slight condense give the
// broadcast feel without shipping a custom font (keeps exports untainted).
export const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

export function font(size, weight = 900) {
  return `${weight} ${Math.round(size)}px ${FONT}`;
}

// Vertical navy panel gradient used across the header furniture.
export function navyGradient(ctx, x, y, h) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, COLORS.navyTop);
  g.addColorStop(1, COLORS.navyBot);
  return g;
}

// Run `fn` with a drop shadow applied, then restore.
export function withShadow(ctx, fn, opts = {}) {
  ctx.save();
  ctx.shadowColor = opts.color || 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = opts.blur == null ? 10 : opts.blur;
  ctx.shadowOffsetX = opts.x || 0;
  ctx.shadowOffsetY = opts.y == null ? 4 : opts.y;
  fn();
  ctx.restore();
}

// Draw bold uppercase text, slightly condensed horizontally for the on-air look.
// Returns the drawn width (in scaled/screen units) for simple layout chaining.
export function caps(ctx, text, x, y, {
  size, weight = 900, color = COLORS.white, scaleX = 0.92,
  align = 'left', baseline = 'middle', shadow = true, maxWidth = null,
} = {}) {
  const t = String(text).toUpperCase();
  ctx.save();
  let fsize = size;
  ctx.font = font(fsize, weight);
  if (maxWidth) {
    // shrink to fit within maxWidth (accounting for the horizontal squeeze)
    while (fsize > 8 && ctx.measureText(t).width * scaleX > maxWidth) {
      fsize -= 1; ctx.font = font(fsize, weight);
    }
  }
  const w = ctx.measureText(t).width * scaleX;
  const ox = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2; }
  ctx.translate(x + ox, y);
  ctx.scale(scaleX, 1);
  ctx.fillText(t, 0, 0);
  ctx.restore();
  return w;
}

// Measure the width `caps` would draw (no rendering).
export function capsWidth(ctx, text, size, weight = 900, scaleX = 0.92) {
  ctx.save();
  ctx.font = font(size, weight);
  const w = ctx.measureText(String(text).toUpperCase()).width * scaleX;
  ctx.restore();
  return w;
}

// Rounded rectangle path with independent corner radii.
export function panelPath(ctx, x, y, w, h, r) {
  const rad = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : { tl: 0, tr: 0, br: 0, bl: 0, ...r };
  ctx.beginPath();
  ctx.moveTo(x + rad.tl, y);
  ctx.lineTo(x + w - rad.tr, y);
  ctx.arcTo(x + w, y, x + w, y + rad.tr, rad.tr);
  ctx.lineTo(x + w, y + h - rad.br);
  ctx.arcTo(x + w, y + h, x + w - rad.br, y + h, rad.br);
  ctx.lineTo(x + rad.bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad.bl, rad.bl);
  ctx.lineTo(x, y + rad.tl);
  ctx.arcTo(x, y, x + rad.tl, y, rad.tl);
  ctx.closePath();
}
