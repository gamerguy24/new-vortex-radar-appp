// Template: Forecast Model (Futurecast) — a full-frame broadcast map for pro
// users, showing either a forecast-model field (GFS/NAM/HRRR: 2 m temp,
// reflectivity, MSLP, CAPE, precip, upper-air temps…) at a chosen hour, OR live
// NEXRAD radar. Pick the overlay in the properties panel. Data (model field via
// /api/models/:id/field, radar via the studio radar service) loads asynchronously
// and the scene re-renders when it arrives. County/state lines are drawn over the
// overlay so the map stays legible.
import { fitProjection } from '../engine/projection.js';
import { backgroundLayer, landLayer, BASEMAP_OPTIONS } from '../engine/basemap.js';
import { cityLabelLayer } from '../engine/labels.js';
import { bannerHeaderLayer } from '../engine/chrome.js';
import { roundRect } from '../engine/scene.js';
import { REGION_PRESETS, countiesForStates } from '../engine/geo.js';
import { fetchRadar, radarLayer } from '../engine/radar.js';
import {
  MODEL_OPTIONS, MODEL_PRESETS, FHR_OPTIONS, loadModelField, modelFieldLayer, fieldLegendLayer,
} from '../engine/model_field.js';

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const REFLECT_LEGEND = { unit: 'dBZ', stops: [[5, 'rgb(34,197,94)'], [20, 'rgb(0,160,0)'], [35, 'rgb(255,255,0)'], [45, 'rgb(255,144,0)'], [55, 'rgb(255,0,0)'], [65, 'rgb(255,0,255)'], [75, 'rgb(160,0,160)']] };

// Async load state (module-scoped): one model-field request + one radar request.
const fieldStore = { key: null, status: 'idle', field: null, error: null };
const radarStore = { key: null, status: 'idle', radar: null, error: null };

// Visible lon/lat rectangle (padded) for the field request, so the overlay
// covers the whole frame with margin to spare.
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
  const r = (x) => Math.round(x * 2) / 2; // 0.5° grid stabilizes the request key
  return [Math.max(-179, r(W)), Math.max(-85, r(S)), Math.min(179, r(E)), Math.min(85, r(N))];
}

