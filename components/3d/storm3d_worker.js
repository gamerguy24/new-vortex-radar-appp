/*
 * 3d/storm3d_worker.js
 * Off-main-thread builder for the 3D storm view. Parses a raw Level-II volume,
 * converts each gate from polar (range, azimuth, elevation) into a Cartesian
 * voxel using the 4/3-earth beam model, and produces, per product
 * (REF / VEL / CC / ZDR / KDP / SW): an isosurface mesh (marching cubes), a
 * ground plan mesh, and grid metadata. The parsed volume is kept warm so
 * switching product or dragging the threshold never re-parses the file.
 *
 * (c) David Wallis, Twistcaster Live Media LLC 2026
 */

// Use the SAME Buffer build the parser uses (esm.sh node shim), so the
// parser's `instanceof Buffer` check passes.
import { Buffer } from 'https://esm.sh/node/buffer.mjs';
import { Level2Radar } from '../../parse/level2/src/index.js';
import { marchingCubes } from './marching_cubes.js';

const HALF_EXTENT_M = 140000;   // +/-140 km horizontal half-width
const Z_TOP_M = 22000;          // 22 km (~72 kft) vertical ceiling
const NX = 200, NY = 200, NZ = 44;
const DX = (2 * HALF_EXTENT_M) / NX;
const DY = (2 * HALF_EXTENT_M) / NY;
const DZ = Z_TOP_M / NZ;
const NODATA = -9999;

const AE = 6371000 * (4 / 3);
const DEG2RAD = Math.PI / 180;
const MS_TO_KT = 1.94384;

const PRODUCTS = {
  REF: { prop: 'reflect',  xform: (v) => v,            floor: 5,   iso: 'value', color: dbzColor },
  VEL: { prop: 'velocity', xform: (v) => v * MS_TO_KT, floor: 1,   iso: 'abs',   color: velColor },
  CC:  { prop: 'rho',      xform: (v) => v,            floor: 0.2, iso: 'value', color: ccColor },
  ZDR: { prop: 'zdr',      xform: (v) => v,            floor: -7,  iso: 'value', color: zdrColor },
  KDP: { prop: 'phi',      xform: (v) => v,            floor: -2,  iso: 'value', color: kdpColor },
  SW:  { prop: 'spectrum', xform: (v) => v * MS_TO_KT, floor: 0,   iso: 'value', color: swColor },
};

let _radar = null;
let _grid = null;
let _meta = null;
let _currentProduct = 'REF';

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'build') {
      _radar = new Level2Radar(Buffer.from(msg.arrayBuffer));
      self.postMessage(...buildForProduct(msg.product || 'REF', msg.threshold ?? 30));
    } else if (msg.type === 'product' && _radar) {
      self.postMessage(...buildForProduct(msg.product, msg.threshold));
    } else if (msg.type === 'remarch' && _grid) {
      const { positions } = marchingCubes(_grid, NX, NY, NZ, msg.threshold);
      const scaled = gridToWorld(positions);
      self.postMessage({ type: 'isosurface', positions: scaled, threshold: msg.threshold }, [scaled.buffer]);
    } else if (msg.type === 'crossSection' && _grid) {
      const result = buildCrossSection(msg.p1, msg.p2);
      self.postMessage(result, [result.rgba.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};

function buildForProduct(productKey, threshold) {
  _currentProduct = productKey;
  const cfg = PRODUCTS[productKey] || PRODUCTS.REF;
  const elevations = _radar.listElevations();
  if (!elevations || elevations.length === 0) throw new Error('Volume has no elevation cuts.');

  _grid = new Float32Array(NX * NY * NZ).fill(NODATA);

  let groundTiltElev = null;
  let groundTiltAngle = Infinity;

  for (const elev of elevations) {
    _radar.setElevation(elev);
    let headers;
    try {
      headers = _radar.getHeader();
    } catch { continue; }
    if (!Array.isArray(headers)) continue;

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const rec = header?.[cfg.prop];
      if (!rec || !rec.moment_data || typeof rec.gate_count !== 'number') continue;
      const elAngle = header.elevation_angle;
      const az = header.azimuth;
      if (!Number.isFinite(elAngle) || !Number.isFinite(az)) continue;

      if (elAngle < groundTiltAngle) { groundTiltAngle = elAngle; groundTiltElev = elev; }

      const elRad = elAngle * DEG2RAD;
      const azRad = az * DEG2RAD;
      const sinAz = Math.sin(azRad), cosAz = Math.cos(azRad);
      const sinEl = Math.sin(elRad), cosEl = Math.cos(elRad);
      const firstGate = rec.first_gate, gateSize = rec.gate_size;

      for (let g = 0; g < rec.gate_count; g++) {
        const raw = rec.moment_data[g];
        if (raw === null || raw === 'rf' || !Number.isFinite(raw)) continue;
        const val = cfg.xform(raw);
        const isoVal = cfg.iso === 'abs' ? Math.abs(val) : val;
        if (isoVal < cfg.floor) continue;

        const r = (firstGate + g * gateSize) * 1000;
        const h = Math.sqrt(r * r + AE * AE + 2 * r * AE * sinEl) - AE;
        if (h < 0 || h >= Z_TOP_M) continue;
        const s = AE * Math.asin((r * cosEl) / (AE + h));
        const ix = ((s * sinAz + HALF_EXTENT_M) / DX) | 0;
        const iy = ((s * cosAz + HALF_EXTENT_M) / DY) | 0;
        const iz = (h / DZ) | 0;
        if (ix < 0 || ix >= NX || iy < 0 || iy >= NY || iz < 0 || iz >= NZ) continue;

        const idx = ix + NX * (iy + NY * iz);
        if (isoVal > _grid[idx]) _grid[idx] = isoVal;
      }
    }
  }

  dilateMax(_grid);

  _meta = { nx: NX, ny: NY, nz: NZ, dx: DX, dy: DY, dz: DZ, halfExtentM: HALF_EXTENT_M, zTopM: Z_TOP_M };

  const { positions } = marchingCubes(_grid, NX, NY, NZ, threshold);
  const isoWorld = gridToWorld(positions);
  const ground = buildGroundPlane(groundTiltElev, cfg);

  return [
    { type: 'built', product: productKey, meta: _meta, threshold, isoPositions: isoWorld, ground },
    [isoWorld.buffer, ground.positions.buffer, ground.colors.buffer],
  ];
}

function gridToWorld(gridPositions) {
  const out = new Float32Array(gridPositions.length);
  for (let i = 0; i < gridPositions.length; i += 3) {
    out[i]     = gridPositions[i] * DX - HALF_EXTENT_M;
    out[i + 1] = gridPositions[i + 1] * DY - HALF_EXTENT_M;
    out[i + 2] = gridPositions[i + 2] * DZ;
  }
  return out;
}

function dilateMax(grid) {
  const src = grid.slice();
  const at = (x, y, z) => src[x + NX * (y + NY * z)];
  for (let z = 0; z < NZ; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const idx = x + NX * (y + NY * z);
        if (src[idx] > NODATA) continue;
        let m = NODATA;
        if (x > 0)      m = Math.max(m, at(x - 1, y, z));
        if (x < NX - 1) m = Math.max(m, at(x + 1, y, z));
        if (y > 0)      m = Math.max(m, at(x, y - 1, z));
        if (y < NY - 1) m = Math.max(m, at(x, y + 1, z));
        if (z > 0)      m = Math.max(m, at(x, y, z - 1));
        if (z < NZ - 1) m = Math.max(m, at(x, y, z + 1));
        if (m > NODATA) grid[idx] = m - 1;
      }
    }
  }
}

