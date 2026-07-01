// "Chrome" = the broadcast UI furniture: header bars, title flags, lower-thirds,
// branding bug, and the boxed threat-icon legend. These match the framing in
// the reference graphics.
import { roundRect, fitFont } from './scene.js';

// Big top title bar: white panel with a red/orange gradient cap stripe and a
// bold black title (the "DAY-TO-DAY PRECIP" / "ICE ACCUMULATION" look).
export function titleBarLayer({ title, subtitle, rect, accent = ['#ff3b3b', '#7a0d0d'] }) {
  return {
    name: 'title-bar',
    draw(ctx) {
      const { x, y, w, h } = rect;
      const cap = Math.max(8, h * 0.10);
      // cap stripe
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, accent[0]);
      g.addColorStop(1, accent[1]);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, cap);
      // white panel
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(x, y + cap, w, h - cap);
      // title
      ctx.fillStyle = '#101010';
      ctx.textBaseline = 'alphabetic';
      const tFont = fitFont(ctx, title, `900 ${Math.round(h * 0.5)}px "Segoe UI", Arial Black, sans-serif`, w - 60);
      ctx.font = tFont;
      ctx.fillText(title.toUpperCase(), x + 28, y + cap + (h - cap) * (subtitle ? 0.52 : 0.72));
      if (subtitle) {
        ctx.fillStyle = '#333';
        ctx.font = `600 ${Math.round(h * 0.18)}px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(subtitle.toUpperCase(), x + 30, y + cap + (h - cap) * 0.86);
      }
    },
  };
}

// Angled two-part header: a red "category flag" + a white/blue title slab,
// like the SEVERE WEATHER | SEVERE WEATHER OUTLOOK graphic.
export function flagHeaderLayer({ flag, title, subtitle, rect, flagColor = '#c20012' }) {
  return {
    name: 'flag-header',
    draw(ctx) {
      const { x, y, w, h } = rect;
      const skew = h * 0.55;
      // Measure flag text with the correct font BEFORE sizing the flag block.
      ctx.font = `900 ${Math.round(h * 0.38)}px "Segoe UI", Arial Black, sans-serif`;
      const flagW = Math.max(260, ctx.measureText(flag.toUpperCase()).width + 90);
      // flag (left, red, parallelogram)
      ctx.fillStyle = flagColor;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + flagW, y);
      ctx.lineTo(x + flagW - skew, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(flag.toUpperCase(), x + 24, y + h / 2 + 1);
      // title slab (white)
      const sx = x + flagW - skew + 8;
      ctx.fillStyle = '#f4f6fb';
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(sx - skew, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0d2a5e';
      ctx.font = `900 ${Math.round(h * 0.42)}px "Segoe UI", Arial Black, sans-serif`;
      ctx.fillText(title.toUpperCase(), sx + 26, y + h * (subtitle ? 0.40 : 0.5) + 1);
      if (subtitle) {
        ctx.fillStyle = '#33538a';
        ctx.font = `600 ${Math.round(h * 0.22)}px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(subtitle.toUpperCase(), sx + 28, y + h * 0.78);
      }
    },
  };
}

