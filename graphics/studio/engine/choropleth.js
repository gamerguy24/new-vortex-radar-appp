// Choropleth layer: fills geographic features by an assigned category value and
// registers each as a clickable hit area so the studio's paint tool can cycle a
// county/area's level by clicking it. Builds a Path2D per feature in SCREEN
// space (projected) so canvas hit-testing and crisp fills both work.

// features: array of GeoJSON features (each with a stable key via keyFn)
// valueOf(key) -> category id | null ; colorOf(category) -> fill color
// onPaint(key) optional click handler for editing.
export function choroplethLayer({
  features, keyFn, valueOf, colorOf, opacity = 0.55,
  stroke = 'rgba(255,255,255,0.35)', strokeW = 0.8, onPaint = null, registerHits = true,
}) {
  return {
    name: 'choropleth',
    draw(ctx, scene) {
      const path = makeScreenPathFactory(scene.projection);
      ctx.globalAlpha = opacity;
      for (const f of features) {
        const key = keyFn(f);
        const cat = valueOf(key);
        const p2d = path(f);
        if (cat != null) {
          ctx.fillStyle = colorOf(cat);
          ctx.fill(p2d);
        }
        if (registerHits && onPaint) {
          scene.registerHit(p2d, { key, feature: f }, () => onPaint(key));
        }
      }
      ctx.globalAlpha = 1;
      // outline filled features for definition
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = stroke;
      for (const f of features) {
        if (valueOf(keyFn(f)) != null) ctx.stroke(path(f));
      }
    },
  };
}

// Build a Path2D for a GeoJSON feature using a projection (screen coords).
// Cached per-projection identity to avoid rebuilding every frame is overkill
// here; rendering ~hundreds of polys is fast.
export function makeScreenPathFactory(projection) {
  const geoPath = d3.geoPath(projection);
  return (feature) => {
    const d = geoPath(feature);
    return d ? new Path2D(d) : new Path2D();
  };
}

// Outline a set of features as a bold "region boundary" (e.g. the warned area).
export function outlineLayer({ features, color = '#ffffff', width = 3 }) {
  return {
    name: 'outline',
    draw(ctx, scene) {
      const geoPath = d3.geoPath(scene.projection, ctx);
      ctx.beginPath();
      for (const f of features) geoPath(f);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.lineJoin = 'round';
      ctx.stroke();
    },
  };
}
