// Template: Severe Storm Threat — regional county choropleth on a 5-level
// threat scale, with the boxed "STORM THREATS" icon legend and city labels.
import { fitProjection } from '../engine/projection.js';
import { backgroundLayer, landLayer, BASEMAP_OPTIONS } from '../engine/basemap.js';
import { choroplethLayer } from '../engine/choropleth.js';
import { cityLabelLayer } from '../engine/labels.js';
import { categoricalLegendLayer } from '../engine/legend.js';
import { bannerHeaderLayer, threatBoxLayer } from '../engine/chrome.js';
import { THREAT_SCALE, scaleColor, effectiveScale } from '../engine/scales.js';
import { countiesForStates, REGION_PRESETS } from '../engine/geo.js';

export default {
  id: 'severe-threat',
  label: 'Severe Storm Threat',
  scale: THREAT_SCALE,
  brushFrom: 'scale', // studio shows the threat scale as paint brushes

  defaultConfig() {
    return {
      title: 'Severe Storm Threat',
      region: 'ne-indiana',
      date: 'Thu August 1',
      basemap: 'satellite',
      levels: {}, // fips -> 1..5
      autofill: false, // start colorless — users paint their own colors
      threats: [
        { icon: 'hail', text: 'Isolated Hail' },
        { icon: 'wind', text: 'Isolated 60 mph winds' },
        { icon: 'tornado', text: 'Very low tornado threat' },
        { icon: 'flood', text: 'Localized flooding' },
      ],
    };
  },

  fields() {
    return [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'region', label: 'Region', type: 'select',
        options: Object.entries(REGION_PRESETS).filter(([k]) => k !== 'conus').map(([k, v]) => ({ value: k, label: v.label })) },
      { key: 'date', label: 'Date label', type: 'text' },
      { key: 'basemap', label: 'Basemap', type: 'select',
        options: BASEMAP_OPTIONS },
      { key: 'paint', label: 'Threat levels', type: 'paint' },
      { key: 'threats', label: 'Storm threats list', type: 'threats' },
    ];
  },

  build(scene, geo, config, ctrl) {
    const scale = effectiveScale(THREAT_SCALE, config);
    const preset = REGION_PRESETS[config.region] || REGION_PRESETS['ne-indiana'];
    const abbrs = preset.states || ['IN', 'OH'];
    const counties = countiesForStates(geo, abbrs);

    const mapRect = { x0: 20, y0: 215, x1: 1900, y1: 1060 };
    const projection = fitProjection('mercator', counties, mapRect, { pad: 10 });
    scene.projection = projection;

    // Auto-populate a plausible diagonal split the first time (deterministic).
    if (config.autofill && Object.keys(config.levels).length === 0) {
      const lats = counties.map((f) => d3.geoCentroid(f)[1]).sort((a, b) => a - b);
      const median = lats[Math.floor(lats.length / 2)];
      for (const f of counties) {
        const lat = d3.geoCentroid(f)[1];
        config.levels[f.fips] = lat < median ? 2 : 1;
      }
    }

    scene.clearLayers();
    scene.add(backgroundLayer(config.basemap));
    scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyMesh: geo.countyBorders, borderMesh: geo.stateBorders }));
    scene.add(choroplethLayer({
      features: counties,
      keyFn: (f) => f.fips,
      valueOf: (k) => config.levels[k] ?? null,
      colorOf: (id) => scaleColor(scale, id),
      opacity: 0.62,
      onPaint: (key) => {
        const b = ctrl.getBrush();
        if (b == null || b === 'erase') delete config.levels[key];
        else config.levels[key] = b;
        ctrl.rerender();
      },
    }));
    scene.add(cityLabelLayer({ maxRank: 3, fontSize: 17, bounds: mapRect }));

    // Chrome
    scene.add(bannerHeaderLayer({
      title: config.title, region: preset.label, date: config.date,
      rect: { x: 36, y: 24, w: 1180, h: 64 },
    }));
    if (config.showLegend !== false) {
      scene.add(categoricalLegendLayer(
        scale.map((s) => ({ label: s.label, color: s.color })),
        { x: 36, y: 150, w: 1848, h: 46 },
        { border: 2, borderColor: 'rgba(255,255,255,0.8)' },
      ));
    }
    scene.add(threatBoxLayer({
      title: 'Storm Threats', items: config.threats,
      rect: { x: 60, y: 250, w: 300 },
    }));
  },
};
