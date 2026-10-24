/*
 * 3d/storm3d_grid.js
 * Turns a parsed Level-II volume into the regular 3D grid the storm view
 * contours, plus a plan-view image of the lowest tilt for the floor.
 *
 * Inverse mapping, not gate splatting: every grid point asks "which beam am I
 * in?" (4/3-earth model → slant range + elevation angle), reads the tilts just
 * below and above it, and interpolates between them by angle. Splatting each
 * gate into a voxel instead leaves holes between tilts far from the radar —
 * the "stacked pancakes" look — because the beams there are kilometres apart.
 *
 * The lowest tilts come at full super-resolution (0.5° × 250 m). SAILS repeats
 * of the lowest tilt and the Doppler half of each split cut are folded into
 * one sweep per elevation, keeping the one with the most range.
 *
 * Pure functions with no browser or worker globals, so they run (and are
 * tested) in Node too.
 *
 * (c) David Wallis, Twistcaster Live Media LLC 2026
 */

const AE = 6371000 * (4 / 3);       // effective earth radius, standard refraction
const DEG = Math.PI / 180;
const HALF_BEAM = 0.5;              // degrees: data counts up to half a beamwidth past the top/bottom tilt
const AZ_BINS = 720;                // 0.5° lookup bins (super-res azimuth spacing)
const MAX_RANGE_M = 460000;

/**
 * One sweep per distinct elevation, sorted low → high.
 * @param radar   a nexrad-level-2-data Level2Radar
 * @param product { prop, xform, floor, clear } — floor: weakest value that
 *                counts as an echo; clear: what "no echo here" contours as.
 */
export function collectSweeps(radar, product) {
  const raw = [];
  for (const elev of radar.listElevations()) {
    let headers;
    try { radar.setElevation(elev); headers = radar.getHeader(); } catch { continue; }
    if (!Array.isArray(headers) || !headers.length) continue;
    const radials = headers.filter((h) => h && h[product.prop] && h[product.prop].moment_data
      && Number.isFinite(h.azimuth) && Number.isFinite(h.elevation_angle));
    if (radials.length < 90) continue;
    const angles = radials.map((h) => h.elevation_angle).sort((a, b) => a - b);
    const rec0 = radials[0][product.prop];
    raw.push({ radials, angle: angles[angles.length >> 1], gates: rec0.gate_count, score: radials.length * rec0.gate_count });
  }
  raw.sort((a, b) => a.angle - b.angle);

  // Same elevation (within 0.25°) → keep the sweep that reaches farthest.
  const picked = [];
  for (const s of raw) {
    const last = picked[picked.length - 1];
    if (last && s.angle - last.angle < 0.25) { if (s.score > last.score) picked[picked.length - 1] = s; }
    else picked.push(s);
  }
  return picked.map((s) => packSweep(s, product));
}

function packSweep(s, product) {
  const n = s.radials.length;
  let maxGates = 0;
  for (const h of s.radials) maxGates = Math.max(maxGates, h[product.prop].gate_count);
  const values = new Float32Array(n * maxGates).fill(product.clear);
  const az = new Float32Array(n);
  let firstGate = 0; let gateSize = 0.25;
  s.radials.forEach((h, i) => {
    const rec = h[product.prop];
    az[i] = h.azimuth;
    firstGate = rec.first_gate; gateSize = rec.gate_size;
    const md = rec.moment_data;
    for (let g = 0; g < rec.gate_count; g++) {
      const raw = md[g];
      if (raw === null || raw === 'rf' || !Number.isFinite(raw)) continue;
      const v = product.xform(raw);
      if (v >= product.floor) values[i * maxGates + g] = v;
    }
  });
  // 0.5° bin → nearest radial, so a lookup is one array read.
  const azIndex = new Int32Array(AZ_BINS);
  for (let b = 0; b < AZ_BINS; b++) {
    const centre = (b + 0.5) * (360 / AZ_BINS);
    let best = 0; let bestD = 999;
    for (let i = 0; i < n; i++) {
      let d = Math.abs(az[i] - centre); if (d > 180) d = 360 - d;
      if (d < bestD) { bestD = d; best = i; }
    }
    azIndex[b] = bestD <= 1.0 ? best : -1;   // no radial within 1° → gap
  }
  return {
    angle: s.angle, values, maxGates, azIndex,
    firstGateM: firstGate * 1000, gateSizeM: gateSize * 1000,
  };
}

// Value of one sweep at (azimuth bin, slant range), or `clear` when outside it.
function sample(sw, bin, r, clear) {
  const ri = sw.azIndex[bin];
  if (ri < 0) return clear;
  const g = Math.round((r - sw.firstGateM) / sw.gateSizeM);
  if (g < 0 || g >= sw.maxGates) return clear;
  return sw.values[ri * sw.maxGates + g];
}

/**
 * Grid the volume into a box centred `centre` metres (east, north) from the
 * radar. Grid point (ix, iy, iz) sits at east = cx - half + ix·dx, height
 * iz·dz. Points outside the radar's coverage, and the box's outer faces, get
 * `clear` so every isosurface closes into a solid shape.
 */
