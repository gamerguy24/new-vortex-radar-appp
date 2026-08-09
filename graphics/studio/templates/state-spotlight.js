// Template: State Spotlight — zooms the map to fill the frame with ONE state's
// counties for a "state by state" broadcast walkthrough. Paint per-county data
// (forecast conditions / precip type / threat level), with the state name as a
// header, city labels, and a matching legend. Switch states one at a time.
import { fitProjection } from '../engine/projection.js';
import { backgroundLayer, landLayer, BASEMAP_OPTIONS } from '../engine/basemap.js';
import { choroplethLayer, outlineLayer } from '../engine/choropleth.js';
import { cityLabelLayer } from '../engine/labels.js';
import { categoricalLegendLayer } from '../engine/legend.js';
import { bannerHeaderLayer } from '../engine/chrome.js';
import { CONDITIONS_SCALE, THREAT_SCALE, PRECIP_SCALE, OUTLOOK_SCALE, scaleColor } from '../engine/scales.js';
import { spcOutlookLayer } from '../engine/spc.js';
import { STATE_NAMES, ABBR_STATE_FIPS } from '../engine/geo.js';

const DATASETS = {
  conditions: { label: 'Forecast conditions', scale: CONDITIONS_SCALE },
  precip: { label: 'Precip type', scale: PRECIP_SCALE },
  threat: { label: 'Severe threat', scale: THREAT_SCALE },
};

export default {
  id: 'state-spotlight',
  label: 'State Spotlight (state by state)',
  // Dynamic: brushes follow the chosen dataset (see getScale + studio.js).
  // config._scale holds the user's renamed/recolored levels (cleared on dataset
  // switch by the studio) so "change the paint data" works per dataset.
  getScale(config) {
    const base = (DATASETS[config?.dataset] || DATASETS.conditions).scale;
    return (config && config._scale) || base;
  },

  defaultConfig() {
    return {
      stateAbbr: 'GA',
      dataset: 'conditions',
      basemap: 'satellite',
      subtitle: "Today's Forecast",
      date: '',
      showCities: true,
      showSpc: false,     // overlay the live SPC categorical outlook
      spcDay: '1',        // which SPC outlook day to show (1/2/3)
      spcFeatures: null,  // imported GeoJSON FeatureCollection
      values: {}, // fips -> scale id
      autofill: false, // start colorless — users paint their own colors
    };
  },

  fields() {
    const states = Object.entries(STATE_NAMES)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([abbr, name]) => ({ value: abbr, label: name }));
    return [
      { key: 'stateAbbr', label: 'State', type: 'select', options: states },
      { key: 'dataset', label: 'Data set', type: 'select',
        options: Object.entries(DATASETS).map(([k, v]) => ({ value: k, label: v.label })) },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      { key: 'date', label: 'Date label (optional)', type: 'text' },
      { key: 'basemap', label: 'Basemap', type: 'select',
        options: BASEMAP_OPTIONS },
      { key: 'showCities', label: 'Show city labels', type: 'toggle' },
      { key: 'showSpc', label: 'Show current SPC outlook', type: 'toggle' },
      { key: 'spcDay', label: 'SPC outlook day', type: 'select',
        options: [{ value: '1', label: 'Day 1' }, { value: '2', label: 'Day 2' }, { value: '3', label: 'Day 3' }] },
      { key: 'importSpc', label: 'SPC live data', type: 'action', action: 'import-spc' },
      { key: 'paint', label: 'Paint data', type: 'paint' },
    ];
  },

  build(scene, geo, config, ctrl) {
    const abbr = config.stateAbbr || 'GA';
    const fips = ABBR_STATE_FIPS[abbr];
    const stateFeature = geo.stateByFips.get(fips);
    const counties = (geo.countiesByState.get(fips) || []);
    const scale = this.getScale(config);

    // Fill the frame with the state; leave room for the header (top) + legend (bottom).
    const mapRect = { x0: 70, y0: 210, x1: 1850, y1: 1010 };
    const projection = fitProjection('mercator', counties, mapRect, { pad: 10 });
    scene.projection = projection;

    // First-time demo fill: a west-to-east gradient across the dataset's scale.
    if (config.autofill && Object.keys(config.values).length === 0) {
      const cs = counties.map((f) => ({ f, lon: d3.geoCentroid(f)[0] }));
      const lons = cs.map((x) => x.lon);
      const min = Math.min(...lons), max = Math.max(...lons);
      for (const { f, lon } of cs) {
        const t = (lon - min) / ((max - min) || 1);
        const idx = Math.min(scale.length - 1, Math.floor(t * scale.length));
        config.values[f.fips] = scale[idx].id;
      }
    }

    scene.clearLayers();
    scene.add(backgroundLayer(config.basemap));
    // Context: all states as land, then the focal state's counties + bold outline.
    scene.add(landLayer({ styleName: config.basemap, landFeatures: geo.states, countyFeatures: counties, borderMesh: geo.stateBorders }));
    scene.add(choroplethLayer({
      features: counties,
      keyFn: (f) => f.fips,
      valueOf: (k) => config.values[k] ?? null,
      colorOf: (id) => scaleColor(scale, id),
      opacity: 0.7,
      onPaint: (key) => {
        const b = ctrl.getBrush();
        if (b == null || b === 'erase') delete config.values[key];
        else config.values[key] = b;
        ctrl.rerender();
      },
    }));
    // Live SPC categorical outlook, overlaid on the spotlighted state.
    if (config.showSpc && config.spcFeatures) {
      scene.add(spcOutlookLayer({ featureCollection: config.spcFeatures, opacity: 0.6 }));
    }
    if (stateFeature) scene.add(outlineLayer({ features: [stateFeature], color: '#ffffff', width: 3.5 }));

    // Header: big state name + subtitle, optional date pill.
    scene.add(bannerHeaderLayer({
      title: STATE_NAMES[abbr] || abbr,
      region: config.subtitle,
      date: config.date || null,
      rect: { x: 40, y: 28, w: 1180, h: 70 },
    }));

    // Legend strip, bottom-center (optional). When the SPC outlook is shown it
    // labels the risk categories; otherwise it labels the painted data set.
    if (config.showLegend !== false) {
      const legendScale = (config.showSpc && config.spcFeatures) ? OUTLOOK_SCALE : scale;
      const legendW = Math.min(1400, legendScale.length * 220);
      scene.add(categoricalLegendLayer(
        legendScale.map((s) => ({ label: s.label, color: s.color })),
        { x: (1920 - legendW) / 2, y: 1018, w: legendW, h: 44 },
        { border: 2, borderColor: 'rgba(255,255,255,0.7)' },
      ));
    }

    // City labels last so they sit on top of the paint and the legend strip.
    if (config.showCities) scene.add(cityLabelLayer({ maxRank: 2, fontSize: 24, bounds: mapRect }));
  },
};
