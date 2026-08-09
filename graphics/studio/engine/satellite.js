// Satellite basemap layer. Fetches MapTiler satellite (the imagery behind the
// "hybrid" style) as Web-Mercator XYZ tiles, stitches the tiles that cover the
// current view into a mosaic, then warps that mosaic onto the studio's d3
// projection so it aligns with the vector overlays for ANY region/projection.
//
// Mirrors engine/radar.js, but the source is Web-Mercator (not equirectangular),
// so the per-pixel sampling converts [lon,lat] -> mercator instead of linear.
// Tiles are requested with crossOrigin='anonymous' (MapTiler sends CORS), so the
// export canvas stays untainted and PNG/PSD export keeps working.

const MAPTILER_KEY = 'qxmpCQ9C1wiG4IoFz2dn';
const TILE_URL = (z, x, y) => `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${MAPTILER_KEY}`;
const TILE = 512;          // MapTiler satellite tiles are 512px
const MAX_ZOOM = 19;
const MAX_TILES = 240;     // safety cap on a single mosaic

// CONUS clamp — matches radar.js so albersUsa insets don't balloon the bbox.
const CONUS = { W: -125, S: 24, E: -66.5, N: 50 };

// Web-Mercator normalized coordinates (0..1).
function lon2mx(lon) { return (lon + 180) / 360; }
function lat2my(lat) {
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

// Geographic bbox [W,S,E,N] covering the current view, from the projection.
function geoBbox(scene) {
  const p = scene.projection;
  if (!p || !p.invert) return [CONUS.W, CONUS.S, CONUS.E, CONUS.N];
  let W = Infinity, S = Infinity, E = -Infinity, N = -Infinity;
  const nx = 40, ny = 24;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const ll = p.invert([(scene.width * i) / nx, (scene.height * j) / ny]);
      if (!ll) continue;
      const [lon, lat] = ll;
      if (!isFinite(lon) || !isFinite(lat)) continue;
      if (lon < W) W = lon; if (lon > E) E = lon;
      if (lat < S) S = lat; if (lat > N) N = lat;
    }
  }
  W = Math.max(W, CONUS.W); E = Math.min(E, CONUS.E);
  S = Math.max(S, CONUS.S); N = Math.min(N, CONUS.N);
  if (!(isFinite(W) && isFinite(S) && E > W && N > S)) {
    return [CONUS.W, CONUS.S, CONUS.E, CONUS.N];
  }
  const px = (E - W) * 0.03, py = (N - S) * 0.03;
  return [W - px, S - py, E + px, N + py];
}

// Pick a zoom whose tile resolution roughly matches the output resolution,
// then step down until the tile count is under the mosaic cap.
function planTiles(bbox, scene) {
  const [W, S, E, N] = bbox;
  const spanX = lon2mx(E) - lon2mx(W);
  const spanY = lat2my(S) - lat2my(N);
  const world = Math.max(scene.width / (spanX || 1e-6), scene.height / (spanY || 1e-6));
  let z = Math.max(3, Math.min(MAX_ZOOM, Math.round(Math.log2(world / TILE))));
  let plan;
  while (z >= 3) {
    const n = Math.pow(2, z);
    const x0 = Math.floor(lon2mx(W) * n), x1 = Math.floor(lon2mx(E) * n);
    const y0 = Math.floor(lat2my(N) * n), y1 = Math.floor(lat2my(S) * n);
    const cols = x1 - x0 + 1, rows = y1 - y0 + 1;
    if (cols * rows <= MAX_TILES) { plan = { z, n, x0, x1, y0, y1, cols, rows }; break; }
    z -= 1;
  }
  return plan;
}

function loadTile(z, x, y) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = TILE_URL(z, x, y);
  });
}

// A short signature of what imagery the current view needs, so we only refetch
// when the region/zoom actually changes (not on every unrelated rerender).
export function satelliteSig(scene) {
  const p = planTiles(geoBbox(scene), scene);
  if (!p) return 'none';
  return `${p.z}:${p.x0},${p.x1},${p.y0},${p.y1}:${scene.width}x${scene.height}`;
}

