// Template: National Severe Weather Outlook — CONUS map with SPC-style
// categorical risk areas. Risk geometry can be imported live from SPC (via the
// server proxy) or assigned by state with the paint tool as a fallback.
import { fitProjection } from '../engine/projection.js';
import { backgroundLayer, landLayer } from '../engine/basemap.js';
import { choroplethLayer } from '../engine/choropleth.js';
import { cityLabelLayer } from '../engine/labels.js';
import { categoricalLegendLayer } from '../engine/legend.js';
import { flagHeaderLayer, brandingLayer } from '../engine/chrome.js';
import { OUTLOOK_SCALE, scaleColor, effectiveScale } from '../engine/scales.js';
import { spcOutlookLayer } from '../engine/spc.js';

export default {
  id: 'outlook',
  label: 'Severe Weather Outlook (National)',
  scale: OUTLOOK_SCALE,
  brushFrom: 'scale',

  defaultConfig() {
    return {
      flag: 'Severe Weather',
      title: 'Severe Weather Outlook',
      subtitle: 'Today',
      basemap: 'relief',
      branding: 'Oklahoma\nWeather Network',
      stateLevels: {}, // fips -> scale id (manual fallback)
      spcFeatures: null, // GeoJSON FeatureCollection imported from SPC
    };
  },

  fields() {
    return [
      { key: 'flag', label: 'Flag text', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      { key: 'basemap', label: 'Basemap', type: 'select',
        options: ['relief', 'dark', 'flat', 'satellite'].map((v) => ({ value: v, label: v })) },
      { key: 'branding', label: 'Branding (bug)', type: 'text' },
      { key: 'importSpc', label: 'SPC live data', type: 'action', action: 'import-spc' },
      { key: 'paint', label: 'Manual risk (paint states)', type: 'paint' },
    ];
  },

  build(scene, geo, config, ctrl) {
    const scale = effectiveScale(OUTLOOK_SCALE, config);
    const mapRect = { x0: 0, y0: 150, x1: 1920, y1: 1080 };
    const projection = fitProjection('albersUsa', geo.nation, mapRect, { pad: 20 });
    scene.projection = projection;

    scene.clearLayers();
    scene.add(backgroundLayer(config.basemap));
    scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, borderMesh: geo.stateBorders }));

    if (config.spcFeatures && config.spcFeatures.features?.length) {
      // Draw imported SPC categorical polygons (shared layer; low risk first).
      scene.add(spcOutlookLayer({ featureCollection: config.spcFeatures, scale }));
    } else {
      // Manual fallback: paint by state.
      scene.add(choroplethLayer({
        features: geo.states,
        keyFn: (f) => f.fips,
        valueOf: (k) => config.stateLevels[k] ?? null,
        colorOf: (id) => scaleColor(scale, id),
        opacity: 0.72,
        onPaint: (key) => {
          const b = ctrl.getBrush();
          if (b == null || b === 'erase') delete config.stateLevels[key];
          else config.stateLevels[key] = b;
          ctrl.rerender();
        },
      }));
    }

    scene.add(flagHeaderLayer({
      flag: config.flag, title: config.title, subtitle: config.subtitle,
      rect: { x: 24, y: 22, w: 1500, h: 70 },
    }));
    if (config.showLegend !== false) {
      scene.add(categoricalLegendLayer(
        scale.map((s) => ({ label: s.label, color: s.color })),
        { x: 470, y: 96, w: 1054, h: 36 },
        { border: 1.5, borderColor: 'rgba(0,0,0,0.4)' },
      ));
    }
    // City labels last so the paint never covers them.
    scene.add(cityLabelLayer({ maxRank: 1, fontSize: 26, bounds: mapRect }));
    if (config.branding) {
      scene.add(brandingLayer({ text: config.branding, rect: { x: 30, y: 940, w: 230, h: 120 } }));
    }
  },
};
