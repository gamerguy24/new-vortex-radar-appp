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

  const pad = opts.pad ?? 0;
  projection.fitExtent(
    [[rect.x0 + pad, rect.y0 + pad], [rect.x1 - pad, rect.y1 - pad]],
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
