/*
 * grib2_render.js
 * Colorize a decoded GRIB2 model field into an EPSG:4326 (lat/lon) PNG for a
 * requested bbox, so the client can overlay it on the map like the radar layer.
 * Uses inverse sampling: for every output pixel we find the model grid value at
 * that lon/lat. Supports GDS template 0 (regular lat/lon: GFS/GEFS) and 3.30
 * (Lambert conformal: HRRR/NAM).
 */

const { PNG } = require('pngjs');
const { decodeGrib2Message } = require('./grib2_decode');

const EARTH_R = 6371229; // metres (NCEP spherical earth)
const D2R = Math.PI / 180;

// Color ramps: ascending [value, [r,g,b]]. `underAlpha:false` => transparent
// below the first stop (radar/precip no-data); temperature clamps opaque.
const RAMPS = {
  temp: {
    underAlpha: true,
    stops: [[-40, [138, 43, 160]], [-20, [110, 70, 200]], [0, [70, 100, 235]], [20, [70, 170, 235]],
      [32, [150, 220, 220]], [45, [40, 175, 95]], [60, [110, 200, 90]], [72, [235, 225, 90]],
      [82, [240, 165, 55]], [92, [230, 90, 55]], [104, [175, 30, 40]], [115, [120, 15, 25]]],
  },
  refl: {
    underAlpha: false,
    stops: [[5, [100, 200, 255]], [15, [60, 140, 235]], [20, [40, 210, 40]], [30, [25, 150, 25]],
      [35, [235, 235, 60]], [40, [235, 180, 40]], [45, [235, 120, 40]], [50, [220, 40, 40]],
      [55, [160, 20, 20]], [60, [235, 40, 235]], [70, [200, 160, 235]]],
  },
  precip: {
    underAlpha: false,
    stops: [[0.2, [120, 230, 120]], [1, [60, 195, 85]], [2, [40, 150, 60]], [5, [235, 230, 95]],
      [10, [235, 170, 50]], [20, [230, 80, 50]], [40, [160, 30, 120]], [75, [210, 150, 230]]],
  },
  // wind speed (kt)
  wind: {
    underAlpha: true,
    stops: [[5, [90, 120, 160]], [15, [70, 150, 200]], [25, [60, 190, 150]], [35, [120, 210, 80]],
      [50, [235, 225, 90]], [65, [240, 160, 55]], [85, [230, 90, 55]], [110, [200, 40, 120]], [140, [220, 150, 235]]],
  },
  // surface-based CAPE (J/kg)
  cape: {
    underAlpha: true,
    stops: [[250, [90, 150, 210]], [500, [90, 200, 130]], [1000, [230, 220, 90]], [2000, [240, 160, 55]],
      [3000, [230, 90, 55]], [4000, [190, 40, 60]], [5000, [210, 120, 235]]],
  },
  // mean sea-level pressure (hPa) — diverging around 1013
  mslp: {
    underAlpha: true,
    stops: [[960, [150, 40, 60]], [984, [230, 120, 60]], [1000, [235, 220, 120]], [1013, [235, 235, 235]],
      [1024, [140, 200, 235]], [1036, [70, 130, 210]], [1050, [40, 60, 160]]],
  },
};

function classify(variable) {
  const v = String(variable).toUpperCase();
  if (/REF|RETOP|REFC|REFD|REFL/.test(v)) return 'refl';
  if (/CAPE/.test(v)) return 'cape';
  if (/PRMSL|MSLET|MSLMA|^MSL/.test(v)) return 'mslp';
  if (/WIND|GUST|^UGRD|^VGRD|^VEL|^WS/.test(v)) return 'wind';
  if (/APCP|PRATE|PWAT|CPRAT|ASNOW|WEASD|SNOD|QPF/.test(v)) return 'precip';
  if (/^T(MP|MAX|MIN)|DPT|APT|POT/.test(v)) return 'temp';
  return 'temp';
}

// Physical value -> ramp units. Temp K->F; wind m/s->kt; mslp Pa->hPa; else raw.
function toRampUnits(kind, v) {
  if (kind === 'temp') return (v - 273.15) * 9 / 5 + 32;
  if (kind === 'wind') return v * 1.943844;
  if (kind === 'mslp') return v / 100;
  return v;
}

// Units label per kind, for the client legend.
const KIND_UNIT = { temp: '°F', refl: 'dBZ', precip: 'mm', wind: 'kt', cape: 'J/kg', mslp: 'hPa' };

// Legend descriptor for a variable: ramp stops (in display units) + unit label.
function legendFor(variable) {
  const kind = classify(variable);
  const ramp = RAMPS[kind];
  return {
    kind,
    unit: KIND_UNIT[kind] || '',
    stops: ramp.stops.map(([val, rgb]) => [val, `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`]),
  };
}

