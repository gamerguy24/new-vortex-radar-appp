// Template: Radar Forecast (broadcast) — a full-frame radar/terrain map under a
// TV-station header (brand flag + title slab + precip RAIN/ICE/SNOW scale + a
// sponsor slot), with a left forecast panel (rain chance / main hazard /
// coverage) and a bottom "download our app" call-to-action. Modeled on the
// common local-TV weather layout. All text, the brand block, the sponsor image,
// and the CTA are editable — nothing is tied to a specific station.
//
// The map itself (satellite/roads basemap + live NEXRAD radar + city labels) is
// supplied by the studio: set the basemap to "Satellite + roads (hybrid)" and
// toggle Radar on to reproduce the screenshot's base.
import { fitProjection } from '../engine/projection.js';
import { backgroundLayer, landLayer, BASEMAP_OPTIONS } from '../engine/basemap.js';
import { cityLabelLayer } from '../engine/labels.js';
import { REGION_PRESETS, countiesForStates } from '../engine/geo.js';
import { roundRect } from '../engine/scene.js';
import { fetchRadar, radarLayer } from '../engine/radar.js';
import {
  loadModelField, modelFieldLayer, fieldLegendLayer, MODEL_OPTIONS, MODEL_PRESETS, FHR_OPTIONS,
} from '../engine/model_field.js';

const FONT = '"Roboto Condensed", "Arial Narrow", system-ui, sans-serif';

// Async overlay state (module-scoped): one model-field + one radar request.
const fieldStore = { key: null, status: 'idle', field: null, error: null };
const radarStore = { key: null, status: 'idle', radar: null, error: null };

// Padded visible lon/lat rectangle for the model-field request.
function viewBbox(scene) {
  const p = scene.projection;
  if (!p || !p.invert) return [-125, 24, -66.5, 50];
  const cs = [[0, 0], [scene.width, 0], [0, scene.height], [scene.width, scene.height], [scene.width / 2, scene.height / 2]];
  let W = Infinity, S = Infinity, E = -Infinity, N = -Infinity;
  for (const [x, y] of cs) {
    const ll = p.invert([x, y]);
    if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) continue;
    W = Math.min(W, ll[0]); E = Math.max(E, ll[0]); S = Math.min(S, ll[1]); N = Math.max(N, ll[1]);
  }
  if (!isFinite(W)) return [-125, 24, -66.5, 50];
  const padX = (E - W) * 0.12 + 0.25, padY = (N - S) * 0.12 + 0.25;
  W -= padX; E += padX; S -= padY; N += padY;
  const r = (x) => Math.round(x * 2) / 2;
  return [Math.max(-179, r(W)), Math.max(-85, r(S)), Math.min(179, r(E)), Math.min(85, r(N))];
}

// Simple image cache: returns the loaded <img> or null (and triggers a rerender
// once it decodes). Used for the sponsor logo + CTA app icon.
const _imgCache = {};
function getImg(src, ctrl) {
  if (!src) return null;
  if (src in _imgCache) return _imgCache[src];
  _imgCache[src] = null;
  const img = new Image();
  img.onload = () => { _imgCache[src] = img; if (ctrl && ctrl.rerender) ctrl.rerender(); };
  img.onerror = () => { _imgCache[src] = null; };
  img.src = src;
  return null;
}

function txt(ctx, str, x, y, o = {}) {
  const { size = 30, weight = 800, color = '#fff', align = 'left', baseline = 'alphabetic', scaleX = 1, shadow = false } = o;
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = baseline; ctx.fillStyle = color;
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2; }
  if (scaleX !== 1) { ctx.translate(x, 0); ctx.scale(scaleX, 1); ctx.fillText(str, 0, y); }
  else ctx.fillText(str, x, y);
  ctx.restore();
}
// Shrink to fit a max width.
function fitTxt(ctx, str, maxW, startSize, weight) {
  let s = startSize;
  for (; s > 10; s--) { ctx.font = `${weight} ${s}px ${FONT}`; if (ctx.measureText(str).width <= maxW) break; }
  return s;
}