function noteLayer(text, color = '#dfe9ff') {
  return {
    name: 'model-note',
    draw(ctx, scene) {
      ctx.font = `700 30px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width + 44, x = scene.width / 2 - w / 2, y = scene.height / 2 - 30;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
      roundRect(ctx, x, y, w, 60, 12); ctx.fillStyle = 'rgba(9,14,24,0.92)'; ctx.fill(); ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; roundRect(ctx, x, y, w, 60, 12); ctx.stroke();
      ctx.fillStyle = color; ctx.fillText(text, scene.width / 2, y + 30);
    },
  };
}

export default {
  id: 'forecast-model',
  label: 'Forecast Model (Futurecast)',
  scale: null,

  defaultConfig() {
    return {
      overlay: 'field',   // 'field' = model field, 'radar' = live NEXRAD
      model: 'gfs',
      field: 't2m',
      fhr: '24',
      region: 'southeast',
      basemap: 'relief',
      title: '',
      opacity: '0.85',
      showLegend: true,
    };
  },

  fields() {
    return [
      { key: 'overlay', label: 'Overlay', type: 'select', options: [
        { value: 'field', label: 'Forecast field (model)' },
        { value: 'radar', label: 'Live radar (NEXRAD)' }] },
      { key: 'model', label: 'Model', type: 'select', options: MODEL_OPTIONS },
      { key: 'field', label: 'Field', type: 'select', options: MODEL_PRESETS.map((p) => ({ value: p.id, label: p.label })) },
      { key: 'fhr', label: 'Forecast hour', type: 'select', options: FHR_OPTIONS },
      { key: 'region', label: 'Region', type: 'select',
        options: Object.entries(REGION_PRESETS).map(([k, v]) => ({ value: k, label: v.label })) },
      { key: 'basemap', label: 'Basemap', type: 'select', options: BASEMAP_OPTIONS },
      { key: 'opacity', label: 'Overlay opacity', type: 'select', options: [
        { value: '1', label: '100%' }, { value: '0.85', label: '85%' }, { value: '0.7', label: '70%' }, { value: '0.55', label: '55%' }] },
      { key: 'title', label: 'Title (blank = auto)', type: 'text' },
      { key: 'showLegend', label: 'Show legend', type: 'toggle' },
    ];
  },

  build(scene, geo, config, ctrl) {
    const preset = MODEL_PRESETS.find((p) => p.id === config.field) || MODEL_PRESETS[0];
    const rp = REGION_PRESETS[config.region] || REGION_PRESETS.southeast;
    const nationView = rp.states == null;
    const feats = nationView ? geo.states : countiesForStates(geo, rp.states || ['GA']);
    // Full-bleed map (header + legend overlay it); overscan avoids edge gaps.
    const mapRect = { x0: -40, y0: -30, x1: 1960, y1: 1110 };
    scene.projection = fitProjection(nationView ? 'albersUsa' : 'mercator', feats, mapRect, { pad: 8 });

    scene.clearLayers();
    scene.add(backgroundLayer(config.basemap));
    scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyMesh: geo.countyBorders, borderMesh: geo.stateBorders }));

    const opacity = parseFloat(config.opacity) || 0.85;
    const bbox = viewBbox(scene);
    const isRadar = config.overlay === 'radar';
    let ready = false, legend = null, legendTitle = '', headTitle = '', headRegion = '', headDate = '';

    if (isRadar) {
      // ── live radar overlay ──
      const key = `${config.region}|${bbox.join(',')}`;
      if (radarStore.key !== key) {
        radarStore.key = key; radarStore.status = 'loading'; radarStore.error = null;
        fetchRadar(scene, { opacity })
          .then((rd) => { if (radarStore.key === key) { radarStore.radar = rd; radarStore.status = 'ready'; ctrl.rerender(); } })
          .catch((e) => { if (radarStore.key === key) { radarStore.status = 'error'; radarStore.error = e.message; radarStore.radar = null; ctrl.rerender(); } });
      }
      ready = radarStore.status === 'ready' && radarStore.radar && radarStore.key === key;
      if (ready) {
        radarStore.radar.opacity = opacity;
        scene.add(radarLayer(radarStore.radar));
        scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyMesh: geo.countyBorders, borderMesh: geo.stateBorders, override: { land: 'rgba(0,0,0,0)', relief: false } }));
      }
      legend = REFLECT_LEGEND; legendTitle = 'Base Reflectivity';
      headTitle = (config.title && config.title.trim()) || 'Live Radar';
      headRegion = 'NEXRAD base reflectivity';
      if (radarStore.status === 'loading') scene.add(cityLabelLayer({ maxRank: nationView ? 2 : 3, fontSize: 18, bounds: { x0: 20, y0: 150, x1: 1900, y1: 1050 } }));
    } else {
      // ── forecast-model field overlay ──
      const key = `${config.model}|${config.field}|${config.fhr}|${bbox.join(',')}`;
      if (fieldStore.key !== key) {
        fieldStore.key = key; fieldStore.status = 'loading'; fieldStore.error = null;
        loadModelField(config.model, config.field, config.fhr, bbox)
          .then((f) => { if (fieldStore.key === key) { fieldStore.field = f; fieldStore.status = 'ready'; ctrl.rerender(); } })
          .catch((e) => { if (fieldStore.key === key) { fieldStore.status = 'error'; fieldStore.error = e.message; fieldStore.field = null; ctrl.rerender(); } });
      }
      ready = fieldStore.status === 'ready' && fieldStore.field && fieldStore.key === key;
      if (ready) {
        scene.add(modelFieldLayer(fieldStore.field, opacity));
        scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyMesh: geo.countyBorders, borderMesh: geo.stateBorders, override: { land: 'rgba(0,0,0,0)', relief: false } }));
      }
      legend = ready ? fieldStore.field.legend : null;
      legendTitle = (config.title && config.title.trim()) || preset.label;
      headTitle = (config.title && config.title.trim()) || preset.label;
      const fhrLabel = ready ? `+${fieldStore.field.fhr} h` : `+${config.fhr} h`;
      headRegion = `${config.model.toUpperCase()} · ${fhrLabel}`;
      headDate = ready && fieldStore.field.validTime ? `Valid ${fieldStore.field.validTime}` : '';
    }

    // City labels above the overlay + borders.
    scene.add(cityLabelLayer({ maxRank: nationView ? 2 : 3, fontSize: 18, bounds: { x0: 20, y0: 150, x1: 1900, y1: 1050 } }));

    scene.add(bannerHeaderLayer({ title: headTitle, region: headRegion, date: headDate, rect: { x: 36, y: 24, w: 1180, h: 64 } }));

    if (config.showLegend !== false && ready && legend) {
      scene.add(fieldLegendLayer(legend, { x: 460, y: 1000, w: 1000, h: 74 }, { title: legendTitle }));
    }

    const status = isRadar ? radarStore.status : fieldStore.status;
    const error = isRadar ? radarStore.error : fieldStore.error;
    if (status === 'loading') scene.add(noteLayer(isRadar ? 'Loading live radar…' : `Loading ${config.model.toUpperCase()} · ${preset.label}…`));
    else if (status === 'error') scene.add(noteLayer(`⚠ ${error}`, '#ff8a8a'));
  },
};