function rampColor(ramp, x, out) {
  const s = ramp.stops;
  if (x < s[0][0]) {
    if (ramp.underAlpha) { out[0] = s[0][1][0]; out[1] = s[0][1][1]; out[2] = s[0][1][2]; out[3] = 255; return; }
    out[3] = 0; return;
  }
  if (x >= s[s.length - 1][0]) { const c = s[s.length - 1][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = 255; return; }
  for (let i = 0; i < s.length - 1; i++) {
    if (x >= s[i][0] && x < s[i + 1][0]) {
      const t = (x - s[i][0]) / (s[i + 1][0] - s[i][0]);
      const a = s[i][1], b = s[i + 1][1];
      out[0] = Math.round(a[0] + (b[0] - a[0]) * t);
      out[1] = Math.round(a[1] + (b[1] - a[1]) * t);
      out[2] = Math.round(a[2] + (b[2] - a[2]) * t);
      out[3] = 255;
      return;
    }
  }
  out[3] = 0;
}

// Build a lon/lat -> grid (i,j) sampler for the field's grid.
function makeSampler(grid) {
  if (grid.template === 0) {
    const { nx, ny, la1, lo1, di, dj, scanMode } = grid;
    const jUp = (scanMode & 0x40) !== 0; // +j means south->north
    return (lon, lat) => {
      let dlon = (lon - lo1) % 360; if (dlon < 0) dlon += 360;
      const gi = Math.round(dlon / di);
      const gj = Math.round(jUp ? (lat - la1) / dj : (la1 - lat) / dj);
      if (gi < 0 || gi >= nx || gj < 0 || gj >= ny) return -1;
      return gj * nx + gi;
    };
  }
  if (grid.template === 30) {
    const { nx, ny, la1, lo1, lov, latin1, latin2, dx, dy, scanMode } = grid;
    const phi1 = latin1 * D2R, phi2 = latin2 * D2R, lambda0 = lov * D2R;
    const n = Math.abs(phi1 - phi2) < 1e-9 ? Math.sin(phi1)
      : Math.log(Math.cos(phi1) / Math.cos(phi2))
        / Math.log(Math.tan(Math.PI / 4 + phi2 / 2) / Math.tan(Math.PI / 4 + phi1 / 2));
    const F = Math.cos(phi1) * Math.pow(Math.tan(Math.PI / 4 + phi1 / 2), n) / n;
    const rho0 = EARTH_R * F / Math.pow(Math.tan(Math.PI / 4 + phi1 / 2), n);
    const fwd = (lat, lon) => {
      const phi = lat * D2R;
      let dl = (lon - lov) * D2R;
      while (dl > Math.PI) dl -= 2 * Math.PI; while (dl < -Math.PI) dl += 2 * Math.PI;
      const rho = EARTH_R * F / Math.pow(Math.tan(Math.PI / 4 + phi / 2), n);
      return [rho * Math.sin(n * dl), rho0 - rho * Math.cos(n * dl)];
    };
    const [x0, y0] = fwd(la1, lo1);
    const jUp = (scanMode & 0x40) !== 0;
    return (lon, lat) => {
      const [x, y] = fwd(lat, lon);
      const gi = Math.round((x - x0) / dx);
      const gj = Math.round(jUp ? (y - y0) / dy : (y0 - y) / dy);
      if (gi < 0 || gi >= nx || gj < 0 || gj >= ny) return -1;
      return gj * nx + gi;
    };
  }
  return () => -1;
}

// Render a decoded field to a PNG buffer over bbox [W,S,E,N] at up to maxW wide.
function renderField(gribBytes, variable, bbox, maxW = 1400) {
  const { values, grid } = decodeGrib2Message(gribBytes);
  const [W, S, E, N] = bbox;
  const OW = Math.min(maxW, 1600);
  const OH = Math.max(1, Math.round(OW * (N - S) / (E - W)));
  const kind = classify(variable);
  const ramp = RAMPS[kind];
  const sample = makeSampler(grid);

  const png = new PNG({ width: OW, height: OH });
  const data = png.data;
  const col = [0, 0, 0, 0];
  for (let py = 0; py < OH; py++) {
    const lat = N - (py + 0.5) / OH * (N - S);
    for (let px = 0; px < OW; px++) {
      const lon = W + (px + 0.5) / OW * (E - W);
      const idx = sample(lon, lat);
      const di4 = (py * OW + px) * 4;
      if (idx < 0) { data[di4 + 3] = 0; continue; }
      const v = values[idx];
      if (!Number.isFinite(v)) { data[di4 + 3] = 0; continue; }
      rampColor(ramp, toRampUnits(kind, v), col);
      data[di4] = col[0]; data[di4 + 1] = col[1]; data[di4 + 2] = col[2]; data[di4 + 3] = col[3];
    }
  }
  return { png: PNG.sync.write(png), width: OW, height: OH, kind };
}

// Sample one decoded field at a lon/lat (nearest grid point). Returns null if
// off-grid or missing. `grid` + `values` come from decodeGrib2Message().
function sampleAt(grid, values, lon, lat) {
  const idx = makeSampler(grid)(lon, lat);
  if (idx < 0) return null;
  const v = values[idx];
  return Number.isFinite(v) ? v : null;
}

module.exports = { renderField, classify, legendFor, makeSampler, sampleAt };
