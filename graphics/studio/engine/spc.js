// Shared SPC categorical outlook helpers. The studio imports day1/2/3 GeoJSON
// through Dome's /spc/* proxy; this module turns those features into a layer and
// resolves each polygon's risk category to our OUTLOOK scale.
import { makeScreenPathFactory } from './choropleth.js';
import { OUTLOOK_SCALE, scaleColor } from './scales.js';

const SPC_LABEL_MAP = {
  TSTM: 'TSTM', MRGL: 'MRGL', SLGT: 'SLGT', ENH: 'ENH', MDT: 'MDT', HIGH: 'HIGH',
  2: 'TSTM', 3: 'MRGL', 4: 'SLGT', 5: 'ENH', 6: 'MDT', 8: 'HIGH',
};

// Low risk first so higher categories sit on top.
export const SPC_ORDER = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'];

export function spcCategoryOf(feature) {
  const p = feature.properties || {};
  const raw = p.LABEL || p.label || p.DN || p.dn || p.category;
  return SPC_LABEL_MAP[raw] || (typeof raw === 'string' ? raw.toUpperCase() : null);
}

// featureCollection: GeoJSON FeatureCollection from SPC; projected with the
// scene's current projection so it lands in the right place on any map.
export function spcOutlookLayer({ featureCollection, scale = OUTLOOK_SCALE, opacity = 0.78 }) {
  const feats = (featureCollection && featureCollection.features ? featureCollection.features : [])
    .slice()
    .sort((a, b) => SPC_ORDER.indexOf(spcCategoryOf(a)) - SPC_ORDER.indexOf(spcCategoryOf(b)));
  return {
    name: 'spc-outlook',
    draw(ctx, s) {
      const path = makeScreenPathFactory(s.projection);
      ctx.globalAlpha = opacity;
      for (const f of feats) {
        const color = scaleColor(scale, spcCategoryOf(f));
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fill(path(f));
      }
      ctx.globalAlpha = 1;
    },
  };
}
