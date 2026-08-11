// "Chrome" = the broadcast UI furniture: header bars, title flags, lower-thirds,
// branding bug, and the boxed threat-icon legend. Restyled to read like on-air
// weather graphics: deep-navy header, crimson date bar, a white station-brand
// block, condensed bold caps, and soft depth shadows.
import { COLORS, withShadow, caps, capsWidth, panelPath, shade } from './style.js';

// Shared broadcast header: an angled gold accent cap, a dark gradient title bar
// with a bright cyan top sheen, a big condensed headline, an accent date/subtitle
// strip with a gold seam, and (optionally) a beveled station-brand flag. Every
// header variant below maps onto this, so all banners read TV-grade.
function renderHeader(ctx, { brand, title, subtitle, rect, accent }) {
  const { x, y, w, h } = rect;
  const acc = accent || COLORS.red;
  const subH = subtitle ? Math.max(26, Math.round(h * 0.34)) : 0;
  const barH = h - subH;
  const pad = Math.max(8, Math.round(barH * 0.16));

  // Depth shadow behind the whole header block.
  withShadow(ctx, () => { ctx.fillStyle = '#06101f'; ctx.fillRect(x, y, w, h); }, { blur: 22, y: 7 });

  // Title bar — horizontal dark-navy gradient.
  const hg = ctx.createLinearGradient(x, 0, x + w, 0);
  hg.addColorStop(0, '#103058'); hg.addColorStop(0.5, '#0b2244'); hg.addColorStop(1, '#08182e');
  ctx.fillStyle = hg; ctx.fillRect(x, y, w, barH);
  // top vertical sheen
  const sh = ctx.createLinearGradient(x, y, x, y + barH * 0.5);
  sh.addColorStop(0, 'rgba(255,255,255,0.14)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh; ctx.fillRect(x, y, w, barH * 0.5);
  // bright cyan top edge line
  const te = ctx.createLinearGradient(x, 0, x + w, 0);
  te.addColorStop(0, 'rgba(140,214,255,0)'); te.addColorStop(0.12, 'rgba(150,220,255,0.9)');
  te.addColorStop(0.7, 'rgba(90,150,210,0.25)'); te.addColorStop(1, 'rgba(90,150,210,0)');
  ctx.fillStyle = te; ctx.fillRect(x, y, w, 3);
  // bottom shadow line
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x, y + barH - 2, w, 2);

  // Accent date/subtitle strip with a gold seam on top.
  if (subH) {
    const g = ctx.createLinearGradient(x, y + barH, x, y + h);
    g.addColorStop(0, acc); g.addColorStop(1, shade(acc, 0.72));
    ctx.fillStyle = g; ctx.fillRect(x, y + barH, w, subH);
    const gs = ctx.createLinearGradient(x, 0, x + w, 0);
    gs.addColorStop(0, COLORS.goldLt); gs.addColorStop(0.5, COLORS.gold); gs.addColorStop(1, 'rgba(231,181,59,0.12)');
    ctx.fillStyle = gs; ctx.fillRect(x, y + barH, w, 2.5);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x, y + barH + 2.5, w, 2);
  }

  // Left angled gold accent cap.
  const capSkew = Math.round(barH * 0.42);
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + 15, y); ctx.lineTo(x + 15 - capSkew, y + barH); ctx.lineTo(x, y + barH); ctx.closePath();
  const cg = ctx.createLinearGradient(x, y, x, y + barH);
  cg.addColorStop(0, COLORS.goldLt); cg.addColorStop(1, shade(COLORS.gold, 0.6));
  ctx.fillStyle = cg; ctx.fill();

  let tx = x + pad + 16;

  // Beveled white station-brand flag (accent stripe on top, navy text).
  if (brand) {
    const bh = barH - pad * 2;
    const by = y + pad;
    const bpad = Math.round(bh * 0.22);
    const words = String(brand).toUpperCase().split(/\s+/);
    const stacked = words.length >= 2;
    const lineFs = stacked ? bh * 0.30 : bh * 0.40;
    let widest = 0;
    if (stacked) {
      const half = Math.ceil(words.length / 2);
      widest = Math.max(capsWidth(ctx, words.slice(0, half).join(' '), lineFs, 900, 0.92),
                        capsWidth(ctx, words.slice(half).join(' '), lineFs, 900, 0.92));
    } else {
      widest = capsWidth(ctx, brand, lineFs, 900, 0.92);
    }
    const bw = Math.max(bh * 1.5, widest + bpad * 2);
    const bx = x + pad + 16;
    withShadow(ctx, () => { ctx.fillStyle = COLORS.white; ctx.fillRect(bx, by, bw, bh); }, { blur: 10, y: 3 });
    ctx.fillStyle = acc; ctx.fillRect(bx, by, bw, Math.max(4, Math.round(bh * 0.13)));
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(bx, by, bw, 1.5);       // top bevel
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(bx, by + bh - 2, bw, 2);     // bottom bevel
    const cx = bx + bw / 2;
    if (stacked) {
      const half = Math.ceil(words.length / 2);
      caps(ctx, words.slice(0, half).join(' '), cx, by + bh * 0.50, { size: lineFs, color: COLORS.navyBot, align: 'center', shadow: false });
      caps(ctx, words.slice(half).join(' '), cx, by + bh * 0.78, { size: lineFs, color: COLORS.navyBot, align: 'center', shadow: false });
    } else {
      caps(ctx, brand, cx, by + bh * 0.60, { size: lineFs, color: COLORS.navyBot, align: 'center', shadow: false });
    }
    tx = bx + bw + pad;
  }

  // Headline (condensed heavy caps) + accent subtitle.
  caps(ctx, title, tx, y + barH / 2 + 1, { size: barH * 0.56, color: COLORS.white, scaleX: 0.9, maxWidth: x + w - tx - pad });
  if (subtitle && subH) {
    caps(ctx, subtitle, tx, y + barH + subH / 2 + 1, { size: subH * 0.56, color: COLORS.white, scaleX: 0.93, maxWidth: x + w - tx - pad });
  }
}

