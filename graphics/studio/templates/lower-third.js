// Template: Lower-Thirds / Title Banners — broadcast name strips and title
// slabs (no map). "Futurecast (broadcast)" reproduces a TV-grade banner: an
// angled logo block with a state silhouette + metallic gold wordmark, a gradient
// title bar with a condensed heavy headline, a colored date subtitle, a right
// model tag, and a labeled gust/severity color scale. Transparent background so
// it keys cleanly in OBS.
import { roundRect } from '../engine/scene.js';
import { flagHeaderLayer, titleBarLayer } from '../engine/chrome.js';
import { fitProjection } from '../engine/projection.js';
import { STATE_NAMES } from '../engine/geo.js';

export default {
  id: 'lower-third',
  label: 'Lower-Third / Title Banner',
  scale: null,

  defaultConfig() {
    return {
      style: 'futurecast',
      logoImg: '/logo.png',          // the app's Vortex Radar logo (transparent PNG)
      logoState: 'LA',
      logoLine1: 'SW LOUISIANA',
      logoLine2: 'WEATHER',
      title: 'FUTURECAST WIND GUSTS',
      subtitle: 'Sun Jul 19 1:00 PM',
      rightTag: '(HRRR MODEL)',
      accent: '#e7b53b',
      showScale: true,
      title2: 'FORT WAYNE',
      subtitle2: 'Severe Thunderstorm Warning',
      transparent: true,
    };
  },

  fields() {
    const states = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]))
      .map(([abbr, name]) => ({ value: abbr, label: name }));
    return [
      { key: 'style', label: 'Style', type: 'select', options: [
        { value: 'futurecast', label: 'Futurecast (broadcast)' },
        { value: 'angled-blue', label: 'Angled blue/white' },
        { value: 'flag', label: 'Red flag + title' },
        { value: 'title-bar', label: 'Top title bar' },
        { value: 'name-strip', label: 'Name strip' },
      ] },
      { key: 'logoImg', label: 'Banner logo image (PNG — black auto-removed)', type: 'image' },
      { key: 'logoState', label: 'Logo state silhouette', type: 'select', options: states },
      { key: 'logoLine1', label: 'Logo line 1 (used if no image)', type: 'text' },
      { key: 'logoLine2', label: 'Logo line 2 (gold)', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'subtitle', label: 'Date / subtitle', type: 'text' },
      { key: 'rightTag', label: 'Right tag', type: 'text' },
      { key: 'accent', label: 'Accent color', type: 'color' },
      { key: 'showScale', label: 'Show gust scale', type: 'toggle' },
      { key: 'transparent', label: 'Transparent background', type: 'toggle' },
    ];
  },

  build(scene, geo, config, ctrl) {
    scene.clearLayers();
    if (!config.transparent) {
      scene.add({ name: 'bg', draw(ctx, s) {
        const g = ctx.createLinearGradient(0, 0, 0, s.height);
        g.addColorStop(0, '#0b1622'); g.addColorStop(1, '#04121f');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s.width, s.height);
      } });
    }

    switch (config.style) {
      case 'flag':
        scene.add(flagHeaderLayer({ flag: 'Alert', title: config.title2 || config.title, subtitle: config.subtitle2 || config.subtitle, rect: { x: 80, y: 760, w: 1760, h: 140 }, flagColor: '#c20012' }));
        break;
      case 'title-bar':
        scene.add(titleBarLayer({ title: config.title, subtitle: config.subtitle, rect: { x: 80, y: 80, w: 1760, h: 180 } }));
        break;
      case 'name-strip':
        scene.add(nameStrip(config));
        break;
      case 'angled-blue':
        scene.add(angledBlue(config));
        break;
      case 'futurecast':
      default:
        scene.add(futurecast(config, geo, ctrl));
        break;
    }
  },
};

