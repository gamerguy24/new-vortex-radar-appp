/*
 * 3d/storm3d_worker.js
 * Off-main-thread builder for the 3D storm view. Parses a raw Level-II volume
 * once, then on request grids one product into a box (storm3d_grid.js),
 * contours it at one or more levels (marching cubes) and paints the lowest
 * tilt onto a floor image. The parsed volume and each product's sweeps stay
 * warm, so changing product, area or threshold never re-parses the file.
 *
 * Reflectivity is coloured with the table the radar page is using (sent from
 * the main thread as a lookup table), so a 50 dBZ core is the same colour in
 * 3D as on the map — including uploaded colortables.
 *
 * (c) David Wallis, Twistcaster Live Media LLC 2026
 */

// Use the SAME Buffer build the parser uses (esm.sh node shim), so the
// parser's `instanceof Buffer` check passes.
import { Buffer } from 'https://esm.sh/node/buffer.mjs';
import { Level2Radar } from '../../parse/level2/src/index.js';
import { marchingCubes } from './marching_cubes.js';
import { collectSweeps, gridVolume, groundImage, offsetFromRadar } from './storm3d_grid.js?v=s3d3';

const Z_TOP_M = 20000;              // ~66 kft ceiling
const NX = 240, NY = 240, NZ = 56;  // ~0.4–1.9 km horizontal (by area), 364 m vertical
const GROUND_PX = 1024;
const RECENTRE_LIMIT_M = 300000;    // map centre farther than this → centre on the radar
const MS_TO_KT = 1.94384;

const PRODUCTS = {
  // groundFloor: weakest value painted on the floor. Below 20 dBZ the lowest tilt is
  // mostly clutter and noise, which speckled the whole floor grey.
  REF: { prop: 'reflect',  xform: (v) => v,                       floor: 5,   clear: -10, color: dbzColor, groundFloor: 20 },
  VEL: { prop: 'velocity', xform: (v) => Math.abs(v * MS_TO_KT),  floor: 1,   clear: 0,   color: velColor, signed: (v) => v * MS_TO_KT },
  CC:  { prop: 'rho',      xform: (v) => v,                       floor: 0.2, clear: 0,   color: ccColor },
  ZDR: { prop: 'zdr',      xform: (v) => v,                       floor: -7,  clear: -8,  color: zdrColor },
  KDP: { prop: 'phi',      xform: (v) => v,                       floor: -2,  clear: -3,  color: kdpColor },
  SW:  { prop: 'spectrum', xform: (v) => v * MS_TO_KT,            floor: 0,   clear: -1,  color: swColor },
};