function buildGroundPlane(elev, cfg) {
  const positions = [];
  const colors = [];
  if (elev == null) return { positions: new Float32Array(), colors: new Float32Array() };
  _radar.setElevation(elev);
  let headers;
  try {
    headers = _radar.getHeader();
  } catch {
    return { positions: new Float32Array(), colors: new Float32Array() };
  }

  const n = headers.length;
  for (let i = 0; i < n; i++) {
    const rec = headers[i]?.[cfg.prop];
    if (!rec || !rec.moment_data) continue;
    const az1 = headers[i]?.azimuth;
    let az2 = headers[(i + 1) % n]?.azimuth;
    if (!Number.isFinite(az1) || !Number.isFinite(az2)) continue;
    if (Math.abs(az2 - az1) > 180) az2 += (az2 < az1 ? 360 : -360);
    const s1 = Math.sin(az1 * DEG2RAD), c1 = Math.cos(az1 * DEG2RAD);
    const s2 = Math.sin(az2 * DEG2RAD), c2 = Math.cos(az2 * DEG2RAD);
    const firstGate = rec.first_gate, gateSize = rec.gate_size;

    for (let g = 0; g < rec.gate_count - 1; g++) {
      const raw = rec.moment_data[g];
      if (raw === null || raw === 'rf' || !Number.isFinite(raw)) continue;
      const val = cfg.xform(raw);
      const isoVal = cfg.iso === 'abs' ? Math.abs(val) : val;
      if (isoVal < cfg.floor) continue;
      const r1 = (firstGate + g * gateSize) * 1000;
      const r2 = (firstGate + (g + 1) * gateSize) * 1000;
      const ax = r1 * s1, ay = r1 * c1, bx = r2 * s1, by = r2 * c1;
      const cx = r2 * s2, cy = r2 * c2, dx_ = r1 * s2, dy_ = r1 * c2;
      const [cr, cg, cb] = cfg.color(val);
      positions.push(ax, ay, 0, bx, by, 0, cx, cy, 0, ax, ay, 0, cx, cy, 0, dx_, dy_, 0);
      for (let k = 0; k < 6; k++) colors.push(cr, cg, cb);
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
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

// ── Cross-section slice through the voxel grid ─────────────────────────────
// Samples the 3D grid along a horizontal line (p1→p2) at every height level,
// colours each sample with the active product's ramp, and returns RGBA pixels
// ready for use as a DataTexture.
function buildCrossSection(p1, p2) {
  const cfg = PRODUCTS[_currentProduct] || PRODUCTS.REF;
  const nSamples = 200;
  const width = nSamples, height = NZ;
  const rgba = new Uint8Array(width * height * 4);

  for (let s = 0; s < nSamples; s++) {
    const t = s / (nSamples - 1);
    const east  = p1.east  + t * (p2.east  - p1.east);
    const north = p1.north + t * (p2.north - p1.north);
    const ix = ((east  + HALF_EXTENT_M) / DX) | 0;
    const iy = ((north + HALF_EXTENT_M) / DY) | 0;
    if (ix < 0 || ix >= NX || iy < 0 || iy >= NY) continue;

    for (let iz = 0; iz < NZ; iz++) {
      const val = _grid[ix + NX * (iy + NY * iz)];
      // DataTexture row 0 = bottom of image, which maps to ground in the UVs
      const pi = (s + iz * width) * 4;
      if (val <= NODATA + 1) {
        rgba[pi + 3] = 0;
      } else {
        const [r, g, b] = cfg.color(val);
        rgba[pi]     = Math.round(r * 255);
        rgba[pi + 1] = Math.round(g * 255);
        rgba[pi + 2] = Math.round(b * 255);
        rgba[pi + 3] = 230;
      }
    }
  }

  return { type: 'crossSection', rgba, width, height, p1, p2 };
}