export default {
  id: 'radar-forecast',
  label: 'Radar Forecast (broadcast)',
  scale: null,

  defaultConfig() {
    return {
      title: 'SCATTERED T-STORMS',
      time: '5:00 PM',
      region: 'north-georgia',
      basemap: 'hybrid',
      // Map overlay: live radar, or a forecast-model field (GFS/NAM/HRRR).
      overlay: 'radar',
      model: 'gfs',
      field: 't2m',
      fhr: '24',
      overlayOpacity: '0.85',
      showFieldLegend: true,
      // Brand flag (top-left). Defaults to the app's identity — edit to your own.
      brandTop: 'VORTEX',
      brandBig: 'RADAR',
      brandBottom: 'WEATHER',
      brandColor: '#1b53b3',
      showScale: true,
      // Sponsor slot (top-right). Upload a logo, or a placeholder shows.
      sponsorImg: '',
      sponsorText: 'YOUR SPONSOR',
      // Left forecast panel.
      showPanel: true,
      rainLabel: 'CHANCE OF RAIN',
      rainValue: '40%',
      hazardLabel: 'MAIN HAZARD',
      hazards: ['DMG. WIND GUSTS', 'FLASH FLOODING'],
      coverage: 'ISOLATED',
      // Bottom CTA.
      showCta: true,
      ctaText: 'DOWNLOAD OUR FREE WEATHER APP',
      ctaSub: 'LINK BELOW',
      ctaIcon: '/logo.png',
    };
  },

  fields() {
    return [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'time', label: 'Time label', type: 'text' },
      { key: 'overlay', label: 'Map overlay', type: 'select', options: [
        { value: 'radar', label: 'Live radar (NEXRAD)' },
        { value: 'field', label: 'Forecast field (model)' }] },
      { key: 'model', label: 'Model (field mode)', type: 'select', options: MODEL_OPTIONS },
      { key: 'field', label: 'Field (field mode)', type: 'select', options: MODEL_PRESETS.map((p) => ({ value: p.id, label: p.label })) },
      { key: 'fhr', label: 'Forecast hour (field mode)', type: 'select', options: FHR_OPTIONS },
      { key: 'overlayOpacity', label: 'Overlay opacity', type: 'select', options: [
        { value: '1', label: '100%' }, { value: '0.85', label: '85%' }, { value: '0.7', label: '70%' }, { value: '0.55', label: '55%' }] },
      { key: 'showFieldLegend', label: 'Show field legend', type: 'toggle' },
      { key: 'region', label: 'Region', type: 'select',
        options: Object.entries(REGION_PRESETS).filter(([k]) => k !== 'conus').map(([k, v]) => ({ value: k, label: v.label })) },
      { key: 'basemap', label: 'Basemap', type: 'select', options: BASEMAP_OPTIONS },
      { key: 'showScale', label: 'Show RAIN/ICE/SNOW scale', type: 'toggle' },
      { key: 'brandTop', label: 'Brand — top line', type: 'text' },
      { key: 'brandBig', label: 'Brand — big line', type: 'text' },
      { key: 'brandBottom', label: 'Brand — bottom line', type: 'text' },
      { key: 'brandColor', label: 'Brand color', type: 'color' },
      { key: 'sponsorImg', label: 'Sponsor logo (image)', type: 'image' },
      { key: 'sponsorText', label: 'Sponsor placeholder text', type: 'text' },
      { key: 'showPanel', label: 'Show forecast panel', type: 'toggle' },
      { key: 'rainLabel', label: 'Panel — stat 1 label', type: 'text' },
      { key: 'rainValue', label: 'Panel — stat 1 value', type: 'text' },
      { key: 'hazardLabel', label: 'Panel — hazard label', type: 'text' },
      { key: 'hazards', label: 'Panel — hazard lines (comma sep)', type: 'csv' },
      { key: 'coverage', label: 'Panel — coverage value', type: 'text' },
      { key: 'showCta', label: 'Show app CTA', type: 'toggle' },
      { key: 'ctaText', label: 'CTA text', type: 'text' },
      { key: 'ctaSub', label: 'CTA sub-text', type: 'text' },
      { key: 'ctaIcon', label: 'CTA app icon (image)', type: 'image' },
    ];
  },

  build(scene, geo, config, ctrl) {
    const preset = REGION_PRESETS[config.region] || REGION_PRESETS['north-georgia'];
    const abbrs = preset.states || ['GA'];
    const counties = countiesForStates(geo, abbrs);

    // Full-bleed map (header + panels overlay it). Slight overscan so the frame
    // fills with no ocean gaps at the corners.
    const mapRect = { x0: -80, y0: -60, x1: 2000, y1: 1140 };
    scene.projection = fitProjection('mercator', counties, mapRect, { pad: 10 });

    scene.clearLayers();
    scene.add(backgroundLayer(config.basemap));
    scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyMesh: geo.countyBorders, borderMesh: geo.stateBorders }));

    // Map overlay (under labels/chrome): live radar or a forecast-model field.
    // Loads asynchronously; borders are re-stroked on top so lines stay crisp.
    const opacity = parseFloat(config.overlayOpacity) || 0.85;
    const bordersOver = () => scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyMesh: geo.countyBorders, borderMesh: geo.stateBorders, override: { land: 'rgba(0,0,0,0)', relief: false } }));
    let fieldReady = false;

    if (config.overlay === 'field') {
      const bbox = viewBbox(scene);
      const key = `${config.model}|${config.field}|${config.fhr}|${bbox.join(',')}`;
      if (fieldStore.key !== key) {
        fieldStore.key = key; fieldStore.status = 'loading'; fieldStore.error = null;
        loadModelField(config.model, config.field, config.fhr, bbox)
          .then((f) => { if (fieldStore.key === key) { fieldStore.field = f; fieldStore.status = 'ready'; ctrl.rerender(); } })
          .catch((e) => { if (fieldStore.key === key) { fieldStore.status = 'error'; fieldStore.error = e.message; fieldStore.field = null; ctrl.rerender(); } });
      }
      fieldReady = fieldStore.status === 'ready' && fieldStore.field && fieldStore.key === key;
      if (fieldReady) { scene.add(modelFieldLayer(fieldStore.field, opacity)); bordersOver(); }
    } else {
      // Live radar (self-contained, so the picker works without the ◈ toggle).
      const key = `${config.region}|${viewBbox(scene).join(',')}`;
      if (radarStore.key !== key) {
        radarStore.key = key; radarStore.status = 'loading'; radarStore.error = null;
        fetchRadar(scene, { opacity })
          .then((rd) => { if (radarStore.key === key) { radarStore.radar = rd; radarStore.status = 'ready'; ctrl.rerender(); } })
          .catch((e) => { if (radarStore.key === key) { radarStore.status = 'error'; radarStore.error = e.message; radarStore.radar = null; ctrl.rerender(); } });
      }
      if (radarStore.status === 'ready' && radarStore.radar && radarStore.key === key) {
        radarStore.radar.opacity = opacity; scene.add(radarLayer(radarStore.radar)); bordersOver();
      }
    }

    scene.add(cityLabelLayer({ maxRank: 3, fontSize: 18, bounds: { x0: 20, y0: 170, x1: 1900, y1: 1060 } }));

    scene.add(headerLayer(config, ctrl));
    if (config.showPanel) scene.add(panelLayer(config));
    if (config.showCta) scene.add(ctaLayer(config, ctrl));

    // Model-field data legend (bottom, right of the CTA) — only in field mode.
    if (config.overlay === 'field' && config.showFieldLegend !== false && fieldReady && fieldStore.field.legend) {
      const p = MODEL_PRESETS.find((mp) => mp.id === config.field);
      scene.add(fieldLegendLayer(fieldStore.field.legend, { x: 470, y: 986, w: 940, h: 74 }, { title: (p && p.label) || 'Forecast' }));
    }
  },
};