let _radar = null;
let _site = null;                   // { lat, lon }
let _sweeps = {};                   // product → sweeps (cached)
let _grid = null;
let _meta = null;
let _product = 'REF';
let _view = { centre: null, halfExtentM: 120000 };
let _refLut = null;                 // { values, rgb } — the radar page's REF table stops

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.lut !== undefined) _refLut = msg.lut;
    if (msg.type === 'build') {
      _radar = new Level2Radar(Buffer.from(msg.arrayBuffer));
      _site = siteOf(_radar);
      _sweeps = {};
      if (msg.view) _view = msg.view;
      postBuilt(msg.product || 'REF', msg.levels);
    } else if ((msg.type === 'product' || msg.type === 'view') && _radar) {
      if (msg.view) _view = msg.view;
      postBuilt(msg.product || _product, msg.levels);
    } else if (msg.type === 'remarch' && _grid) {
      const shells = contour(msg.levels);
      self.postMessage({ type: 'shells', shells }, shellBuffers(shells));
    } else if (msg.type === 'crossSection' && _grid) {
      const result = buildCrossSection(msg.p1, msg.p2);
      self.postMessage(result, [result.rgba.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};

function siteOf(radar) {
  for (const elev of radar.listElevations()) {
    try {
      radar.setElevation(elev);
      const v = radar.getHeader()[0].volume;
      if (v && Number.isFinite(v.latitude)) return { lat: v.latitude, lon: v.longitude };
    } catch { /* try the next cut */ }
  }
  return null;
}

function sweepsFor(key) {
  if (!_sweeps[key]) {
    const cfg = PRODUCTS[key];
    _sweeps[key] = collectSweeps(_radar, cfg);
    if (!_sweeps[key].length) throw new Error(`This volume has no ${key} data.`);
  }
  return _sweeps[key];
}

// Box centre in metres from the radar: the map centre when it is within
// range, else the radar itself.
function boxCentre() {
  const c = _view.centre;
  if (!c || !_site) return { east: 0, north: 0 };
  const off = offsetFromRadar(_site.lat, _site.lon, c.lat, c.lon);
  return Math.hypot(off.east, off.north) > RECENTRE_LIMIT_M ? { east: 0, north: 0 } : off;
}

function postBuilt(productKey, levels) {
  _product = PRODUCTS[productKey] ? productKey : 'REF';
  const cfg = PRODUCTS[_product];
  const sweeps = sweepsFor(_product);
  const centre = boxCentre();
  const halfExtentM = _view.halfExtentM;
  const g = gridVolume(sweeps, cfg, { centre, halfExtentM, zTopM: Z_TOP_M, nx: NX, ny: NY, nz: NZ });
  _grid = g.grid;
  _meta = {
    nx: NX, ny: NY, nz: NZ, dx: g.dx, dy: g.dy, dz: g.dz, halfExtentM, zTopM: Z_TOP_M,
    // Where the radar is, in box coordinates (metres from the box centre).
    radar: { east: -centre.east, north: -centre.north },
    // Where the box is on the earth, for the map under it.
    site: _site, centre,
    tilts: sweeps.map((s) => +s.angle.toFixed(1)),
  };

  // The floor shows the signed field for velocity (inbound vs outbound).
  const groundCfg = cfg.signed
    ? { ...cfg, xform: cfg.signed, floor: -Infinity, clear: NaN }
    : { ...cfg, floor: cfg.groundFloor ?? cfg.floor };
  const groundSweeps = cfg.signed ? collectSweeps(_radar, groundCfg).slice(0, 1) : sweeps;
  const rgba = groundImage(groundSweeps, groundCfg, { centre, halfExtentM, size: GROUND_PX }, colourFn(_product));

  const shells = contour(levels);
  self.postMessage(
    { type: 'built', product: _product, meta: _meta, shells, ground: { rgba, size: GROUND_PX } },
    [...shellBuffers(shells), rgba.buffer],
  );
}

function contour(levels) {
  return (levels || []).map((level) => {
    const { positions } = marchingCubes(_grid, NX, NY, NZ, level);
    return { level, positions: gridToWorld(positions), normals: fieldNormals(positions) };
  });
}
const shellBuffers = (shells) => shells.flatMap((s) => [s.positions.buffer, s.normals.buffer]);

/*
 * Smooth normals from the field itself: the outward normal of an isosurface is
 * minus the gradient of the value there. Marching cubes hands back separate
 * triangles, so normals computed from the triangles shade every facet flat --
 * the chiselled look. Sampling the gradient at each vertex shades the shells
 * as the smooth surfaces they are.
 *
 * In: grid-index positions. Out: unit normals in (east, north, up) metres.
 */
function fieldNormals(p) {
  const out = new Float32Array(p.length);
  const { dx, dy, dz } = _meta;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    let gx = (trilinear(x + 1, y, z) - trilinear(x - 1, y, z)) / dx;
    let gy = (trilinear(x, y + 1, z) - trilinear(x, y - 1, z)) / dy;
    let gz = (trilinear(x, y, z + 1) - trilinear(x, y, z - 1)) / dz;
    const len = Math.hypot(gx, gy, gz) || 1;
    out[i] = -gx / len; out[i + 1] = -gy / len; out[i + 2] = -gz / len;
  }
  return out;
}
function trilinear(x, y, z) {
  x = Math.min(NX - 1.001, Math.max(0, x)); y = Math.min(NY - 1.001, Math.max(0, y)); z = Math.min(NZ - 1.001, Math.max(0, z));
  const x0 = x | 0, y0 = y | 0, z0 = z | 0, fx = x - x0, fy = y - y0, fz = z - z0;
  const g = _grid, sx = 1, sy = NX, sz = NX * NY, o = x0 + NX * (y0 + NY * z0);
  const c00 = g[o] * (1 - fx) + g[o + sx] * fx, c10 = g[o + sy] * (1 - fx) + g[o + sy + sx] * fx;
  const c01 = g[o + sz] * (1 - fx) + g[o + sz + sx] * fx, c11 = g[o + sz + sy] * (1 - fx) + g[o + sz + sy + sx] * fx;
  return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
}

// Grid index space → metres from the box centre (east, north, height).
function gridToWorld(p) {
  const out = new Float32Array(p.length);
  const h = _meta.halfExtentM;
  for (let i = 0; i < p.length; i += 3) {
    out[i]     = p[i] * _meta.dx - h;
    out[i + 1] = p[i + 1] * _meta.dy - h;
    out[i + 2] = p[i + 2] * _meta.dz;
  }
  return out;
}

// ── colour ────────────────────────────────────────────────────────────────
// Same as lutRgb() in storm3d.js. Below the table's first value: not drawn, as on the map.
function lutColour(v) {
  const vals = _refLut.values, n = vals.length, c = _refLut.rgb;
  if (!(v >= vals[0])) return null;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (vals[mid] <= v) lo = mid; else hi = mid - 1; }
  if (lo === n - 1) return [c[lo * 3], c[lo * 3 + 1], c[lo * 3 + 2]];
  const t = vals[lo + 1] > vals[lo] ? (v - vals[lo]) / (vals[lo + 1] - vals[lo]) : 0;
  return [c[lo * 3] + t * (c[lo * 3 + 3] - c[lo * 3]), c[lo * 3 + 1] + t * (c[lo * 3 + 4] - c[lo * 3 + 1]), c[lo * 3 + 2] + t * (c[lo * 3 + 5] - c[lo * 3 + 2])];
}
function colourFn(product) {
  return product === 'REF' && _refLut ? lutColour : PRODUCTS[product].color;
}

