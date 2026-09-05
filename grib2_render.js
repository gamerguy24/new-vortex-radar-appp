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
  // bulk wind shear magnitude (kt). Breaks track forecast-desk thresholds:
  // ~20 kt is marginal, 35-40 kt is the supercell range, 50+ is strong.
  shear: {
    underAlpha: true,
    stops: [[10, [90, 120, 160]], [20, [70, 155, 200]], [30, [60, 195, 145]], [40, [235, 225, 90]],
      [50, [240, 160, 55]], [60, [230, 90, 55]], [75, [190, 40, 60]], [90, [210, 120, 235]]],
  },
  // storm-relative helicity (m^2/s^2)
  srh: {
    underAlpha: true,
    stops: [[50, [90, 130, 190]], [100, [70, 180, 170]], [150, [110, 205, 100]], [250, [235, 220, 90]],
      [400, [240, 150, 55]], [600, [225, 70, 60]], [800, [205, 110, 230]]],
  },
  // mean sea-level pressure (hPa) — diverging around 1013
  mslp: {
    underAlpha: true,
    stops: [[960, [150, 40, 60]], [984, [230, 120, 60]], [1000, [235, 220, 120]], [1013, [235, 235, 235]],
      [1024, [140, 200, 235]], [1036, [70, 130, 210]], [1050, [40, 60, 160]]],
  },
  // percent (RH, sky cover, PoP) — dry brown → wet blue/green
  percent: {
    underAlpha: true,
    stops: [[10, [150, 110, 70]], [30, [185, 165, 95]], [50, [120, 185, 120]],
      [70, [70, 185, 150]], [85, [55, 150, 205]], [100, [45, 90, 200]]],
  },
  /*
   * Instantaneous precipitation rate. GRIB stores this as kg/m²/s, which for
   * even heavy rain is ~0.003 — every value fell below the accumulation ramp's
   * first stop (0.2 mm) and the whole field rendered transparent. Its own kind
   * exists so toRampUnits can convert to mm/hr, where the numbers mean
   * something to a forecaster.
   */
  prate: {
    underAlpha: false,
    stops: [[0.1, [120, 230, 120]], [0.5, [60, 195, 85]], [1, [40, 150, 60]], [2.5, [235, 230, 95]],
      [5, [235, 170, 50]], [10, [230, 80, 50]], [25, [160, 30, 120]], [50, [210, 150, 230]]],
  },
  // convective inhibition (J/kg). GRIB stores CIN negative, so the ramp runs
  // from strongly capped up to uncapped and the LAST stop is the weakest.
  cin: {
    underAlpha: true,
    stops: [[-300, [80, 20, 90]], [-200, [140, 30, 70]], [-125, [205, 70, 60]],
      [-75, [235, 150, 60]], [-50, [235, 215, 110]], [-25, [190, 210, 160]], [0, [225, 235, 235]]],
  },
  // lifted index (°C) — negative is unstable, so the warm end is the low end.
  li: {
    underAlpha: true,
    stops: [[-12, [150, 40, 170]], [-8, [200, 40, 60]], [-5, [235, 120, 55]], [-2, [235, 215, 100]],
      [0, [220, 230, 220]], [4, [110, 180, 200]], [10, [60, 100, 190]]],
  },
  // environmental lapse rate (°C/km). 6.5 is the standard atmosphere; 8+ is steep.
  lapse: {
    underAlpha: true,
    stops: [[4, [60, 90, 170]], [5.5, [70, 160, 200]], [6.5, [120, 200, 150]], [7, [230, 225, 100]],
      [7.5, [240, 165, 55]], [8, [225, 75, 55]], [8.5, [175, 30, 55]], [9.5, [215, 130, 235]]],
  },
  // energy-helicity index (dimensionless)
  ehi: {
    underAlpha: true,
    stops: [[0.5, [90, 140, 200]], [1, [80, 195, 150]], [1.5, [150, 210, 90]], [2, [235, 220, 90]],
      [3, [240, 155, 55]], [4, [225, 70, 60]], [6, [205, 110, 230]]],
  },
  // supercell composite parameter (dimensionless)
  scp: {
    underAlpha: true,
    stops: [[1, [90, 140, 200]], [2, [80, 195, 150]], [4, [150, 210, 90]], [6, [235, 220, 90]],
      [8, [240, 155, 55]], [12, [225, 70, 60]], [16, [205, 110, 230]]],
  },
  // equivalent potential temperature (K) — moisture + heat in one field
  thetae: {
    underAlpha: true,
    stops: [[275, [110, 70, 200]], [290, [70, 130, 225]], [300, [80, 190, 190]], [310, [110, 200, 110]],
      [320, [230, 220, 90]], [330, [240, 155, 55]], [340, [225, 70, 60]], [355, [190, 40, 120]]],
  },
  // surface visibility (statute miles) — low visibility is the hazard, so the
  // ramp is inverted: the worst values get the loudest colour.
  vis: {
    underAlpha: false,
    stops: [[0, [150, 40, 170]], [0.25, [210, 40, 60]], [0.5, [240, 130, 50]], [1, [235, 215, 100]],
      [3, [160, 205, 130]], [6, [110, 180, 200]], [10, [200, 220, 235]]],
  },
  // a height above ground (m) — LCL, LFC, equilibrium level, PBL depth
  height: {
    underAlpha: true,
    stops: [[0, [200, 230, 235]], [500, [90, 190, 190]], [1000, [110, 200, 110]], [1500, [230, 220, 90]],
      [2000, [240, 155, 55]], [3000, [225, 70, 60]], [4500, [150, 40, 120]]],
  },
  /*
   * Departures from the long-term normal. Diverging about zero, with near-
   * normal deliberately pale so the eye goes to the departures — the whole
   * point of an anomaly map is which places are unusual.
   */
  anom_temp: {                                  // °C from normal
    underAlpha: true,
    stops: [[-20, [60, 20, 120]], [-14, [55, 80, 190]], [-8, [80, 150, 220]], [-3, [175, 210, 235]],
      [0, [242, 242, 240]], [3, [245, 210, 165]], [8, [235, 140, 60]], [14, [205, 50, 45]], [20, [120, 15, 25]]],
  },
  anom_pwat: {                                  // mm from normal
    underAlpha: true,
    stops: [[-30, [120, 70, 20]], [-20, [180, 130, 60]], [-10, [225, 200, 150]], [-3, [240, 235, 225]],
      [0, [242, 242, 240]], [3, [200, 235, 225]], [10, [90, 195, 175]], [20, [40, 140, 180]], [30, [25, 70, 150]]],
  },
  /*
   * Categorical precipitation type.
   *
   * Not a gradient: the value is an index picked by the derived field from the
   * four yes/no category flags (CRAIN/CSNOW/CFRZR/CICEP), so interpolating
   * between stops would invent a colour that means nothing. `discrete` makes
   * rampColor snap to the stop at or below the value instead of blending.
   */
  ptype: {
    underAlpha: true, discrete: true,
    stops: [[1, [40, 180, 70]], [2, [70, 145, 235]], [3, [225, 60, 190]], [4, [235, 150, 45]]],
  },
};