// ── header: brand flag + title slab + precip scale + sponsor ───────────────────
function headerLayer(config, ctrl) {
  return {
    name: 'title-bar',
    draw(ctx) {
      const H = 150;
      // ---- brand flag (slanted blue block) ----
      const fw = 400, slant = 40;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(fw, 0); ctx.lineTo(fw - slant, H); ctx.lineTo(0, H); ctx.closePath();
      const fg = ctx.createLinearGradient(0, 0, 0, H);
      fg.addColorStop(0, shade(config.brandColor, 1.25)); fg.addColorStop(1, shade(config.brandColor, 0.7));
      ctx.fillStyle = fg; ctx.fill();
      ctx.clip();
      const cx = (fw - slant / 2) / 2;
      if (config.brandTop) txt(ctx, config.brandTop.toUpperCase(), cx, 34, { size: 26, weight: 700, align: 'center', color: '#dbe6ff', scaleX: 0.98 });
      if (config.brandBig) { const s = fitTxt(ctx, config.brandBig.toUpperCase(), fw - 60, 74, '900'); txt(ctx, config.brandBig.toUpperCase(), cx, 92, { size: s, weight: 900, align: 'center', color: '#fff' }); }
      // bottom black strip
      ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.fillRect(0, H - 40, fw, 40);
      if (config.brandBottom) txt(ctx, config.brandBottom.toUpperCase(), cx, H - 12, { size: 26, weight: 800, align: 'center', color: '#fff', scaleX: 1.02 });
      ctx.restore();

      // ---- geometry for center + sponsor ----
      const barX = fw + 12, sponsorW = 556, sponsorX = 1920 - sponsorW - 20;
      const barW = sponsorX - 12 - barX;
      const titleH = config.showScale ? 92 : H - 12;

      // ---- title slab (silver/white gradient) ----
      roundRect(ctx, barX, 8, barW, titleH - 8, 6);
      const tg = ctx.createLinearGradient(barX, 8, barX, titleH);
      tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.5, '#eef1f5'); tg.addColorStop(1, '#c9cfd8');
      ctx.fillStyle = tg; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      const tSize = fitTxt(ctx, (config.title || '').toUpperCase(), barW - 60, 60, '900');
      txt(ctx, (config.title || '').toUpperCase(), barX + barW / 2, 8 + (titleH - 8) / 2 + tSize * 0.34, { size: tSize, weight: 900, align: 'center', color: '#0b1526' });

      // ---- precip scale bar (black) — swatches auto-sized to fit the bar ----
      if (config.showScale) {
        const sy = titleH + 4, sh = H - titleH - 8;
        roundRect(ctx, barX, sy, barW, sh, 5); ctx.fillStyle = '#0a0d12'; ctx.fill();
        const midY = sy + sh / 2;
        const items = [
          ['RAIN', ['#22c55e', '#eaff00', '#ff8a00', '#ff0000', '#b10000']],
          ['ICE', ['#ff5ad0', '#c13ba8']],
          ['SNOW', ['#eaf4ff', '#7cc4ff', '#2b7fd6']],
        ];
        const lblSize = 21, labelGap = 9, gap = 18, padL = 18, padR = 16;
        ctx.font = `800 ${lblSize}px ${FONT}`;
        txt(ctx, config.time || '', barX + padL, midY + 9, { size: 25, weight: 800, color: '#fff' });
        const start = barX + padL + ctx.measureText(config.time || '').width + 30;
        const right = barX + barW - padR;
        const labelsW = items.reduce((a, [l]) => a + ctx.measureText(l).width + labelGap, 0);
        const swW = Math.max(64, Math.floor((right - start - labelsW - gap * items.length) / items.length));
        let sx = start;
        for (const [label, stops] of items) {
          ctx.font = `800 ${lblSize}px ${FONT}`;
          txt(ctx, label, sx, midY + 8, { size: lblSize, weight: 800, color: '#fff' });
          const lx = sx + ctx.measureText(label).width + labelGap;
          const g = ctx.createLinearGradient(lx, 0, lx + swW, 0);
          stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
          roundRect(ctx, lx, midY - 11, swW, 22, 4); ctx.fillStyle = g; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();
          sx = lx + swW + gap;
        }
      }

      // ---- sponsor slot ----
      roundRect(ctx, sponsorX, 10, sponsorW, H - 20, 8);
      const spg = ctx.createLinearGradient(sponsorX, 10, sponsorX, H - 10);
      spg.addColorStop(0, '#e9eef4'); spg.addColorStop(1, '#aeb9c7');
      ctx.fillStyle = spg; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      const img = getImg(config.sponsorImg, ctrl);
      if (img && img.width) {
        const pad = 12, aw = sponsorW - pad * 2, ah = H - 20 - pad * 2;
        const r = Math.min(aw / img.width, ah / img.height);
        const dw = img.width * r, dh = img.height * r;
        ctx.save(); roundRect(ctx, sponsorX + 2, 12, sponsorW - 4, H - 24, 7); ctx.clip();
        ctx.drawImage(img, sponsorX + (sponsorW - dw) / 2, 10 + (H - 20 - dh) / 2, dw, dh);
        ctx.restore();
      } else {
        txt(ctx, (config.sponsorText || 'YOUR SPONSOR').toUpperCase(), sponsorX + sponsorW / 2, 68, { size: 34, weight: 900, align: 'center', color: '#33404f' });
        txt(ctx, 'SPONSOR', sponsorX + sponsorW / 2, 104, { size: 20, weight: 700, align: 'center', color: '#5b6875' });
      }
    },
  };
}