// ── text helpers ───────────────────────────────────────────────────────────────
// Heavy condensed text (broadcast look): horizontally compress any font.
function heavy(ctx, text, x, y, size, o = {}) {
  const { color = '#fff', align = 'left', condense = 0.9, weight = 900,
    family = "'Arial Narrow','Roboto Condensed','Segoe UI',Arial,sans-serif",
    shadow = true, italic = false } = o;
  ctx.save();
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.translate(x, y); ctx.scale(condense, 1);
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; }
  ctx.fillStyle = color; ctx.fillText(text, 0, 0);
  ctx.restore();
}
// measured on-screen width of condensed text
function heavyWidth(ctx, text, size, condense, weight = 900, family = "'Arial Narrow','Roboto Condensed','Segoe UI',Arial,sans-serif") {
  ctx.save(); ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width * condense; ctx.restore(); return w;
}
// shrink `size` until the condensed text fits maxW
function fitSize(ctx, text, size, condense, maxW) {
  let s = size; while (s > 14 && heavyWidth(ctx, text, s, condense) > maxW) s -= 2; return s;
}

// Metallic gold wordmark with bevel (dark drop, gold gradient, top sheen).
function goldText(ctx, text, x, y, size, condense) {
  const w = heavyWidth(ctx, text, size, condense);
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.translate(x, y); ctx.scale(condense, 1);
  ctx.font = `italic 900 ${size}px 'Arial Narrow','Roboto Condensed','Segoe UI',Arial,sans-serif`;
  // dark emboss
  ctx.fillStyle = 'rgba(40,26,4,0.9)'; ctx.fillText(text, 3, 3);
  // gold gradient body
  const g = ctx.createLinearGradient(0, -size, 0, 4);
  g.addColorStop(0, '#8a6412'); g.addColorStop(0.35, '#f6d778');
  g.addColorStop(0.52, '#fff6cf'); g.addColorStop(0.68, '#e6b53b'); g.addColorStop(1, '#7c5410');
  ctx.fillStyle = g; ctx.fillText(text, 0, 0);
  // top sheen
  ctx.save(); ctx.beginPath(); ctx.rect(-4, -size, (w / condense) + 8, size * 0.42); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillText(text, 0, 0); ctx.restore();
  ctx.restore();
  return w;
}

// ── state silhouette ──────────────────────────────────────────────────────────
function drawState(ctx, geo, abbr, rect, fill, stroke) {
  const f = geo && geo.stateByAbbr && geo.stateByAbbr.get(abbr);
  if (!f) return;
  const proj = fitProjection('mercator', [f], { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h }, { pad: 6 });
  const path = d3.geoPath(proj, ctx);
  ctx.save();
  ctx.beginPath(); path(f); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke(); }
  ctx.restore();
}

// parallelogram helper
function skewRect(ctx, x, y, w, h, skew) {
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - skew, y + h); ctx.lineTo(x, y + h); ctx.closePath();
}

// gust / severity color scale
const GUST_STOPS = [
  [0.0, '#1e40af'], [0.13, '#2e9bd6'], [0.28, '#34c46a'], [0.44, '#e6e23a'],
  [0.58, '#f39c1f'], [0.72, '#e0392b'], [0.85, '#b1279a'], [0.93, '#7a2fb0'], [1.0, '#ffffff'],
];
function drawScale(ctx, x, y, w, h, accent) {
  // LIGHT label
  ctx.textBaseline = 'middle';
  heavy(ctx, 'LIGHT', x, y + h / 2 + 1, h * 0.82, { align: 'right', condense: 0.92, weight: 800, color: '#dfe8f5', shadow: true });
  const barX = x + 14, barW = w - 14 - 96;
  const g = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  for (const [t, c] of GUST_STOPS) g.addColorStop(t, c);
  roundRect(ctx, barX, y, barW, h, 5); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; roundRect(ctx, barX, y, barW, h, 5); ctx.stroke();
  // EXTREME label
  heavy(ctx, 'EXTREME', barX + barW + 10, y + h / 2 + 1, h * 0.82, { align: 'left', condense: 0.92, weight: 800, color: '#dfe8f5', shadow: true });
  // threshold labels on the bar — smaller so they sit inside the bar
  const marks = [['20MPH', 0.2], ['50MPH', 0.55], ['75MPH+', 0.8]];
  ctx.textBaseline = 'middle';
  for (const [lab, t] of marks) {
    heavy(ctx, lab, barX + barW * t, y + h / 2 + 1 + h * 0.16, h * 0.56, { align: 'center', condense: 0.85, weight: 800, color: '#fff', shadow: true });
  }
}