function classify(variable) {
  const v = String(variable).toUpperCase();
  // RETOP is an echo TOP (a height), not a reflectivity, so it must be tested
  // before the reflectivity rule that would otherwise swallow it.
  if (/^RETOP/.test(v)) return 'height';
  if (/REF|REFC|REFD|REFL/.test(v)) return 'refl';
  if (/CAPE/.test(v)) return 'cape';
  if (/^CIN/.test(v)) return 'cin';
  if (/^LFTX|^LI$|^BLI/.test(v)) return 'li';
  // Before the wind rule: these are shear/helicity fields, not wind speeds, and
  // without their own cases they fell through to the temperature ramp.
  if (/^VUCSH|^VVCSH|SHEAR|^BSHR/.test(v)) return 'shear';
  if (/^HLCY|HELIC|^SRH/.test(v)) return 'srh';
  if (/^VIS$/.test(v)) return 'vis';
  // Bare HGT is deliberately NOT here. At a pressure level it is geopotential
  // height (850 mb ~1500 m, 250 mb ~10400 m) and no single ramp covers that
  // spread; those are contour products anyway. Fields that ARE a height above
  // ground — LCL, LFC, equilibrium level — say so with an explicit kind.
  if (/^HPBL/.test(v)) return 'height';
  if (/PRMSL|MSLET|MSLMA|^MSL/.test(v)) return 'mslp';
  if (/RH$|^RH|POP|TCDC|SKY|CLOUD|^RHM/.test(v)) return 'percent';
  if (/WIND|GUST|^UGRD|^VGRD|^VEL|^WS/.test(v)) return 'wind';
  if (/^PRATE|^CPRAT/.test(v)) return 'prate';
  if (/APCP|PWAT|ASNOW|WEASD|SNOD|QPF/.test(v)) return 'precip';
  if (/^T(MP|MAX|MIN)|DPT|APT|POT/.test(v)) return 'temp';
  return 'temp';
}