// ── left forecast panel ────────────────────────────────────────────────────────
function panelLayer(config) {
  return {
    name: 'wx-panel',
    draw(ctx) {
      const x = 24, w = 300;
      let y = 196;
      const label = config.brandColor;
      const labelStrip = (text) => {
        roundRect(ctx, x, y, w, 36, 4); ctx.fillStyle = shade(label, 0.95); ctx.fill();
        txt(ctx, (text || '').toUpperCase(), x + w / 2, y + 25, { size: 21, weight: 800, align: 'center', color: '#fff', scaleX: 0.98 });
        y += 36;
      };
      const bigValue = (text) => {
        const h = 74;
        roundRect(ctx, x, y, w, h, 4); ctx.fillStyle = 'rgba(9,20,40,0.92)'; ctx.fill();
        const s = fitTxt(ctx, text || '', w - 30, 60, '900');
        txt(ctx, text || '', x + w / 2, y + h / 2 + s * 0.34, { size: s, weight: 900, align: 'center', color: '#fff' });
        y += h + 8;
      };
      const lines = (arr) => {
        const h = 30 + arr.length * 38;
        roundRect(ctx, x, y, w, h, 4); ctx.fillStyle = 'rgba(9,20,40,0.92)'; ctx.fill();
        let ly = y + 44;
        for (const t of arr) { const s = fitTxt(ctx, t.toUpperCase(), w - 30, 30, '800'); txt(ctx, t.toUpperCase(), x + w / 2, ly, { size: s, weight: 800, align: 'center', color: '#fff' }); ly += 38; }
        y += h + 8;
      };

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
      roundRect(ctx, x, y, w, 6, 4); ctx.fillStyle = 'rgba(0,0,0,0.01)'; ctx.fill();
      ctx.restore();

      if (config.rainLabel || config.rainValue) { labelStrip(config.rainLabel); bigValue(config.rainValue); }
      const hz = (config.hazards || []).filter(Boolean);
      if (config.hazardLabel || hz.length) { labelStrip(config.hazardLabel); if (hz.length) lines(hz); }
      if (config.coverage) bigValue(config.coverage);
    },
  };
}

