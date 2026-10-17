// Template: Alert Spotlight — one state's counties with an NWS advisory /
// watch / warning painted in its official colour, plus an on-air callout
// panel: headline, when ("TONIGHT" + times) and up to three detail lines
// ("LOWS IN THE LOW TO MID 30S", "PROTECT OUTDOOR PLANTS").
//
// "Fill from live NWS alerts" paints every county in the state currently
// under the chosen alert type (api.weather.gov, matched by county FIPS from
// the alert's SAME codes) and fills in the times from the alert itself.
import { fitProjection } from '../engine/projection.js?v=tpl1';
import { backgroundLayer, landLayer, BASEMAP_OPTIONS } from '../engine/basemap.js';
import { choroplethLayer, outlineLayer } from '../engine/choropleth.js';
import { cityLabelLayer } from '../engine/labels.js';
import { categoricalLegendLayer, pickText } from '../engine/legend.js';
import { bannerHeaderLayer } from '../engine/chrome.js';
import { scaleColor } from '../engine/scales.js';
import { COLORS, withShadow, caps, panelPath, shade } from '../engine/style.js';
import { STATE_NAMES, ABBR_STATE_FIPS } from '../engine/geo.js';

// Official NWS hazard colours (same values as app/alerts/colors/noaa_colors.js).
// Data colour — never re-themed.
const ALERTS = {
  'Frost Advisory': '#6495ED',
  'Freeze Watch': '#00FFFF',
  'Freeze Warning': '#483D8B',
  'Hard Freeze Warning': '#9400D3',
  'Wind Chill Advisory': '#AFEEEE',
  'Extreme Cold Warning': '#0000FF',
  'Winter Weather Advisory': '#7B68EE',
  'Winter Storm Watch': '#4682B4',
  'Winter Storm Warning': '#FF69B4',
  'Ice Storm Warning': '#8B008B',
  'Wind Advisory': '#D2B48C',
  'High Wind Warning': '#DAA520',
  'Heat Advisory': '#FF7F50',
  'Dense Fog Advisory': '#708090',
  'Flood Watch': '#2E8B57',
  'Red Flag Warning': '#FF1493',
};

const W = 1920;
const MAP = { x0: 50, y0: 150, x1: 1250, y1: 1000 };
const PANEL = { x: 1300, y: 210, w: 580 };