// Big top title bar (used by precip/ice templates).
export function titleBarLayer({ title, subtitle, rect }) {
  return { name: 'title-bar', draw(ctx) { renderHeader(ctx, { title, subtitle, rect }); } };
}

// Category flag + title (SEVERE WEATHER | SEVERE WEATHER OUTLOOK look). The flag
// becomes the white station-brand block.
export function flagHeaderLayer({ flag, title, subtitle, rect }) {
  return { name: 'flag-header', draw(ctx) { renderHeader(ctx, { brand: flag, title, subtitle, rect }); } };
}

// Title + region + date banner (SEVERE STORM THREAT header).
export function bannerHeaderLayer({ title, region, date, rect }) {
  const subtitle = [region, date].filter(Boolean).join('   •   ');
  return { name: 'banner-header', draw(ctx) { renderHeader(ctx, { title, subtitle, rect }); } };
}

// Boxed legend with icon rows (the "THREATS" panel): navy panel, white header
// with a crimson underline, white rows with colored icons.
export function threatBoxLayer({ title, items, rect }) {
  return {
    name: 'threat-box',
    draw(ctx) {
      const { x, y, w } = rect;
      const rowH = 58;
      const headH = 48;
      const h = headH + items.length * rowH + 20;
      withShadow(ctx, () => {
        panelPath(ctx, x, y, w, h, 12);
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#123d70');
        g.addColorStop(1, '#0a2140');
        ctx.fillStyle = g;
        ctx.fill();
      }, { blur: 20, y: 6 });
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1.5;
      panelPath(ctx, x, y, w, h, 12);
      ctx.stroke();
      // top sheen line
      ctx.save(); panelPath(ctx, x, y, w, h, 12); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y, w, 3); ctx.restore();
      // header + gold underline
      caps(ctx, title || 'Threats', x + 22, y + headH / 2 + 2, { size: 26, color: COLORS.white });
      const ug = ctx.createLinearGradient(x + 22, 0, x + 22 + Math.min(w - 44, 150), 0);
      ug.addColorStop(0, COLORS.goldLt); ug.addColorStop(1, shade(COLORS.gold, 0.6));
      ctx.fillStyle = ug;
      ctx.fillRect(x + 22, y + headH - 8, Math.min(w - 44, 150), 4);
      // rows
      let ry = y + headH + 12;
      for (const it of items) {
        drawThreatIcon(ctx, it.icon, x + 34, ry + rowH / 2 - 6, 18);
        caps(ctx, it.text, x + 66, ry + rowH / 2 - 4, { size: 23, weight: 800, color: COLORS.white, scaleX: 0.96, shadow: false });
        ry += rowH;
      }
    },
  };
}

