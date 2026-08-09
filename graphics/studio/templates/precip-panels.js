// Template: Day-to-Day Precip — a row of small regional maps (one per day),
// each shaded by precipitation type. Title bar + categorical legend on top.
import { fitProjection } from '../engine/projection.js';
import { landLayer, getBasemapStyle } from '../engine/basemap.js';
import { makeScreenPathFactory } from '../engine/choropleth.js';
import { categoricalLegendLayer } from '../engine/legend.js';
import { titleBarLayer as bigTitle } from '../engine/chrome.js';
import { PRECIP_SCALE, scaleColor, effectiveScale } from '../engine/scales.js';
import { countiesForStates, REGION_PRESETS } from '../engine/geo.js';
import { roundRect } from '../engine/scene.js';

export default {
  id: 'precip-panels',
  label: 'Day-to-Day Precip (panels)',
  scale: PRECIP_SCALE,
  brushFrom: 'scale',
  multiPanel: true,

  defaultConfig() {
    return {
      title: 'Day-to-Day Precip',
      region: 'california',
      basemap: 'dark',
      days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      panels: [{}, {}, {}, {}, {}], // each: { fips: precipType }
      autofill: false, // start colorless — users paint their own colors
    };
  },

  fields() {
    return [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'region', label: 'Region', type: 'select',
        options: Object.entries(REGION_PRESETS).filter(([k]) => k !== 'conus').map(([k, v]) => ({ value: k, label: v.label })) },
      { key: 'days', label: 'Day labels (comma sep)', type: 'csv' },
      { key: 'activePanel', label: 'Editing day', type: 'panelpick' },
      { key: 'paint', label: 'Precip type', type: 'paint' },
    ];
  },

  build(scene, geo, config, ctrl) {
    const scale = effectiveScale(PRECIP_SCALE, config);
    const preset = REGION_PRESETS[config.region] || REGION_PRESETS.california;
    const counties = countiesForStates(geo, preset.states || ['CA']);
    const days = config.days;
    while (config.panels.length < days.length) config.panels.push({});

    // Deterministic demo fill the first time: a precip band sweeping across days.
    if (config.autofill && config.panels.every((p) => Object.keys(p).length === 0)) {
      const lons = counties.map((f) => d3.geoCentroid(f)[0]);
      const minLon = Math.min(...lons), maxLon = Math.max(...lons);
      const types = ['rain', 'rain', 'snow', 'frz', 'rain'];
      days.forEach((_, di) => {
        const band = minLon + ((di + 1) / (days.length + 1)) * (maxLon - minLon);
        for (const f of counties) {
          const lon = d3.geoCentroid(f)[0];
          if (Math.abs(lon - band) < (maxLon - minLon) * 0.16) config.panels[di][f.fips] = types[di % types.length];
        }
      });
    }

    scene.clearLayers();
    // dark background
    scene.add({ name: 'bg', draw(ctx, s) {
      const g = ctx.createLinearGradient(0, 0, 0, s.height);
      g.addColorStop(0, '#0b1622'); g.addColorStop(1, '#060d16');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s.width, s.height);
    } });

    // Title bar + legend
    scene.add(bigTitle({ title: config.title, rect: { x: 160, y: 110, w: 1680, h: 120 } }));
    if (config.showLegend !== false) {
      scene.add(categoricalLegendLayer(
        scale.map((s) => ({ label: s.label, color: s.color })),
        { x: 196, y: 250, w: 1180, h: 44 },
      ));
    }

    // Panels
    const n = days.length;
    const gap = 18;
    const x0 = 160, x1 = 1840, y0 = 330, y1 = 980;
    const pw = (x1 - x0 - gap * (n - 1)) / n;
    const style = getBasemapStyle(config.basemap);
    for (let i = 0; i < n; i++) {
      const px = x0 + i * (pw + gap);
      const rect = { x0: px, y0, x1: px + pw, y1 };
      const proj = fitProjection('mercator', counties, rect, { pad: 6 });
      const fills = config.panels[i] || {};
      const dayLabel = days[i];
      const active = (config.activePanel ?? 0) === i;
      scene.add(makePanelLayer({ proj, counties, style, fills, rect, dayLabel, active, geo, config, ctrl, scale, panelIndex: i }));
    }
  },
};

function makePanelLayer({ proj, counties, style, fills, rect, dayLabel, active, geo, config, ctrl, scale, panelIndex }) {
  return {
    name: 'panel-' + panelIndex,
    draw(ctx, scene) {
      const path = makeScreenPathFactory(proj);
      // clip to panel
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      ctx.clip();
      // ocean/land
      ctx.fillStyle = style.ocean;
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      ctx.fillStyle = style.land;
      for (const f of geo.states) ctx.fill(path(f));
      // precip fills
      ctx.globalAlpha = 0.9;
      for (const f of counties) {
        const t = fills[f.fips];
        if (!t) continue;
        ctx.fillStyle = scaleColor(scale, t);
        ctx.fill(path(f));
      }
      ctx.globalAlpha = 1;
      // county + state borders as clean meshes (each shared edge drawn once),
      // clipped to this panel — no double-stroking, so lines stay crisp.
      const geoPath = d3.geoPath(proj, ctx);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); geoPath(geo.countyBorders); ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
      ctx.beginPath(); geoPath(geo.stateBorders); ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.restore();

      // hit areas for painting this panel (only when it's the active panel)
      if (active && ctrl) {
        for (const f of counties) {
          scene.registerHit(path(f), { key: f.fips }, () => {
            const b = ctrl.getBrush();
            if (b == null || b === 'erase') delete fills[f.fips];
            else fills[f.fips] = b;
            ctrl.rerender();
          });
        }
      }
      // panel frame + active highlight
      ctx.lineWidth = active ? 4 : 1.5;
      ctx.strokeStyle = active ? '#37c0ff' : 'rgba(255,255,255,0.25)';
      ctx.strokeRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      // day label bar
      const lh = 54;
      ctx.fillStyle = '#0a0f17';
      ctx.fillRect(rect.x0, rect.y1 + 8, rect.x1 - rect.x0, lh);
      ctx.fillStyle = '#37c0ff';
      ctx.fillRect(rect.x0, rect.y1 + 8 + lh, rect.x1 - rect.x0, 3);
      ctx.fillStyle = '#fff';
      ctx.font = '900 32px "Segoe UI", Arial Black, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(dayLabel, (rect.x0 + rect.x1) / 2, rect.y1 + 8 + lh / 2 + 1);
      ctx.textAlign = 'left';
    },
  };
}