export default {
  id: 'alert-spotlight',
  label: 'Alert Spotlight (advisory callout)',

  // One brush: the chosen alert, in its NWS colour.
  getScale(config) {
    const name = config?.alertType || 'Frost Advisory';
    return [{ id: 'alert', label: name, color: ALERTS[name] || '#6495ED' }];
  },

  defaultConfig() {
    return {
      stateAbbr: 'GA',
      alertType: 'Frost Advisory',
      headline: '',              // blank = the alert type's name
      subtitle: "Tonight's Forecast",
      when: 'Tonight',
      timeRange: '',
      line1: 'Lows in the low to mid 30s',
      line2: 'Protect outdoor plants',
      line3: '',
      footnote: '',
      basemap: 'satellite',
      showCities: true,
      showLegend: true,
      values: {},                // fips -> 'alert' (or a custom hex)
    };
  },

  fields() {
    const states = Object.entries(STATE_NAMES)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([abbr, name]) => ({ value: abbr, label: name }));
    return [
      { key: 'stateAbbr', label: 'State', type: 'select', options: states },
      { key: 'alertType', label: 'Alert type', type: 'select', rebuildsBrushes: true,
        options: Object.keys(ALERTS).map((n) => ({ value: n, label: n })) },
      { key: 'fillNws', label: 'Fill from live NWS alerts', type: 'action', action: 'fill-nws' },
      { key: 'headline', label: 'Headline (blank = alert type)', type: 'text' },
      { key: 'when', label: 'When', type: 'text' },
      { key: 'timeRange', label: 'Times (e.g. 1 AM – 9 AM)', type: 'text' },
      { key: 'line1', label: 'Detail line 1', type: 'text' },
      { key: 'line2', label: 'Detail line 2', type: 'text' },
      { key: 'line3', label: 'Detail line 3', type: 'text' },
      { key: 'footnote', label: 'Footnote (e.g. issuing office)', type: 'text' },
      { key: 'subtitle', label: 'Header subtitle', type: 'text' },
      { key: 'basemap', label: 'Basemap', type: 'select', options: BASEMAP_OPTIONS },
      { key: 'showCities', label: 'Show city labels', type: 'toggle' },
      { key: 'showLegend', label: 'Show colour key', type: 'toggle' },
      { key: 'paint', label: 'Paint counties', type: 'paint' },
    ];
  },

  // Studio action buttons (studio.js calls this for actions it does not own).
  async onAction(action, config, ctrl) {
    if (action !== 'fill-nws') return '';
    const abbr = config.stateAbbr || 'GA';
    const event = config.alertType || 'Frost Advisory';
    const url = `https://api.weather.gov/alerts/active?area=${encodeURIComponent(abbr)}&event=${encodeURIComponent(event)}`;
    const r = await fetch(url, { headers: { Accept: 'application/geo+json' } });
    if (!r.ok) throw new Error(`NWS returned HTTP ${r.status}`);
    const feats = (await r.json()).features || [];
    if (!feats.length) return `No ${event} is in effect in ${STATE_NAMES[abbr] || abbr} right now.`;

    const stateFips = ABBR_STATE_FIPS[abbr];
    const values = {};
    let onset = null, ends = null;
    const offices = new Set();
    for (const a of feats) {
      const p = a.properties || {};
      // SAME = 0 + 2-digit state FIPS + 3-digit county FIPS.
      for (const same of (p.geocode && p.geocode.SAME) || []) {
        const fips = String(same).slice(-5);
        if (fips.slice(0, 2) === stateFips) values[fips] = 'alert';
      }
      const on = Date.parse(p.onset || p.effective || ''), en = Date.parse(p.ends || p.expires || '');
      if (Number.isFinite(on) && (onset == null || on < onset)) onset = on;
      if (Number.isFinite(en) && (ends == null || en > ends)) ends = en;
      if (p.senderName) offices.add(String(p.senderName).replace(/^NWS\s+/i, ''));
    }
    config.values = values;
    if (onset != null && ends != null) config.timeRange = `${hour(onset)} – ${hour(ends)}`;
    if (!config.footnote && offices.size) config.footnote = `Issued by NWS ${[...offices].join(' & ')}`;
    ctrl.rebuildProps();
    ctrl.rerender();
    return `Painted ${Object.keys(values).length} counties from ${feats.length} active alert${feats.length > 1 ? 's' : ''}.`;
  },

  build(scene, geo, config, ctrl) {
    const abbr = config.stateAbbr || 'GA';
    const fips = ABBR_STATE_FIPS[abbr];
    const stateFeature = geo.stateByFips.get(fips);
    const counties = geo.countiesByState.get(fips) || [];
    const scale = this.getScale(config);
    const accent = scale[0].color;

    scene.projection = fitProjection('mercator', counties, MAP, { pad: 10 });

    scene.clearLayers();
    scene.add(backgroundLayer(config.basemap));
    scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyMesh: geo.countyBorders, borderMesh: geo.stateBorders }));
    scene.add(choroplethLayer({
      features: counties,
      keyFn: (f) => f.fips,
      valueOf: (k) => config.values[k] ?? null,
      colorOf: (id) => scaleColor(scale, id),
      opacity: 0.75,
      onPaint: (key) => {
        const b = ctrl.getBrush();
        if (b == null || b === 'erase') delete config.values[key];
        else config.values[key] = b;
        ctrl.rerender();
      },
    }));
    if (stateFeature) scene.add(outlineLayer({ features: [stateFeature], color: '#ffffff', width: 3.5 }));

    scene.add(bannerHeaderLayer({
      title: STATE_NAMES[abbr] || abbr,
      region: config.subtitle,
      date: null,
      rect: { x: 40, y: 28, w: 1180, h: 70 },
    }));

    if (config.showLegend !== false) {
      scene.add(categoricalLegendLayer(
        [{ label: config.alertType || 'Frost Advisory', color: accent }],
        { x: MAP.x0 + 20, y: 1012, w: 360, h: 44 },
        { border: 2, borderColor: 'rgba(255,255,255,0.7)' },
      ));
    }

    if (config.showCities) scene.add(cityLabelLayer({ maxRank: 2, fontSize: 18, bounds: MAP }));

    // Callout last, so nothing on the map draws over it.
    scene.add(calloutLayer(config, accent));
  },
};