// ── bottom-left app CTA ─────────────────────────────────────────────────────────
function ctaLayer(config, ctrl) {
  return {
    name: 'wx-cta',
    draw(ctx) {
      const x = 24, w = 300, h = 84, y = 1080 - h - 24;
      roundRect(ctx, x, y, w, h, 8);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, shade(config.brandColor, 1.15)); g.addColorStop(1, shade(config.brandColor, 0.75));
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();

      const iconSz = 60, iconX = x + w - iconSz - 12, iconY = y + (h - iconSz) / 2;
      const icon = getImg(config.ctaIcon, ctrl);
      const textW = iconX - x - 28;
      // CTA text wraps to 3 lines within textW.
      const words = (config.ctaText || '').toUpperCase().split(/\s+/);
      const lines = []; let cur = '';
      ctx.font = `900 21px ${FONT}`;
      for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (ctx.measureText(t).width > textW && cur) { lines.push(cur); cur = wd; } else cur = t; }
      if (cur) lines.push(cur);
      let ly = y + 26;
      for (const l of lines.slice(0, 3)) { txt(ctx, l, x + 16, ly, { size: 20, weight: 900, color: '#fff' }); ly += 22; }
      if (config.ctaSub) txt(ctx, config.ctaSub.toUpperCase(), x + 16, ly, { size: 16, weight: 700, color: '#cfe0ff' });

      if (icon && icon.width) {
        ctx.save(); roundRect(ctx, iconX, iconY, iconSz, iconSz, 12); ctx.clip();
        ctx.fillStyle = '#fff'; ctx.fillRect(iconX, iconY, iconSz, iconSz);
        const r = Math.min(iconSz / icon.width, iconSz / icon.height);
        ctx.drawImage(icon, iconX + (iconSz - icon.width * r) / 2, iconY + (iconSz - icon.height * r) / 2, icon.width * r, icon.height * r);
        ctx.restore();
      }
    },
  };
}

// #rrggbb → brightened/darkened (factor >1 lightens toward white, <1 darkens).
function shade(hex, factor) {
  const h = (hex || '#1b53b3').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (factor >= 1) { const t = factor - 1; r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
  else { r *= factor; g *= factor; b *= factor; }
  return `rgb(${Math.round(Math.max(0, Math.min(255, r)))},${Math.round(Math.max(0, Math.min(255, g)))},${Math.round(Math.max(0, Math.min(255, b)))})`;
}
