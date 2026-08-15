// Template: Forecast Model (Futurecast) — a broadcast model-field map for pro
// users. Renders a GFS/NAM/HRRR field (2 m temp, reflectivity, MSLP, CAPE, precip,
// upper-air temps…) at a chosen forecast hour, using the app's model layer
// (/api/models/:id/field), warped onto the studio map with county/state lines on
// top and a gradient legend. Data loads asynchronously and the scene re-renders
// when it arrives.
import { fitProjection } from '../engine/projection.js';
import { backgroundLayer, landLayer, BASEMAP_OPTIONS } from '../engine/basemap.js';
import { cityLabelLayer } from '../engine/labels.js';
import { bannerHeaderLayer } from '../engine/chrome.js';
import { roundRect } from '../engine/scene.js';
import { REGION_PRESETS, countiesForStates } from '../engine/geo.js';
import {
  MODEL_OPTIONS, MODEL_PRESETS, FHR_OPTIONS, loadModelField, modelFieldLayer, fieldLegendLayer,
} from '../engine/model_field.js';

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

// Async load state for the current field request (module-scoped, one at a time).
const store = { key: null, status: 'idle', field: null, error: null };

function viewBbox(scene) {
  const p = scene.projection;
  if (!p || !p.invert) return [-125, 24, -66.5, 50];
  const cs = [[0, 0], [scene.width, 0], [0, scene.height], [scene.width, scene.height]];
  let W = Infinity, S = Infinity, E = -Infinity, N = -Infinity;
  for (const [x, y] of cs) {
    const ll = p.invert([x, y]);
    if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) continue;
    W = Math.min(W, ll[0]); E = Math.max(E, ll[0]); S = Math.min(S, ll[1]); N = Math.max(N, ll[1]);
  }
  if (!isFinite(W)) return [-125, 24, -66.5, 50];
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
      { key: 'model', label: 'Model', type: 'select', options: MODEL_OPTIONS },
      { key: 'field', label: 'Field', type: 'select', options: MODEL_PRESETS.map((p) => ({ value: p.id, label: p.label })) },
      { key: 'fhr', label: 'Forecast hour', type: 'select', options: FHR_OPTIONS },
      { key: 'region', label: 'Region', type: 'select',
        options: Object.entries(REGION_PRESETS).map(([k, v]) => ({ value: k, label: v.label })) },
      { key: 'basemap', label: 'Basemap', type: 'select', options: BASEMAP_OPTIONS },
      { key: 'opacity', label: 'Field opacity', type: 'select', options: [
        { value: '1', label: '100%' }, { value: '0.85', label: '85%' }, { value: '0.7', label: '70%' }, { value: '0.55', label: '55%' }] },
      { key: 'title', label: 'Title (blank = field name)', type: 'text' },
      { key: 'showLegend', label: 'Show legend', type: 'toggle' },
    ];
  },

  build(scene, geo, config, ctrl) {
    const preset = MODEL_PRESETS.find((p) => p.id === config.field) || MODEL_PRESETS[0];
    const preset0 = REGION_PRESETS[config.region] || REGION_PRESETS.southeast;
    const nationView = preset0.states == null;
    const feats = nationView ? geo.states : countiesForStates(geo, preset0.states || ['GA']);
    const mapRect = { x0: 10, y0: 200, x1: 1910, y1: 1055 };
    scene.projection = fitProjection(nationView ? 'albersUsa' : 'mercator', feats, mapRect, { pad: 12 });

    scene.clearLayers();
    scene.add(backgroundLayer(config.basemap));
    scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyMesh: geo.countyBorders, borderMesh: geo.stateBorders }));

    // Kick off the async field load when the request (model/field/hour/view) changes.
    const bbox = viewBbox(scene);
    const key = `${config.model}|${config.field}|${config.fhr}|${bbox.join(',')}`;
    if (store.key !== key) {
      store.key = key; store.status = 'loading'; store.error = null;
      loadModelField(config.model, config.field, config.fhr, bbox)
        .then((f) => { if (store.key === key) { store.field = f; store.status = 'ready'; ctrl.rerender(); } })
        .catch((e) => { if (store.key === key) { store.status = 'error'; store.error = e.message; store.field = null; ctrl.rerender(); } });
    }
    const ready = store.status === 'ready' && store.field && store.key === key;

    // Field under the borders: draw the field, then re-stroke borders/counties on
    // top (transparent land fill) so lines stay crisp over the colors.
    if (ready) {
      scene.add(modelFieldLayer(store.field, parseFloat(config.opacity) || 0.85));
      scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyMesh: geo.countyBorders, borderMesh: geo.stateBorders, override: { land: 'rgba(0,0,0,0)', relief: false } }));
    }

    scene.add(cityLabelLayer({ maxRank: nationView ? 2 : 3, fontSize: 18, bounds: { x0: 20, y0: 200, x1: 1900, y1: 1050 } }));

    const fhrLabel = ready ? `+${store.field.fhr} h` : `+${config.fhr} h`;
    const valid = ready ? store.field.validTime : '';
    scene.add(bannerHeaderLayer({
      title: (config.title && config.title.trim()) || preset.label,
      region: `${config.model.toUpperCase()} · ${fhrLabel}`,
      date: valid ? `Valid ${valid}` : '',
      rect: { x: 36, y: 24, w: 1180, h: 64 },
    }));

    if (config.showLegend !== false && ready && store.field.legend) {
      scene.add(fieldLegendLayer(store.field.legend, { x: 460, y: 1000, w: 1000, h: 74 }, { title: (config.title && config.title.trim()) || preset.label }));
    }

    if (store.status === 'loading') scene.add(noteLayer(`Loading ${config.model.toUpperCase()} · ${preset.label}…`));
    else if (store.status === 'error') scene.add(noteLayer(`⚠ ${store.error}`, '#ff8a8a'));
  },
};