// Rounded title pill with a date sub-pill, like the SEVERE STORM THREAT header.
export function bannerHeaderLayer({ title, region, date, rect, accent = '#1c3f7a' }) {
  return {
    name: 'banner-header',
    draw(ctx) {
      const { x, y, w, h } = rect;
      roundRect(ctx, x, y, w, h, 10);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#16335f');
      g.addColorStop(1, '#0c1f3d');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#33508a';
      ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(h * 0.5)}px "Segoe UI", Arial Black, sans-serif`;
      ctx.fillText(title.toUpperCase(), x + 26, y + h / 2);
      if (region) {
        const tw = ctx.measureText(title.toUpperCase()).width;
        ctx.fillStyle = '#bcd2f5';
        ctx.font = `italic 700 ${Math.round(h * 0.42)}px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(region, x + 26 + tw + 22, y + h / 2);
      }
      if (date) {
        const dw = ctx.measureText(date).width + 40;
        roundRect(ctx, x + 12, y + h + 8, dw, h * 0.6, 8);
        ctx.fillStyle = '#0c1f3d';
        ctx.fill();
        ctx.strokeStyle = '#33508a';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `italic 700 ${Math.round(h * 0.34)}px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(date, x + 32, y + h + 8 + h * 0.3);
      }
    },
  };
}

// Boxed legend with icon rows (the "STORM THREATS" panel).
// items: [{ icon, text }]  icon in {hail, wind, tornado, flood, ice, snow}
export function threatBoxLayer({ title, items, rect }) {
  return {
    name: 'threat-box',
    draw(ctx) {
      const { x, y, w } = rect;
      const rowH = 46;
      const headH = 40;
      const h = headH + items.length * rowH + 16;
      // panel
      roundRect(ctx, x, y, w, h, 8);
      ctx.fillStyle = 'rgba(20,28,40,0.86)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // header
      roundRect(ctx, x, y, w, headH, 8);
      ctx.fillStyle = '#5a1d22';
      ctx.fill();
      ctx.fillStyle = '#ffd24a';
      ctx.font = `900 22px "Segoe UI", Arial Black, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText((title || 'STORM THREATS').toUpperCase(), x + 16, y + headH / 2 + 1);
      // rows
      let ry = y + headH + 10;
      for (const it of items) {
        drawThreatIcon(ctx, it.icon, x + 30, ry + rowH / 2 - 4, 16);
        ctx.fillStyle = '#ffd24a';
        ctx.font = `700 21px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(it.text, x + 56, ry + rowH / 2 - 3);
        ry += rowH;
      }
    },
  };
}

function drawThreatIcon(ctx, kind, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = 2;
  switch (kind) {
    case 'hail':
      ctx.fillStyle = '#dfe9ff';
      for (const [dx, dy] of [[-6, -4], [6, -2], [0, 6]]) {
        ctx.beginPath();
        ctx.arc(dx, dy, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'wind':
      ctx.strokeStyle = '#cdb98f';
      ctx.fillStyle = '#cdb98f';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-r, i * 6);
        ctx.lineTo(r - 4, i * 6);
        ctx.stroke();
      }
      break;
    case 'tornado':
      ctx.fillStyle = '#b03a3a';
      ctx.beginPath();
      ctx.moveTo(-r, -r);
      ctx.lineTo(r, -r);
      ctx.lineTo(0, r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '900 16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('V', 0, -3);
      ctx.textAlign = 'left';
      break;
    case 'flood':
      ctx.fillStyle = '#2b6fb0';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#bcd9f5';
      ctx.beginPath();
      ctx.moveTo(-r + 3, 2);
      ctx.quadraticCurveTo(-r / 3, -5, 0, 2);
      ctx.quadraticCurveTo(r / 3, 9, r - 3, 2);
      ctx.stroke();
      break;
    default:
      ctx.fillStyle = '#dfe9ff';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
  }
  ctx.restore();
}

// Branding bug (logo box) bottom-corner, like "OKLAHOMA WEATHER NETWORK".
export function brandingLayer({ text, rect, color = '#c20012' }) {
  return {
    name: 'branding',
    draw(ctx) {
      const { x, y, w, h } = rect;
      roundRect(ctx, x, y, w, h, 8);
      ctx.fillStyle = 'rgba(10,14,22,0.85)';
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(x + 10, y + 8, w - 20, h * 0.4);
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(h * 0.16)}px "Segoe UI", Arial Black, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const lines = String(text).split('\n');
      lines.forEach((ln, i) => ctx.fillText(ln.toUpperCase(), x + w / 2, y + h * 0.62 + i * h * 0.18));
      ctx.textAlign = 'left';
    },
  };
}