// Fetch + stitch the tile mosaic covering the current view.
export async function fetchSatellite(scene) {
  const bbox = geoBbox(scene);
  const plan = planTiles(bbox, scene);
  if (!plan) throw new Error('could not plan satellite tiles');
  const { z, n, x0, x1, y0, y1, cols, rows } = plan;

  const mosaic = document.createElement('canvas');
  mosaic.width = cols * TILE; mosaic.height = rows * TILE;
  const mctx = mosaic.getContext('2d');

  const jobs = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      jobs.push(loadTile(z, x, y).then((img) => {
        if (img) mctx.drawImage(img, (x - x0) * TILE, (y - y0) * TILE, TILE, TILE);
      }));
    }
  }
  await Promise.all(jobs);

  return {
    mosaic,
    worldPx: n * TILE,          // total mercator pixels at this zoom
    originX: x0 * TILE,         // mosaic's top-left in global mercator pixels
    originY: y0 * TILE,
    mw: mosaic.width,
    mh: mosaic.height,
    bbox,
  };
}

// Read the mosaic pixels once (for fast per-pixel sampling in the warp).
function ensureSource(sat) {
  if (sat._src) return sat._src;
  const g = sat.mosaic.getContext('2d');
  sat._src = g.getImageData(0, 0, sat.mw, sat.mh).data;
  return sat._src;
}

// A cheap signature of the projection geometry (same idea as radar.js).
function projSig(scene) {
  const p = scene.projection;
  const pts = [[-98, 39], [-118, 34], [-80, 42]];
  let s = `${scene.width}x${scene.height}|`;
  for (const pt of pts) { const q = p(pt); s += q ? `${Math.round(q[0])},${Math.round(q[1])};` : 'n;'; }
  return s;
}

// Warp the mercator mosaic into projection space at a good resolution.
function warp(sat, scene) {
  const p = scene.projection;
  if (!p || !p.invert) return null;
  const sd = ensureSource(sat);
  const { worldPx, originX, originY, mw, mh } = sat;

  const OW = Math.min(1600, scene.width);
  const scale = OW / scene.width;
  const OH = Math.max(1, Math.round(scene.height * scale));
  const inv = 1 / scale;

  const out = document.createElement('canvas');
  out.width = OW; out.height = OH;
  const octx = out.getContext('2d');
  const oimg = octx.createImageData(OW, OH);
  const od = oimg.data;

  for (let oy = 0; oy < OH; oy++) {
    const sy = oy * inv;
    for (let ox = 0; ox < OW; ox++) {
      const ll = p.invert([ox * inv, sy]);
      if (!ll) continue;
      const gx = lon2mx(ll[0]) * worldPx - originX;
      const gy = lat2my(ll[1]) * worldPx - originY;
      if (gx < 0 || gy < 0 || gx >= mw || gy >= mh) continue;
      const si = (((gy | 0) * mw) + (gx | 0)) * 4;
      const di = (oy * OW + ox) * 4;
      od[di] = sd[si]; od[di + 1] = sd[si + 1]; od[di + 2] = sd[si + 2]; od[di + 3] = 255;
    }
  }
  octx.putImageData(oimg, 0, 0);
  return out;
}

function getWarp(sat, scene) {
  const sig = projSig(scene);
  if (sat._warp && sat._warp.sig === sig) return sat._warp.canvas;
  const canvas = warp(sat, scene);
  sat._warp = { sig, canvas };
  return canvas;
}

// Scene layer that blits the warped satellite imagery. Drawn just above the
// ocean background and below the (transparent-land) border/label layers.
export function satelliteLayer(sat) {
  return {
    name: 'satellite',
    draw(ctx, scene) {
      if (!sat || !sat.mosaic) return;
      const warped = getWarp(sat, scene);
      if (!warped) return;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(warped, 0, 0, scene.width, scene.height);
      ctx.restore();
    },
  };
}