function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0].slice(1);
  if (v >= stops[stops.length - 1][0]) return stops[stops.length - 1].slice(1);
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v < stops[i + 1][0]) {
      const t = (v - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return [
        stops[i][1] + t * (stops[i + 1][1] - stops[i][1]),
        stops[i][2] + t * (stops[i + 1][2] - stops[i][2]),
        stops[i][3] + t * (stops[i + 1][3] - stops[i][3]),
      ];
    }
  }
  return [1, 1, 1];
}
// Fallback when the radar page's table is unavailable.
function dbzColor(d) {
  return ramp([
    [5, 0.40, 0.78, 0.92], [20, 0.12, 0.55, 0.20], [30, 0.10, 0.78, 0.16],
    [35, 1.00, 1.00, 0.30], [45, 1.00, 0.60, 0.10], [50, 0.90, 0.10, 0.10],
    [60, 0.60, 0.00, 0.40], [70, 0.85, 0.40, 0.92], [80, 1.00, 1.00, 1.00],
  ], d);
}
function velColor(kt) {
  return ramp([
    [-100, 0.40, 0.00, 0.50], [-60, 0.00, 0.55, 0.55], [-25, 0.10, 0.85, 0.25],
    [-3, 0.55, 0.62, 0.55], [3, 0.55, 0.55, 0.55], [25, 0.85, 0.20, 0.10],
    [60, 1.00, 0.55, 0.10], [100, 1.00, 1.00, 0.30],
  ], kt);
}
function ccColor(v) {
  return ramp([
    [0.2, 0.06, 0.06, 0.55], [0.7, 0.10, 0.45, 0.95], [0.85, 0.40, 0.95, 0.40],
    [0.92, 1.00, 1.00, 0.00], [0.97, 1.00, 0.55, 0.00], [1.05, 0.65, 0.20, 0.60],
  ], v);
}
function zdrColor(v) {
  return ramp([
    [-2, 0.30, 0.30, 0.35], [0, 0.20, 0.45, 0.70], [1, 0.20, 0.75, 0.35],
    [2, 1.00, 1.00, 0.25], [4, 1.00, 0.55, 0.10], [8, 0.90, 0.10, 0.30],
  ], v);
}
function kdpColor(v) {
  return ramp([
    [-1, 0.30, 0.30, 0.40], [0, 0.25, 0.45, 0.70], [0.5, 0.25, 0.80, 0.40],
    [1.5, 1.00, 1.00, 0.25], [3, 1.00, 0.45, 0.10], [4, 0.90, 0.10, 0.30],
  ], v);
}
function swColor(kt) {
  return ramp([
    [0, 0.15, 0.30, 0.55], [5, 0.20, 0.70, 0.45], [10, 1.00, 1.00, 0.30],
    [15, 1.00, 0.55, 0.10], [25, 0.90, 0.10, 0.30],
  ], kt);
}

// ── Cross-section slice through the grid ─────────────────────────────────────
// Samples along p1→p2 (metres from the box centre) at every height level and
// colours each sample like the floor. Row 0 = ground.
function buildCrossSection(p1, p2) {
  const cfg = PRODUCTS[_product];
  const colour = colourFn(_product);
  const nSamples = 300;
  const width = nSamples, height = NZ;
  const rgba = new Uint8Array(width * height * 4);
  const h = _meta.halfExtentM;

  for (let s = 0; s < nSamples; s++) {
    const t = s / (nSamples - 1);
    const ix = Math.round((p1.east + t * (p2.east - p1.east) + h) / _meta.dx);
    const iy = Math.round((p1.north + t * (p2.north - p1.north) + h) / _meta.dy);
    if (ix < 0 || ix >= NX || iy < 0 || iy >= NY) continue;
    for (let iz = 0; iz < NZ; iz++) {
      const val = _grid[ix + NX * (iy + NY * iz)];
      if (!(val >= cfg.floor)) continue;
      const c = colour(val);
      if (!c) continue;
      const pi = (s + iz * width) * 4;
      rgba[pi] = Math.round(c[0] * 255);
      rgba[pi + 1] = Math.round(c[1] * 255);
      rgba[pi + 2] = Math.round(c[2] * 255);
      rgba[pi + 3] = 230;
    }
  }
  return { type: 'crossSection', rgba, width, height, p1, p2 };
}
