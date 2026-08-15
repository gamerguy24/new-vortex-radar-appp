// Basemap layers. We render a styled vector basemap (no external tiles, so
// exports are never tainted and it works offline). Three looks approximate the
// broadcast styles in the reference graphics:
//   'relief'    - neutral gray land on deep-blue ocean (national outlook look)
//   'satellite' - dark green-gray land (regional severe-threat look)
//   'flat'      - clean light cartographic
import { canvasPath } from './projection.js';

const STYLES = {
  relief: { ocean: '#0a3a66', land: '#8d9094', border: '#ffffff', borderW: 1.8, county: 'rgba(15,22,34,0.85)', countyW: 1.4, countyHalo: 'rgba(255,255,255,0.25)', countyHaloW: 2.8 },
  satellite: { ocean: '#0b1c2c', land: '#5b6b52', border: '#f4faf4', borderW: 1.8, county: 'rgba(255,255,255,0.95)', countyW: 1.6, countyHalo: 'rgba(0,0,0,0.6)', countyHaloW: 3.4 },
  flat: { ocean: '#cfe4f5', land: '#e9ede2', border: '#5a6673', borderW: 1.8, county: 'rgba(60,74,92,0.9)', countyW: 1.4 },
  dark: { ocean: '#060b14', land: '#1d2738', border: '#6f84ac', borderW: 1.8, county: 'rgba(165,190,225,0.85)', countyW: 1.5, countyHalo: 'rgba(0,0,0,0.5)', countyHaloW: 3.0 },
  // Real MapTiler satellite imagery (composited by engine/satellite.js). The
  // land fill is transparent so the photo shows through — this layer only paints
  // the ocean fallback + crisp white borders/counties on top of the imagery.
  hybrid: { ocean: '#0b1c2c', land: 'rgba(0,0,0,0)', border: '#ffffff', borderW: 2.2, county: 'rgba(255,255,255,0.95)', countyW: 1.6, countyHalo: 'rgba(0,0,0,0.6)', countyHaloW: 3.6, borderHalo: 'rgba(0,0,0,0.6)', borderHaloW: 4.8, relief: false },
};

export function getBasemapStyle(name) {
  return STYLES[name] || STYLES.relief;
}

// Basemap choices offered on every (single-map) template's Basemap dropdown.
// 'hybrid' is real MapTiler satellite imagery; the rest are procedural styles.
export const BASEMAP_OPTIONS = [
  { value: 'hybrid', label: 'Satellite photo' },
  { value: 'satellite', label: 'Satellite (styled)' },
  { value: 'relief', label: 'Relief' },
  { value: 'flat', label: 'Flat' },
  { value: 'dark', label: 'Dark' },
];

// Background fill (ocean / sky). Optional subtle vertical gradient for depth.
export function backgroundLayer(styleName, override = {}) {
  const s = { ...getBasemapStyle(styleName), ...override };
  return {
    name: 'background',
    draw(ctx, scene) {
      const g = ctx.createLinearGradient(0, 0, 0, scene.height);
      g.addColorStop(0, shade(s.ocean, 1.15));
      g.addColorStop(1, shade(s.ocean, 0.85));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, scene.width, scene.height);
    },
  };
}

// Land + borders. `landFeatures` = states for fill, `countyFeatures` optional
// for thin internal county lines, `borderMesh` for crisp state outlines.
export function landLayer({ styleName, landFeatures, countyFeatures, countyMesh, borderMesh, override = {} }) {
  const s = { ...getBasemapStyle(styleName), ...override };
  return {
    name: 'land',
    draw(ctx, scene) {
      const path = canvasPath(scene.projection, ctx);
      // Land fill
      ctx.beginPath();
      for (const f of landFeatures) path(f);
      ctx.fillStyle = s.land;
      ctx.fill();
      // Subtle relief shading: lighten top edge (skipped for photo basemaps so
      // the imagery isn't dimmed).
      if (s.relief !== false) {
        ctx.save();
        ctx.clip();
        const g = ctx.createLinearGradient(0, scene.height * 0.2, 0, scene.height);
        g.addColorStop(0, 'rgba(255,255,255,0.06)');
        g.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, scene.width, scene.height);
        ctx.restore();
      }
      // County lines. Prefer a border MESH (each shared edge drawn exactly once)
      // for clean, crisp lines; fall back to per-polygon strokes if only feature
      // geometry is provided. A dark halo underneath keeps lines legible on photo
      // basemaps (set countyHalo in the style).
      if (s.countyW > 0 && (countyMesh || countyFeatures)) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (countyMesh) path(countyMesh);
        else for (const f of countyFeatures) path(f);
        if (s.countyHalo) {
          ctx.lineWidth = s.countyHaloW || s.countyW + 2;
          ctx.strokeStyle = s.countyHalo;
          ctx.stroke();
        }
        ctx.lineWidth = s.countyW;
        ctx.strokeStyle = s.county;
        ctx.stroke();
      }
      // State borders (with an optional dark halo, same idea).
      if (borderMesh) {
        ctx.lineJoin = 'round';
        ctx.beginPath();
        path(borderMesh);
        if (s.borderHalo) {
          ctx.lineWidth = s.borderHaloW || s.borderW + 2.5;
          ctx.strokeStyle = s.borderHalo;
          ctx.stroke();
        }
        ctx.lineWidth = s.borderW;
        ctx.strokeStyle = s.border;
        ctx.stroke();
      }
    },
  };
}

// Lighten/darken a hex color by factor (>1 lighter, <1 darker).
export function shade(hex, factor) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * factor)));
  g = Math.max(0, Math.min(255, Math.round(g * factor)));
  b = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `rgb(${r},${g},${b})`;
}