// "1 AM", "9 AM" in the viewer's zone — the zone the graphic is made for.
function hour(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}

function calloutLayer(config, accent) {
  return {
    name: 'alert-callout',
    draw(ctx) {
      const { x, y, w } = PANEL;
      const lines = [config.line1, config.line2, config.line3].map((s) => String(s || '').trim()).filter(Boolean);
      const headline = String(config.headline || config.alertType || 'Frost Advisory').trim();
      const bandH = 112, whenH = config.when || config.timeRange ? 86 : 0;
      const rowH = 92, foot = config.footnote ? 52 : 18;
      const h = bandH + whenH + 24 + lines.length * rowH + foot;
      const ink = pickText(accent);

      // Body: navy gradient card with a soft depth shadow.
      withShadow(ctx, () => { panelPath(ctx, x, y, w, h, 10); ctx.fillStyle = '#081a33'; ctx.fill(); }, { blur: 26, y: 8 });
      ctx.save();
      panelPath(ctx, x, y, w, h, 10); ctx.clip();
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, COLORS.navyTop); g.addColorStop(1, COLORS.navyBot);
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);

      // Headline band in the alert's colour, gold seam under it.
      const bg = ctx.createLinearGradient(x, y, x, y + bandH);
      bg.addColorStop(0, accent); bg.addColorStop(1, shade(accent, 0.78));
      ctx.fillStyle = bg; ctx.fillRect(x, y, w, bandH);
      const sh = ctx.createLinearGradient(x, y, x, y + bandH * 0.5);
      sh.addColorStop(0, 'rgba(255,255,255,0.22)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh; ctx.fillRect(x, y, w, bandH * 0.5);
      const gs = ctx.createLinearGradient(x, 0, x + w, 0);
      gs.addColorStop(0, COLORS.goldLt); gs.addColorStop(0.6, COLORS.gold); gs.addColorStop(1, 'rgba(231,181,59,0.2)');
      ctx.fillStyle = gs; ctx.fillRect(x, y + bandH, w, 3);
      caps(ctx, headline, x + w / 2, y + bandH / 2 + 2, {
        size: 62, color: ink, align: 'center', scaleX: 0.86, maxWidth: w - 48, shadow: ink === '#ffffff' || ink === '#fff',
      });

      // When: accent pill + times.
      let cy = y + bandH + 3;
      if (whenH) {
        const mid = cy + whenH / 2 + 4;
        let px = x + 32;
        if (config.when) {
          ctx.save();
          ctx.font = '900 34px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
          const pw = ctx.measureText(String(config.when).toUpperCase()).width * 0.9 + 40;
          ctx.restore();
          panelPath(ctx, px, mid - 26, pw, 52, 26);
          ctx.fillStyle = accent; ctx.fill();
          caps(ctx, config.when, px + pw / 2, mid + 1, { size: 34, color: ink, align: 'center', scaleX: 0.9, shadow: false });
          px += pw + 22;
        }
        if (config.timeRange) caps(ctx, config.timeRange, px, mid + 1, { size: 36, color: COLORS.white, scaleX: 0.9, maxWidth: x + w - px - 28 });
        cy += whenH;
        ctx.fillStyle = 'rgba(150,185,235,0.35)'; ctx.fillRect(x + 28, cy, w - 56, 2);
      }

      // Detail rows: icon disc + condensed caps.
      cy += 24;
      for (const text of lines) {
        const mid = cy + rowH / 2;
        const r = 30, ix = x + 32 + r;
        ctx.beginPath(); ctx.arc(ix, mid, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = accent; ctx.stroke();
        drawIcon(ctx, iconFor(text), ix, mid, r * 0.62, '#ffffff');
        caps(ctx, text, ix + r + 22, mid + 1, { size: 36, color: COLORS.white, scaleX: 0.88, maxWidth: x + w - (ix + r + 22) - 26 });
        cy += rowH;
      }

      if (config.footnote) {
        caps(ctx, config.footnote, x + 32, y + h - 28, { size: 20, weight: 700, color: COLORS.sub, scaleX: 0.95, maxWidth: w - 64, shadow: false });
      }
      ctx.restore();

      // Hairline frame on top of everything.
      panelPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 10);
      ctx.lineWidth = 1.5; ctx.strokeStyle = COLORS.border; ctx.stroke();
    },
  };
}

