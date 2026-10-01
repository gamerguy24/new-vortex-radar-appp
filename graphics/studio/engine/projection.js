// Projection helpers built on d3-geo (loaded globally as `d3`). Fits a
// projection to a set of features inside a screen rectangle so any region
// renders crisp and centered.

// type: 'albersUsa' (national, insets AK/HI) | 'albers' (regional conic) |
//       'mercator'. `features` is a GeoJSON FeatureCollection or array.
export function fitProjection(type, features, rect, opts = {}) {
  const fc = Array.isArray(features)
    ? { type: 'FeatureCollection', features }
    : features.type === 'FeatureCollection'
      ? features
      : { type: 'FeatureCollection', features: [features] };

  let projection;
  switch (type) {
    case 'albersUsa':
      projection = d3.geoAlbersUsa();
      break;
    case 'mercator':
      projection = d3.geoMercator();
      break;
    case 'albers':
    default:
      // Regional conic; parallels tuned for mid-US, rotated to data centroid.
      projection = d3.geoAlbers()
        .rotate([opts.lon0 ?? 96, 0])
        .center([0, opts.lat0 ?? 38])
        .parallels(opts.parallels ?? [29.5, 45.5]);
      break;
  }

  /*
   * PULL THE SUBJECT BACK FROM THE EDGES.
   *
   * fitExtent fills the rectangle, so a state or a county group ran right to
   * the frame edge — and the templates draw their title, legend and brand
   * blocks OVER the map, so the subject ended up under the furniture. On a
   * 1920px canvas the old pads (6-20px) were invisible.
   *
   * `inset` is a FRACTION of the shorter side rather than pixels, so a small
   * panel in a multi-panel template gets the same proportion of breathing room
   * as a full-frame map. Capped so a very small rectangle cannot invert.
   */
  const pad = opts.pad ?? 0;
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  const inset = opts.inset ?? 0.08;
  const p = Math.min(pad + inset * Math.min(w, h), 0.4 * Math.min(w, h));

  projection.fitExtent(
    [[rect.x0 + p, rect.y0 + p], [rect.x1 - p, rect.y1 - p]],
    fc,
  );
  return projection;
}

// d3.geoPath bound to a canvas 2D context for fill/stroke rendering.
export function canvasPath(projection, ctx) {
  return d3.geoPath(projection, ctx);
}

// Centroid of a feature in screen space (for label placement on polygons).
export function featureCentroid(projection, feature) {
  const c = d3.geoCentroid(feature);
  return projection(c);
}