// ── logo image processing, cached by src ────────────────────────────────────────
const _logoCache = {}; // src -> canvas | 'loading' | null

// Crop away fully-transparent margins so the art fills the panel.
function trimTransparent(c) {
  const w = c.width, h = c.height;
  const p = c.getContext('2d').getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (p[(y * w + x) * 4 + 3] > 16) { found = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (!found) return c;
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = document.createElement('canvas'); out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

// Smart prep: keep already-transparent logos as-is (black is part of the art);
// only knock out a solid BLACK background when the corners are opaque black.
function processLogo(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h), p = d.data;
  const idx = (x, y) => (y * w + x) * 4;
  const corners = [idx(0, 0), idx(w - 1, 0), idx(0, h - 1), idx(w - 1, h - 1)];
  let transp = 0, black = 0;
  for (const ci of corners) {
    if (p[ci + 3] < 12) transp++;
    else if (Math.max(p[ci], p[ci + 1], p[ci + 2]) < 24) black++;
  }
  if (transp < 2 && black >= 3) {          // solid black background → knock it out
    for (let i = 0; i < p.length; i += 4) {
      const mx = Math.max(p[i], p[i + 1], p[i + 2]);
      if (mx < 18) p[i + 3] = 0;
      else if (mx < 52) p[i + 3] = Math.round(p[i + 3] * (mx - 18) / 34);
    }
    g.putImageData(d, 0, 0);
  }
  return trimTransparent(c);
}

// Returns the processed logo canvas, or null (kicking off async load + rerender).
function getLogo(src, ctrl) {
  if (!src) return null;
  const hit = _logoCache[src];
  if (hit === 'loading') return null;
  if (hit !== undefined) return hit;      // canvas or null
  _logoCache[src] = 'loading';
  const img = new Image();
  img.crossOrigin = 'anonymous';          // same-origin logo → export stays clean
  img.onload = () => { try { _logoCache[src] = processLogo(img); } catch (e) { _logoCache[src] = null; } if (ctrl && ctrl.rerender) ctrl.rerender(); };
  img.onerror = () => { _logoCache[src] = null; };
  img.src = src;
  return null;
}

// ── the broadcast banner ───────────────────────────────────────────────────────
function futurecast(config, geo, ctrl) {
  return {
    name: 'lt-futurecast',
    draw(ctx, s) {
      const W = s.width, H = s.height;
      const barH = Math.round(H * 0.14);
      // Top-positioned banner. The logo panel overhangs the bar by ~18%, so offset
      // barY down by that much to keep the overhang on-screen below a small margin.
      const barY = Math.round(H * 0.04) + Math.round(barH * 0.18);
      const accent = config.accent || '#e7b53b';
      // default to the app's Vortex Radar logo; explicit '' means "use text wordmark"
      const logoSrc = config.logoImg == null ? '/logo.png' : config.logoImg;
      const logo = getLogo(logoSrc, ctrl);

      // ---- main title bar: dark gradient fading to the right ----
      const bg = ctx.createLinearGradient(0, 0, W, 0);
      bg.addColorStop(0, 'rgba(6,10,18,0.96)'); bg.addColorStop(0.55, 'rgba(9,14,25,0.9)'); bg.addColorStop(1, 'rgba(10,16,28,0.72)');
      ctx.fillStyle = bg; ctx.fillRect(0, barY, W, barH);
      // top sheen + bottom shadow lines
      const top = ctx.createLinearGradient(0, 0, W, 0);
      top.addColorStop(0, 'rgba(120,200,255,0.0)'); top.addColorStop(0.15, 'rgba(150,215,255,0.85)'); top.addColorStop(0.7, 'rgba(90,150,210,0.3)'); top.addColorStop(1, 'rgba(90,150,210,0)');
      ctx.fillStyle = top; ctx.fillRect(0, barY - 3, W, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, barY + barH, W, 3);

      // ---- logo block (angled, overhangs the bar) ----
      const lbX = 22, lbTop = barY - Math.round(barH * 0.18), lbH = barH + Math.round(barH * 0.18);
      const lbW = Math.round(W * 0.185), skew = Math.round(lbH * 0.42);
      // panel — bright blue for the text wordmark; dark (blends into the bar) for a logo image
      const pg = ctx.createLinearGradient(lbX, lbTop, lbX, lbTop + lbH);
      if (logo) { pg.addColorStop(0, '#0e2542'); pg.addColorStop(0.5, '#0a1a30'); pg.addColorStop(1, '#060f1f'); }
      else { pg.addColorStop(0, '#12305c'); pg.addColorStop(0.5, '#0c1f3d'); pg.addColorStop(1, '#060f1f'); }
      skewRect(ctx, lbX, lbTop, lbW, lbH, skew); ctx.save(); ctx.fillStyle = pg; ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4; ctx.fill(); ctx.restore();
      // state silhouette inside the panel (only when there's no logo image)
      if (!logo) {
        ctx.save(); skewRect(ctx, lbX, lbTop, lbW, lbH, skew); ctx.clip();
        drawState(ctx, geo, config.logoState, { x: lbX + 6, y: lbTop + 4, w: lbW - 12, h: lbH - 8 }, 'rgba(120,180,255,0.16)', 'rgba(150,200,255,0.35)');
        ctx.restore();
      }
      // top bevel highlight on the panel
      ctx.save(); skewRect(ctx, lbX, lbTop, lbW, lbH, skew); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(lbX, lbTop, lbW, 3); ctx.restore();
      // bright angled seam on the right edge (accent)
      ctx.save();
      ctx.beginPath(); ctx.moveTo(lbX + lbW, lbTop); ctx.lineTo(lbX + lbW + 7, lbTop);
      ctx.lineTo(lbX + lbW + 7 - skew, lbTop + lbH); ctx.lineTo(lbX + lbW - skew, lbTop + lbH); ctx.closePath();
      const sg = ctx.createLinearGradient(0, lbTop, 0, lbTop + lbH); sg.addColorStop(0, '#ffe9a8'); sg.addColorStop(1, shade(accent, 0.6));
      ctx.fillStyle = sg; ctx.fill(); ctx.restore();

      if (logo) {
        // Fit inside the STRAIGHT part of the slanted panel (left of the gold seam),
        // with padding + a little breathing room, and center it in that box.
        const padX = 24, padY = 20;
        const boxX = lbX + padX;
        const boxRight = lbX + lbW - skew - 12;        // clear the angled gold seam
        const pw = Math.max(24, boxRight - boxX);
        const py = lbTop + padY, ph = lbH - padY * 2;
        const sc = Math.min(pw / logo.width, ph / logo.height) * 0.82; // shrink for margin
        const dw = logo.width * sc, dh = logo.height * sc;
        const dx = boxX + (pw - dw) / 2, dy = py + (ph - dh) / 2;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(logo, dx, dy, dw, dh);
        ctx.restore();
      } else {
        // text wordmark fallback
        const cx = lbX + 30;
        const l1Size = Math.round(barH * 0.24);
        heavy(ctx, (config.logoLine1 || '').toUpperCase(), cx, lbTop + lbH * 0.42, l1Size, { align: 'left', condense: 0.9, weight: 800, color: '#fff', shadow: true });
        const l2Size = Math.round(barH * 0.46);
        goldText(ctx, (config.logoLine2 || '').toUpperCase(), cx, lbTop + lbH * 0.9, l2Size, 0.86);
        const uw = Math.min(lbW - 60, heavyWidth(ctx, (config.logoLine2 || '').toUpperCase(), l2Size, 0.86) + 10);
        const ug = ctx.createLinearGradient(cx, 0, cx + uw, 0); ug.addColorStop(0, accent); ug.addColorStop(1, 'rgba(231,181,59,0)');
        ctx.fillStyle = ug; ctx.fillRect(cx, lbTop + lbH * 0.92, uw, 3);
      }

      // ---- title + subtitle (center) ----
      const tx = lbX + lbW + 40;
      const rightPad = 40;
      // right tag (top-right)
      let tagW = 0;
      if (config.rightTag) {
        const tagSize = Math.round(barH * 0.26);
        tagW = heavyWidth(ctx, config.rightTag, tagSize, 0.9) + 26;
        heavy(ctx, config.rightTag, W - rightPad, barY + barH * 0.44, tagSize, { align: 'right', condense: 0.9, weight: 800, color: '#eef4fb', shadow: true });
      }
      // title (auto-fit to available width)
      const titleMax = (W - rightPad - tagW) - tx;
      let titleSize = Math.round(barH * 0.44);
      titleSize = fitSize(ctx, (config.title || '').toUpperCase(), titleSize, 0.9, titleMax);
      heavy(ctx, (config.title || '').toUpperCase(), tx, barY + barH * 0.46, titleSize, { align: 'left', condense: 0.9, weight: 900, color: '#ffffff', shadow: true });

      // subtitle (date) in accent-yellow, lower-left
      if (config.subtitle) {
        heavy(ctx, config.subtitle, tx, barY + barH * 0.86, Math.round(barH * 0.3), { align: 'left', condense: 0.92, weight: 800, color: '#ffe14a', shadow: true });
      }

      // ---- gust scale (lower-right) ----
      if (config.showScale) {
        const scH = Math.round(barH * 0.2);
        const scY = barY + barH * 0.72;
        const scW = Math.round(W * 0.33);
        const scX = W - rightPad - scW;
        drawScale(ctx, scX, scY, scW, scH, accent);
      }
    },
  };
}

// ── legacy styles (unchanged) ───────────────────────────────────────────────────
function angledBlue(config) {
  return {
    name: 'lt-angled',
    draw(ctx, s) {
      const y = 800, h = 150, skew = 70;
      const left = 90, blockW = 520;
      const bg = ctx.createLinearGradient(left, y, left, y + h);
      bg.addColorStop(0, config.accent); bg.addColorStop(1, shade(config.accent, 0.7));
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + blockW, y);
      ctx.lineTo(left + blockW - skew, y + h); ctx.lineTo(left, y + h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e7b53b';
      ctx.beginPath(); ctx.moveTo(left + blockW, y); ctx.lineTo(left + blockW + 16, y);
      ctx.lineTo(left + blockW + 16 - skew, y + h); ctx.lineTo(left + blockW - skew, y + h); ctx.closePath(); ctx.fill();
      const wx = left + blockW + 16;
      ctx.fillStyle = '#f6f8fb';
      ctx.beginPath(); ctx.moveTo(wx, y); ctx.lineTo(s.width - 90, y);
      ctx.lineTo(s.width - 90, y + h); ctx.lineTo(wx - skew, y + h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '900 56px "Segoe UI", Arial Black, sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillText(config.title2 || config.title, left + 36, y + h / 2);
      ctx.fillStyle = '#10203a'; ctx.font = '700 44px "Segoe UI", Arial, sans-serif';
      ctx.fillText(config.subtitle2 || config.subtitle, wx + 30, y + h / 2);
    },
  };
}

function nameStrip(config) {
  return {
    name: 'lt-name',
    draw(ctx, s) {
      const y = 820, h = 130, x = 120, w = s.width - 240;
      roundRect(ctx, x, y, w, h, 10);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#10233f'); g.addColorStop(1, '#081627');
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = config.accent; ctx.fillRect(x, y, 16, h);
      ctx.fillStyle = '#fff'; ctx.font = '900 52px "Segoe UI", Arial Black, sans-serif'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(config.title2 || config.title, x + 50, y + 62);
      ctx.fillStyle = '#9db8de'; ctx.font = '600 34px "Segoe UI", Arial, sans-serif';
      ctx.fillText(config.subtitle2 || config.subtitle, x + 50, y + 104);
    },
  };
}

function shade(hex, f) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}
