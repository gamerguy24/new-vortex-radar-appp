// Template: Ice Accumulation — single regional map shaded by ice amount, with
// a stepped inches color scale across the bottom and a day label under the map.
import { fitProjection } from '../engine/projection.js';
import { backgroundLayer, landLayer, BASEMAP_OPTIONS } from '../engine/basemap.js';
import { choroplethLayer } from '../engine/choropleth.js';
import { titleBarLayer } from '../engine/chrome.js';
import { gradientScaleLayer } from '../engine/legend.js';
import { cityLabelLayer } from '../engine/labels.js';
import { ICE_SCALE, scaleColor, effectiveScale } from '../engine/scales.js';
import { countiesForStates, REGION_PRESETS } from '../engine/geo.js';

export default {
  id: 'ice-accum',
  label: 'Ice Accumulation',
  scale: ICE_SCALE.map((s) => ({ id: s.value, label: s.value, color: s.color })),
  brushFrom: 'scale',

  defaultConfig() {
    return {
      title: 'Ice Accumulation',
      subtitle: 'This Week',
      region: 'oklahoma',
      basemap: 'relief',
      dayLabel: 'Monday',
      values: {}, // fips -> ice value string
      autofill: false, // start colorless — users paint their own colors
    };
  },

  fields() {
    return [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      { key: 'region', label: 'Region', type: 'select',
        options: Object.entries(REGION_PRESETS).filter(([k]) => k !== 'conus').map(([k, v]) => ({ value: k, label: v.label })) },
      { key: 'dayLabel', label: 'Day label', type: 'text' },
      { key: 'basemap', label: 'Basemap', type: 'select', options: BASEMAP_OPTIONS },
      { key: 'paint', label: 'Ice amount (inches)', type: 'paint' },
    ];
  },

  build(scene, geo, config, ctrl) {
    // Working scale (id = inch value); users can rename/recolor via config._scale.
    const base = ICE_SCALE.map((s) => ({ id: s.value, label: s.value, color: s.color }));
    const scale = effectiveScale(base, config);
    const preset = REGION_PRESETS[config.region] || REGION_PRESETS.oklahoma;
    const counties = countiesForStates(geo, preset.states || ['OK']);
    const mapRect = { x0: 520, y0: 330, x1: 1400, y1: 820 };
    const projection = fitProjection('mercator', counties, mapRect, { pad: 8 });
    scene.projection = projection;

    // Deterministic demo: an ice bullseye centered in-region, decreasing outward.
    if (config.autofill && Object.keys(config.values).length === 0) {
      const cs = counties.map((f) => ({ f, c: d3.geoCentroid(f) }));
      const cLon = cs.reduce((s, x) => s + x.c[0], 0) / cs.length;
      const cLat = cs.reduce((s, x) => s + x.c[1], 0) / cs.length;
      const order = ['1.0', '.75', '.50', '.25', '.10'];
      const maxD = Math.max(...cs.map((x) => Math.hypot(x.c[0] - cLon, x.c[1] - cLat)));
      for (const { f, c } of cs) {
        const d = Math.hypot(c[0] - cLon, c[1] - cLat) / (maxD || 1);
        const idx = Math.min(order.length - 1, Math.floor(d * order.length));
        config.values[f.fips] = order[idx];
      }
    }

    scene.clearLayers();
    scene.add(backgroundLayer(config.basemap, { ocean: '#0c1a2e' }));
    scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyFeatures: counties, borderMesh: geo.stateBorders }));
    scene.add(choroplethLayer({
      features: counties,
      keyFn: (f) => f.fips,
      valueOf: (k) => config.values[k] ?? null,
      colorOf: (v) => scaleColor(scale, v),
      opacity: 0.85,
      onPaint: (key) => {
        const b = ctrl.getBrush();
        if (b == null || b === 'erase') delete config.values[key];
        else config.values[key] = b;
        ctrl.rerender();
      },
    }));
    scene.add(cityLabelLayer({ maxRank: 2, fontSize: 17, bounds: mapRect }));

    scene.add(titleBarLayer({ title: config.title, subtitle: config.subtitle, rect: { x: 180, y: 90, w: 1560, h: 150 } }));

    // Day label directly under the map
    scene.add({ name: 'day', draw(ctx) {
      const w = 360, h = 52, x = (520 + 1400) / 2 - w / 2, y = 832;
      ctx.fillStyle = '#0a0f17'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#37c0ff'; ctx.fillRect(x, y + h, w, 3);
      ctx.fillStyle = '#fff'; ctx.font = '900 32px "Segoe UI", Arial Black, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(config.dayLabel).toUpperCase(), x + w / 2, y + h / 2 + 1);
      ctx.textAlign = 'left';
    } });

    // Inches scale bottom-center (clear of the day label above)
    if (config.showLegend !== false) {
      scene.add(gradientScaleLayer(
        scale.map((s) => ({ value: s.label, color: s.color })),
        { x: 560, y: 1010, w: 800, h: 28 },
        { unit: 'inches', textColor: '#fff' },
      ));
    }
  },
};