// Physical value -> ramp units. Temp K->F; wind m/s->kt; mslp Pa->hPa; else raw.
function toRampUnits(kind, v) {
  if (kind === 'temp') return (v - 273.15) * 9 / 5 + 32;
  if (kind === 'wind' || kind === 'shear') return v * 1.943844;
  if (kind === 'mslp') return v / 100;
  if (kind === 'prate') return v * 3600;      // kg/m²/s -> mm/hr
  return v;
}

// Units label per kind, for the client legend.
const KIND_UNIT = {
  temp: '°F', refl: 'dBZ', precip: 'mm', wind: 'kt', cape: 'J/kg', mslp: 'hPa',
  percent: '%', shear: 'kt', srh: 'm²/s²', cin: 'J/kg', li: '°C', lapse: '°C/km',
  ehi: '', scp: '', thetae: 'K', vis: 'mi', height: 'm', ptype: '', prate: 'mm/hr',
  anom_temp: '°C from normal', anom_pwat: 'mm from normal', barb: 'kt',
};

// Categorical ramps get names instead of numbers on the legend.
const KIND_CATEGORIES = { ptype: { 1: 'Rain', 2: 'Snow', 3: 'Frz Rain', 4: 'Sleet' } };

/*
 * Legend descriptor for a variable: ramp stops (in display units) + unit label.
 *
 * `kind` may be given explicitly by a caller that knows better than the name
 * does — a derived field, or a preset whose variable is ambiguous (HGT is a
 * height above ground at one level and geopotential height at another).
 */
function legendFor(variable, kind) {
  const k = kind && RAMPS[kind] ? kind : classify(variable);
  const ramp = RAMPS[k];
  return {
    kind: k,
    unit: KIND_UNIT[k] || '',
    discrete: !!ramp.discrete,
    categories: KIND_CATEGORIES[k] || null,
    stops: ramp.stops.map(([val, rgb]) => [val, `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`]),
  };
}