function drawThreatIcon(ctx, kind, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = 2.5;
  switch (kind) {
    case 'hail':
      ctx.fillStyle = '#dfe9ff';
      for (const [dx, dy] of [[-6, -4], [6, -2], [0, 6]]) {
        ctx.beginPath(); ctx.arc(dx, dy, 5, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'wind':
      ctx.strokeStyle = '#e6d4a8'; ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(-r, i * 7); ctx.lineTo(r - 4, i * 7); ctx.stroke();
      }
      break;
    case 'tornado':
      ctx.fillStyle = '#d9463f';
      ctx.beginPath(); ctx.moveTo(-r, -r); ctx.lineTo(r, -r); ctx.lineTo(0, r); ctx.closePath(); ctx.fill();
      caps(ctx, 'V', 0, -3, { size: 17, color: '#fff', align: 'center', shadow: false });
      break;
    case 'lightning':
      ctx.fillStyle = '#ffcf33';
      ctx.beginPath();
      ctx.moveTo(2, -r); ctx.lineTo(-r * 0.7, 3); ctx.lineTo(-1, 3);
      ctx.lineTo(-3, r); ctx.lineTo(r * 0.7, -3); ctx.lineTo(0, -3);
      ctx.closePath(); ctx.fill();
      break;
    case 'flood':
      ctx.fillStyle = '#2b6fb0';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#bcd9f5';
      ctx.beginPath();
      ctx.moveTo(-r + 3, 2); ctx.quadraticCurveTo(-r / 3, -5, 0, 2);
      ctx.quadraticCurveTo(r / 3, 9, r - 3, 2); ctx.stroke();
      break;
    default:
      ctx.fillStyle = '#dfe9ff';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Branding bug (logo box) bottom-corner.
export function brandingLayer({ text, rect, color = COLORS.red }) {
  return {
    name: 'branding',
    draw(ctx) {
      const { x, y, w, h } = rect;
      withShadow(ctx, () => {
        panelPath(ctx, x, y, w, h, 10);
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#12294a');
        g.addColorStop(1, '#0a1526');
        ctx.fillStyle = g;
        ctx.fill();
      }, { blur: 16, y: 4 });
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1.25;
      panelPath(ctx, x, y, w, h, 10);
      ctx.stroke();
      // top sheen + gold accent bar (clipped to the rounded panel)
      ctx.save();
      panelPath(ctx, x, y, w, h, 10); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y, w, 3);
      const gg = ctx.createLinearGradient(x + 14, 0, x + w - 14, 0);
      gg.addColorStop(0, COLORS.goldLt); gg.addColorStop(1, shade(COLORS.gold, 0.6));
      ctx.fillStyle = gg; ctx.fillRect(x + 14, y + 12, w - 28, Math.max(4, h * 0.09));
      ctx.restore();
      const lines = String(text).split('\n');
      const startY = y + h * 0.42;
      const lh = h * 0.2;
      lines.forEach((ln, i) => caps(ctx, ln, x + w / 2, startY + i * lh, {
        size: h * 0.15, color: COLORS.white, align: 'center', scaleX: 0.94, shadow: false,
      }));
    },
  };
}
