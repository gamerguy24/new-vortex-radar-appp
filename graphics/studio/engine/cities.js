// Bundled city database for label placement. [name, lat, lon, rank].
// rank 1 = major metro (always show), 2 = regional, 3 = local.
// Coordinates are decimal degrees (lon negative = west).
export const CITIES = [
  // National majors
  ['New York', 40.71, -74.01, 1], ['Los Angeles', 34.05, -118.24, 1],
  ['Chicago', 41.88, -87.63, 1], ['Houston', 29.76, -95.37, 1],
  ['Phoenix', 33.45, -112.07, 1], ['Philadelphia', 39.95, -75.17, 1],
  ['San Antonio', 29.42, -98.49, 1], ['San Diego', 32.72, -117.16, 1],
  ['Dallas', 32.78, -96.80, 1], ['San Jose', 37.34, -121.89, 1],
  ['Denver', 39.74, -104.99, 1], ['Seattle', 47.61, -122.33, 1],
  ['Miami', 25.76, -80.19, 1], ['Atlanta', 33.75, -84.39, 1],
  ['Boston', 42.36, -71.06, 1], ['Minneapolis', 44.98, -93.27, 1],
  ['Detroit', 42.33, -83.05, 1], ['Memphis', 35.15, -90.05, 1],
  ['Charlotte', 35.23, -80.84, 1], ['Kansas City', 39.10, -94.58, 1],
  ['Las Vegas', 36.17, -115.14, 1], ['Portland', 45.52, -122.68, 1],
  ['Albuquerque', 35.08, -106.65, 1], ['Oklahoma City', 35.47, -97.52, 1],
  ['Nashville', 36.16, -86.78, 1], ['Salt Lake City', 40.76, -111.89, 1],
  ['New Orleans', 29.95, -90.07, 1], ['St. Louis', 38.63, -90.20, 1],
  ['Indianapolis', 39.77, -86.16, 1], ['Columbus', 39.96, -82.99, 1],
  ['Milwaukee', 43.04, -87.91, 1], ['Cincinnati', 39.10, -84.51, 1],
  ['Tampa', 27.95, -82.46, 1], ['Orlando', 28.54, -81.38, 1],
  ['Pittsburgh', 40.44, -79.99, 1], ['Sacramento', 38.58, -121.49, 1],
  ['San Francisco', 37.77, -122.42, 1], ['Washington', 38.91, -77.04, 1],
  ['Buffalo', 42.89, -78.88, 1], ['Cleveland', 41.50, -81.69, 1],
  // Canada / Mexico context labels for national maps
  ['Calgary', 51.05, -114.07, 1], ['Winnipeg', 49.90, -97.14, 1],
  ['Montreal', 45.50, -73.57, 1], ['Vancouver', 49.28, -123.12, 1],
  ['Toronto', 43.65, -79.38, 1], ['Monterrey', 25.69, -100.32, 1],
  ['Chihuahua', 28.63, -106.07, 1], ['Culiacan', 24.81, -107.39, 1],
  ['Juarez', 31.69, -106.42, 1],
  // Regional (rank 2)
  ['Reno', 39.53, -119.81, 2], ['Tulsa', 36.15, -95.99, 2],
  ['Wichita', 37.69, -97.34, 2], ['Salina', 38.84, -97.61, 2],
  ['Medford', 42.33, -122.87, 2], ['Bend', 44.06, -121.31, 2],
  ['Chico', 39.73, -121.84, 2], ['Bakersfield', 35.37, -119.02, 2],
  ['Fort Wayne', 41.08, -85.14, 2], ['Lima', 40.74, -84.11, 2],
  ['Wabash', 40.80, -85.82, 2], ['Marion', 40.56, -85.66, 2],
  ['Toledo', 41.66, -83.58, 2], ['Dayton', 39.76, -84.19, 2],
  ['Fort Worth', 32.76, -97.33, 2], ['Tucson', 32.22, -110.97, 2],
  ['El Paso', 31.76, -106.49, 2], ['Omaha', 41.26, -95.93, 2],
  ['Des Moines', 41.59, -93.62, 2], ['Little Rock', 34.75, -92.29, 2],
  ['Birmingham', 33.52, -86.81, 2], ['Jacksonville', 30.33, -81.66, 2],
  ['Louisville', 38.25, -85.76, 2], ['Grand Rapids', 42.96, -85.67, 2],
  // Local (rank 3) - cover the NE Indiana / NW Ohio threat scene
  ['Elkhart', 41.68, -85.98, 3], ['Angola', 41.63, -84.99, 3],
  ['Bryan', 41.47, -84.55, 3], ['Auburn', 41.37, -85.06, 3],
  ['Warsaw', 41.24, -85.85, 3], ['Defiance', 41.28, -84.36, 3],
  ['Ottawa', 41.02, -84.05, 3], ['Decatur', 40.83, -84.93, 3],
  ['Bluffton', 40.74, -85.17, 3], ['Celina', 40.55, -84.57, 3],
];

// Project + place city labels with simple collision avoidance.
// Returns the subset to draw, each with screen x,y.
export function placeCities(projection, bounds, opts = {}) {
  const minRank = opts.maxRank || 3;
  const placed = [];
  const boxes = [];
  const pad = opts.pad ?? 46;
  for (const [name, lat, lon, rank] of CITIES) {
    if (rank > minRank) continue;
    const p = projection([lon, lat]);
    if (!p) continue;
    const [x, y] = p;
    if (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1) continue;
    const w = name.length * 9 + 34;
    const box = { x0: x - 6, y0: y - 12, x1: x - 6 + w, y1: y + 12 };
    if (boxes.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1))) continue;
    boxes.push(box);
    placed.push({ name, x, y, rank });
  }
  return placed;
}