function rampColor(ramp, x, out) {
  const s = ramp.stops;
  /*
   * Categorical ramps snap; they never blend. The value is a category index,
   * so a colour halfway between "snow" and "freezing rain" would be a lie.
   */
  if (ramp.discrete) {
    for (let i = s.length - 1; i >= 0; i--) {
      if (x >= s[i][0]) { const c = s[i][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = 255; return; }
    }
    out[3] = 0; return;
  }
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

/*
 * Shared raster loop. `valueAt(lon, lat)` returns the field's physical value
 * there, or null/NaN for "no data" (off-grid or missing), which is drawn fully
 * transparent. Factored out so the single-field and vector-magnitude renderers
 * cannot drift apart in projection, orientation or transparency handling.
 */
/*
 * Row latitudes are spaced in WEB MERCATOR, not evenly in latitude.
 *
 * The client hands this PNG to a Mapbox `image` source with the bbox corners,
 * and Mapbox stretches it linearly in Mercator Y. Emitting rows evenly spaced
 * in latitude therefore puts every row at the wrong place, worst in the middle
 * of the box — over a CONUS-wide view that is a couple of degrees, enough to
 * paint a field over the wrong states. Same defect, and same fix, as the MRMS
 * national mosaic (components/mrms.js).
 */
const _mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const _invMercY = (y) => (2 * (Math.atan(Math.exp(y)) - Math.PI / 4)) / D2R;

function rasterize(valueAt, kind, bbox, maxW) {
  const [W, S, E, N] = bbox;
  const OW = Math.min(maxW, 1600);
  const OH = Math.max(1, Math.round(OW * (N - S) / (E - W)));
  const ramp = RAMPS[kind];

  // Clamped away from the poles, where Mercator Y runs to infinity.
  const yN = _mercY(Math.min(85, Math.max(-85, N)));
  const yS = _mercY(Math.min(85, Math.max(-85, S)));

  const png = new PNG({ width: OW, height: OH });
  const data = png.data;
  const col = [0, 0, 0, 0];
  for (let py = 0; py < OH; py++) {
    const lat = _invMercY(yN + ((py + 0.5) / OH) * (yS - yN));
    for (let px = 0; px < OW; px++) {
      const lon = W + (px + 0.5) / OW * (E - W);
      const di4 = (py * OW + px) * 4;
      const v = valueAt(lon, lat);
      if (v == null || !Number.isFinite(v)) { data[di4 + 3] = 0; continue; }
      rampColor(ramp, toRampUnits(kind, v), col);
      data[di4] = col[0]; data[di4 + 1] = col[1]; data[di4 + 2] = col[2]; data[di4 + 3] = col[3];
    }
  }
  return { png: PNG.sync.write(png), width: OW, height: OH, kind };
}

/*
 * Render a decoded field to a PNG buffer over bbox [W,S,E,N] at up to maxW wide.
 *
 * `kind` overrides the name-based classification when the caller knows better.
 * `scale` converts a centre's units to the ones the ramp expects — ECMWF gives
 * total precipitation in metres where NOAA gives millimetres, and cloud cover
 * as a 0-1 fraction where NOAA gives percent. Getting this wrong plots a real
 * field on a silently wrong scale, which is worse than not plotting it.
 */
function renderField(gribBytes, variable, bbox, maxW = 1400, kind = null, scale = 1, sub = 1) {
  const { values, grid } = decodeGrib2Message(gribBytes, sub);
  const sample = makeSampler(grid);
  const k = scale == null || scale === 1 ? 1 : scale;
  return rasterize((lon, lat) => {
    const idx = sample(lon, lat);
    if (idx < 0) return null;
    const v = values[idx];
    return Number.isFinite(v) ? v * k : null;
  }, (kind && RAMPS[kind]) ? kind : classify(variable), bbox, maxW);
}

/*
 * Render a field COMPUTED from several GRIB messages.
 *
 * Most of what a forecaster reads off a severe-weather map is not in the file:
 * bulk shear is a u/v pair, a lapse rate is two temperatures and two heights,
 * the composite indices are products of three or four fields. `combine`
 * receives one physical value per input message, in the order given, and
 * returns the derived value in the ramp's own units — or null where it is not
 * defined.
 *
 * A pixel is drawn only where EVERY input is present. Any input being off-grid
 * or missing makes the derived value meaningless, and a partially-evaluated
 * severe parameter is worse than a hole in the map.
 */
function renderDerived(messageBytes, combine, kind, bbox, maxW = 1400, scales = null, extras = null, subs = null) {
  const fields = messageBytes.map((b, i) => {
    // `subs` picks the field inside each message, for the u/v pairs NCEP packs
    // together (see grib2_decode parseSections).
    const d = decodeGrib2Message(b, (subs && subs[i]) || 1);
    return {
      values: d.values,
      sample: makeSampler(d.grid),
      scale: (scales && scales[i] != null) ? scales[i] : 1,
    };
  });
  // Extra inputs that are not GRIB messages — a climatological normal, for the
  // anomaly fields. They are appended to `args` after the message values, so a
  // combine function reads its inputs in one consistent order either way.
  const extraFns = extras || [];
  const args = new Array(fields.length + extraFns.length);
  return rasterize((lon, lat) => {
    for (let i = 0; i < fields.length; i++) {
      const idx = fields[i].sample(lon, lat);
      if (idx < 0) return null;
      const v = fields[i].values[idx];
      if (!Number.isFinite(v)) return null;
      args[i] = v * fields[i].scale;
    }
    for (let k = 0; k < extraFns.length; k++) {
      const v = extraFns[k](lon, lat);
      if (v == null || !Number.isFinite(v)) return null;
      args[fields.length + k] = v;
    }
    return combine(args);
  }, kind, bbox, maxW);
}

/*
 * Render the MAGNITUDE of a two-component vector field: sqrt(u^2 + v^2).
 *
 * Bulk wind shear is stored as separate u and v components (VUCSH / VVCSH), so
 * there is no single GRIB message to colorize — the thing a forecaster wants to
 * see has to be computed from the pair. Both components are sampled at the same
 * lon/lat and a pixel is drawn only where both are present, so the edge of one
 * component's grid cannot leave a fringe of half-valid shear.
 *
 * Each component gets its own sampler rather than a shared grid index: they are
 * the same grid in every file we read, but assuming that would fail silently
 * and wrongly if it ever stopped being true.
 */
function renderVectorMagnitude(uBytes, vBytes, variable, bbox, maxW = 1400, subU = 1, subV = 1) {
  const u = decodeGrib2Message(uBytes, subU);
  const v = decodeGrib2Message(vBytes, subV);
  const sampleU = makeSampler(u.grid);
  const sampleV = makeSampler(v.grid);
  return rasterize((lon, lat) => {
    const iu = sampleU(lon, lat); if (iu < 0) return null;
    const iv = sampleV(lon, lat); if (iv < 0) return null;
    const a = u.values[iu], b = v.values[iv];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.hypot(a, b);
  }, classify(variable), bbox, maxW);
}

// Sample one decoded field at a lon/lat (nearest grid point). Returns null if
// off-grid or missing. `grid` + `values` come from decodeGrib2Message().
function sampleAt(grid, values, lon, lat) {
  const idx = makeSampler(grid)(lon, lat);
  if (idx < 0) return null;
  const v = values[idx];
  return Number.isFinite(v) ? v : null;
}

module.exports = {
  renderField, renderVectorMagnitude, renderDerived,
  classify, legendFor, makeSampler, sampleAt, RAMPS, KIND_UNIT,
};