// Pick an icon from the wording, so typed lines get a fitting symbol.
function iconFor(text) {
  const t = text.toLowerCase();
  if (/plant|garden|flower|crop|vegetat|cover/.test(t)) return 'plant';
  if (/pet|animal|livestock/.test(t)) return 'paw';
  if (/pipe|faucet|drip/.test(t)) return 'drop';
  if (/wind|gust/.test(t)) return 'wind';
  if (/snow|ice|frost|freez|sleet/.test(t)) return 'snow';
  if (/low|high|temp|°|degrees|\d0s\b/.test(t)) return 'thermo';
  return 'info';
}

function drawIcon(ctx, kind, cx, cy, s, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2.5, s * 0.16); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (kind === 'thermo') {
    ctx.beginPath(); ctx.arc(cx, cy + s * 0.55, s * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.4); ctx.lineTo(cx, cy - s * 0.85); ctx.lineWidth = s * 0.36; ctx.stroke();
    ctx.lineWidth = Math.max(2, s * 0.1);
    for (const k of [-0.55, -0.25, 0.05]) { ctx.beginPath(); ctx.moveTo(cx + s * 0.32, cy + s * k); ctx.lineTo(cx + s * 0.55, cy + s * k); ctx.stroke(); }
  } else if (kind === 'plant') {
    ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.9); ctx.lineTo(cx, cy - s * 0.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.05); ctx.quadraticCurveTo(cx - s * 0.95, cy - s * 0.05, cx - s * 0.75, cy - s * 0.85);
    ctx.quadraticCurveTo(cx - s * 0.05, cy - s * 0.65, cx, cy + s * 0.05); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.15); ctx.quadraticCurveTo(cx + s * 0.95, cy - s * 0.3, cx + s * 0.7, cy - s * 0.95);
    ctx.quadraticCurveTo(cx + s * 0.05, cy - s * 0.8, cx, cy - s * 0.15); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - s * 0.6, cy + s * 0.9); ctx.lineTo(cx + s * 0.6, cy + s * 0.9); ctx.stroke();
  } else if (kind === 'snow') {
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3;
      ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * s, cy - Math.sin(a) * s); ctx.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s); ctx.stroke();
    }
  } else if (kind === 'wind') {
    for (const [dy, len] of [[-0.45, 1.5], [0.05, 1.8], [0.55, 1.2]]) {
      ctx.beginPath(); ctx.moveTo(cx - s * 0.9, cy + s * dy); ctx.lineTo(cx - s * 0.9 + s * len, cy + s * dy); ctx.stroke();
    }
  } else if (kind === 'drop') {
    ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.quadraticCurveTo(cx + s * 0.8, cy, cx + s * 0.55, cy + s * 0.5);
    ctx.arc(cx, cy + s * 0.35, s * 0.58, 0.25, Math.PI - 0.25); ctx.quadraticCurveTo(cx - s * 0.8, cy, cx, cy - s); ctx.fill();
  } else if (kind === 'paw') {
    ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.35, s * 0.42, s * 0.34, 0, 0, Math.PI * 2); ctx.fill();
    for (const [dx, dy] of [[-0.55, -0.15], [-0.2, -0.6], [0.2, -0.6], [0.55, -0.15]]) { ctx.beginPath(); ctx.arc(cx + s * dx, cy + s * dy, s * 0.17, 0, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.beginPath(); ctx.arc(cx, cy - s * 0.55, s * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.15); ctx.lineTo(cx, cy + s * 0.75); ctx.stroke();
  }
  ctx.restore();
}