export function gridVolume(sweeps, product, { centre, halfExtentM, zTopM, nx, ny, nz }) {
  const dx = (2 * halfExtentM) / (nx - 1);
  const dy = (2 * halfExtentM) / (ny - 1);
  const dz = zTopM / (nz - 1);
  const grid = new Float32Array(nx * ny * nz).fill(product.clear);
  if (!sweeps.length) return { grid, dx, dy, dz };
  const angles = sweeps.map((s) => s.angle);
  const lo = angles[0] - HALF_BEAM; const hi = angles[angles.length - 1] + HALF_BEAM;
  const clear = product.clear;

  for (let iy = 1; iy < ny - 1; iy++) {
    const north = centre.north - halfExtentM + iy * dy;
    for (let ix = 1; ix < nx - 1; ix++) {
      const east = centre.east - halfExtentM + ix * dx;
      const s = Math.hypot(east, north);
      if (s > MAX_RANGE_M) continue;
      let azDeg = Math.atan2(east, north) / DEG; if (azDeg < 0) azDeg += 360;
      const bin = Math.min(AZ_BINS - 1, (azDeg * (AZ_BINS / 360)) | 0);
      const phi = s / AE; const sinPhi = Math.sin(phi); const cosPhi = Math.cos(phi);
      for (let iz = 1; iz < nz - 1; iz++) {
        const R = AE + iz * dz;
        const X = R * sinPhi; const Y = R * cosPhi - AE;
        const theta = Math.atan2(Y, X) / DEG;
        if (theta < lo || theta > hi) continue;
        const r = Math.hypot(X, Y);
        let v;
        if (theta <= angles[0]) v = sample(sweeps[0], bin, r, clear);
        else if (theta >= angles[angles.length - 1]) v = sample(sweeps[sweeps.length - 1], bin, r, clear);
        else {
          let k = 1; while (angles[k] < theta) k++;
          const a = sweeps[k - 1]; const b = sweeps[k];
          const t = (theta - a.angle) / (b.angle - a.angle);
          v = sample(a, bin, r, clear) * (1 - t) + sample(b, bin, r, clear) * t;
        }
        grid[ix + nx * (iy + ny * iz)] = v;
      }
    }
  }
  // Two passes: rounder, cloud-like shells; one left them lumpy between tilts.
  smooth121(grid, nx, ny, nz);
  smooth121(grid, nx, ny, nz);
  return { grid, dx, dy, dz };
}

// Light [1 2 1] blur along each axis: takes the facets off the shells without
// moving them. Applied to values, never to colours.
function smooth121(g, nx, ny, nz) {
  const tmp = new Float32Array(g.length);
  const pass = (stride, len, at) => {
    tmp.set(g);
    for (let i = 0; i < g.length; i++) {
      const p = at(i);
      if (p === 0 || p === len - 1) continue;
      g[i] = 0.25 * tmp[i - stride] + 0.5 * tmp[i] + 0.25 * tmp[i + stride];
    }
  };
  pass(1, nx, (i) => i % nx);
  pass(nx, ny, (i) => ((i / nx) | 0) % ny);
  pass(nx * ny, nz, (i) => (i / (nx * ny)) | 0);
}

/**
 * Plan view of the lowest sweep across the box, as RGBA for a floor texture.
 * colour(v) → [r,g,b] in 0..1, or null for transparent.
 */
export function groundImage(sweeps, product, { centre, halfExtentM, size }, colour) {
  const rgba = new Uint8Array(size * size * 4);
  const sw = sweeps[0];
  if (!sw) return rgba;
  const cosEl = Math.cos(sw.angle * DEG);
  for (let py = 0; py < size; py++) {
    // Row 0 of a texture is its bottom edge → south.
    const north = centre.north - halfExtentM + ((py + 0.5) / size) * 2 * halfExtentM;
    for (let px = 0; px < size; px++) {
      const east = centre.east - halfExtentM + ((px + 0.5) / size) * 2 * halfExtentM;
      const s = Math.hypot(east, north);
      let azDeg = Math.atan2(east, north) / DEG; if (azDeg < 0) azDeg += 360;
      const bin = Math.min(AZ_BINS - 1, (azDeg * (AZ_BINS / 360)) | 0);
      const v = sample(sw, bin, s / cosEl, product.clear);
      if (!(v >= product.floor)) continue;
      const c = colour(v);
      if (!c) continue;
      const o = (py * size + px) * 4;
      rgba[o] = c[0] * 255; rgba[o + 1] = c[1] * 255; rgba[o + 2] = c[2] * 255; rgba[o + 3] = 235;
    }
  }
  return rgba;
}

/** Metres east/north of the radar for a lat/lon (equirectangular is plenty at 230 km). */
export function offsetFromRadar(radarLat, radarLon, lat, lon) {
  return {
    east: (lon - radarLon) * Math.cos(radarLat * DEG) * 111320,
    north: (lat - radarLat) * 110574,
  };
}
