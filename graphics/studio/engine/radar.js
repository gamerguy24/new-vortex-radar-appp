// Radar layer. Fetches NOAA NEXRAD base reflectivity (an EPSG:4326 PNG from the
// NWS radar ImageServer, routed through Vortex Radar's /api/proxy so there's no
// CORS taint) and warps it onto the studio's d3 projection so it aligns with the
// basemap for any region/projection. Drawn under labels/chrome, over the map.
//
// The raster is equirectangular over its bbox [W,S,E,N], so each output pixel's
// [lon,lat] (from projection.invert) maps linearly into the source image.

const RADAR_SERVICE =
  'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer/exportImage';

// CONUS clamp. albersUsa insets (AK/HI) make a full-canvas invert balloon the
// bbox, and regional projections never exceed CONUS, so intersecting with this
// gives a sane request in both cases.
const CONUS = { W: -125, S: 24, E: -66.5, N: 50 };

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('radar image decode failed')); };
    img.src = url;
  });
}

// Geographic bbox [W,S,E,N] covering the current view, from the projection.
function geoBbox(scene) {
  const p = scene.projection;
  if (!p || !p.invert) return [CONUS.W, CONUS.S, CONUS.E, CONUS.N];
  let W = Infinity, S = Infinity, E = -Infinity, N = -Infinity;
  const nx = 40, ny = 24;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const ll = p.invert([scene.width * i / nx, scene.height * j / ny]);
      if (!ll) continue;
      const [lon, lat] = ll;
      if (!isFinite(lon) || !isFinite(lat)) continue;
      if (lon < W) W = lon; if (lon > E) E = lon;
      if (lat < S) S = lat; if (lat > N) N = lat;
    }
  }
  // Intersect with CONUS (clamps albersUsa outliers; no-op for regional views).
  W = Math.max(W, CONUS.W); E = Math.min(E, CONUS.E);
  S = Math.max(S, CONUS.S); N = Math.min(N, CONUS.N);
  if (!(isFinite(W) && isFinite(S) && E > W && N > S)) {
    return [CONUS.W, CONUS.S, CONUS.E, CONUS.N];
  }
  const px = (E - W) * 0.02, py = (N - S) * 0.02;
  return [W - px, S - py, E + px, N + py];
}

// Fetch the latest reflectivity raster for the scene's current view.
export async function fetchRadar(scene, { opacity = 0.8 } = {}) {
  const bbox = geoBbox(scene);
  const [W, S, E, N] = bbox;
  const ow = 1200;
  const oh = Math.max(1, Math.round(ow * (N - S) / (E - W)));
  const svcUrl = `${RADAR_SERVICE}?bbox=${W},${S},${E},${N}&bboxSR=4326&imageSR=4326`
    + `&size=${ow},${oh}&format=png32&transparent=true&f=image`;
  const res = await fetch(`/api/proxy?url=${svcUrl}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const img = await blobToImage(await res.blob());
  return { img, bbox, opacity };
}

// Source pixel cache (decode the raster to an ImageData once).
function ensureSource(radar) {
  if (radar._src) return radar._src;
  const rw = radar.img.naturalWidth || radar.img.width;
  const rh = radar.img.naturalHeight || radar.img.height;
  const c = document.createElement('canvas');
  c.width = rw; c.height = rh;
  const g = c.getContext('2d');
  g.drawImage(radar.img, 0, 0);
  radar._src = { data: g.getImageData(0, 0, rw, rh).data, rw, rh };
  return radar._src;
}

// A cheap signature of the projection geometry so we only re-warp when the
// projection actually changes (not on every unrelated rerender).
function projSig(scene) {
  const p = scene.projection;
  const pts = [[-98, 39], [-118, 34], [-80, 42]];
  let s = `${scene.width}x${scene.height}|`;
  for (const pt of pts) { const q = p(pt); s += q ? `${Math.round(q[0])},${Math.round(q[1])};` : 'n;'; }
  return s;
}

// Warp the equirectangular raster into projection space at reduced resolution
// (radar is fuzzy, so upscaling on draw is fine and keeps rerenders fast).
function warp(radar, scene) {
  const p = scene.projection;
  if (!p || !p.invert) return null;
  const [W, S, E, N] = radar.bbox;
  const { data: sd, rw, rh } = ensureSource(radar);

  const OW = Math.min(900, scene.width);
  const scale = OW / scene.width;
  const OH = Math.max(1, Math.round(scene.height * scale));
  const inv = 1 / scale;

  const out = document.createElement('canvas');
  out.width = OW; out.height = OH;
  const octx = out.getContext('2d');
  const img = octx.createImageData(OW, OH);
  const od = img.data;
  const dLon = E - W, dLat = N - S;

  for (let oy = 0; oy < OH; oy++) {
    const sy = oy * inv;
    for (let ox = 0; ox < OW; ox++) {
      const ll = p.invert([ox * inv, sy]);
      if (!ll) continue;
      const u = (ll[0] - W) / dLon;
      const v = (N - ll[1]) / dLat;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const si = (((v * rh) | 0) * rw + ((u * rw) | 0)) * 4;
      const di = (oy * OW + ox) * 4;
      od[di] = sd[si]; od[di + 1] = sd[si + 1]; od[di + 2] = sd[si + 2]; od[di + 3] = sd[si + 3];
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function getWarp(radar, scene) {
  const sig = projSig(scene);
  if (radar._warp && radar._warp.sig === sig) return radar._warp.canvas;
  const canvas = warp(radar, scene);
  radar._warp = { sig, canvas };
  return canvas;
}

// Scene layer for the composited radar. `radar` is the object from fetchRadar().
export function radarLayer(radar) {
  return {
    name: 'radar',
    draw(ctx, scene) {
      if (!radar || !radar.img) return;
      const warped = getWarp(radar, scene);
      if (!warped) return;
      ctx.save();
      ctx.globalAlpha = radar.opacity == null ? 0.8 : radar.opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(warped, 0, 0, scene.width, scene.height);
      ctx.restore();
    },
  };
}
