/*
 * app/radar/libnexrad/l2_browser_entry.js
 * Standalone browser bundle of the app's OWN Level 2 parser AND factory, for
 * pages that are not the radar page — currently the Graphics Studio.
 *
 * WHY THIS EXISTS
 * The Graphics Studio has to draw the same radar the radar page draws. It
 * cannot import dist/bundle.js, because that entry boots the whole application
 * (constructs a Mapbox map, builds menus, expects the radar page's DOM).
 *
 * So the parser and factory are bundled here on their own. The factory's
 * browser-UI dependencies — the map, the plotter, the elevation menu, the
 * dealiaser, the file-info panel — are replaced with empty stubs at BUILD time
 * (see the ignore list in tools/build.js). That is the same treatment
 * nws_radar_l2.js applies to run this decoder in Node, for the same reason:
 * those modules are only touched by plot(), which nothing here calls.
 *
 * IMPORTANT: use the real Factory's accessors — get_azimuth_angles(),
 * get_ranges(), get_data(). An earlier version of this file reimplemented that
 * logic and silently picked the WRONG SWEEP (elevation 2 at 1192 gates instead
 * of elevation 1 at 1832), producing different values from the radar page.
 * Sharing the real implementation is the whole point; do not reintroduce a copy.
 *
 * Built by tools/build.js to dist/l2_bundle.js, exposed as window.VortexL2.
 */

const NEXRADLevel2File = require('./level2/level2_parser');
const Level2Factory = require('./level2/level2_factory');
const colormaps = require('../colormaps/colormaps');
// The app builds its colour scales with chroma in LAB space. Ship it too, so a
// studio graphic can build the IDENTICAL scale rather than approximating it.
const chroma = require('chroma-js');

// Copy of scaleValues() from app/core/utils.js (that module is browser-coupled
// to the radar page). Pure arithmetic, safe to duplicate.
function scaleValues(values, product) {
  if (['N0G', 'N0U', 'VEL', 'TVX', 'TV0', 'TV1', 'TV2'].includes(product)) {
    for (const i in values) { if (values[i] !== 999) values[i] = values[i] / 1.944; }
  } else if (product === 'N0S') {
    for (const i in values) { if (values[i] !== 999) values[i] = values[i] - 0.5; }
  }
  for (let i = 0; i < values.length; i++) {
    if (values[i] === values[i + 1]) values[i] = values[i] - 0.00001;
  }
  return values;
}

/**
 * Parse a volume into a Level2Factory.
 *
 * Accepts an ArrayBuffer (what fetch().arrayBuffer() gives you) or a Buffer.
 * The wrap matters: the parser hands its input to RandomAccessFile, which reads
 * it with Buffer methods, so a bare ArrayBuffer throws. loaders_nexrad.js does
 * the same Buffer.from() before calling this parser — this is not an extra copy
 * for its own sake, it is the calling convention.
 */
function parseVolume(input, filename) {
  return new Promise((resolve, reject) => {
    try {
      const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
      // eslint-disable-next-line no-new
      new NEXRADLevel2File(buf, (radarObj) => {
        try { resolve(new Level2Factory(radarObj)); } catch (e) { reject(e); }
      }, filename);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Lowest-elevation sweep that actually carries this product. Split-cut VCPs
 * scan reflectivity and velocity in separate sweeps at the same nominal tilt,
 * so sweep 1 is not reliably the one holding VEL.
 */
function bestElevationFor(factory, product) {
  const candidates = [];
  for (let e = 1; e <= factory.nscans; e++) {
    const sweep = factory.grouped_sweeps[e];
    if (!sweep || !sweep[0] || !sweep[0][product] || !sweep[0][product].ngates) continue;
    let angle;
    try { angle = factory.get_elevation_angle(e); } catch (err) { continue; }
    candidates.push({ e, angle, ngates: sweep[0][product].ngates, nradials: sweep.length });
  }
  if (!candidates.length) return null;

  const lowest = Math.min(...candidates.map((c) => c.angle));

  // Sweeps at the SAME nominal tilt can differ in resolution. In a split cut the
  // super-res surveillance sweep and the Doppler sweep are both at ~0.5°, and
  // some VCPs also carry a legacy-resolution copy of the same product. Picking
  // by elevation alone therefore picks the finer or the coarser one depending on
  // scan order — which is not a decision to leave to chance when the whole point
  // is super-res. Among the lowest tilt, take the most gates, then the most
  // radials: that is the super-res sweep by definition (0.25 km x 0.5° rather
  // than 1 km x 1°).
  const atLowest = candidates.filter((c) => Math.abs(c.angle - lowest) < 0.05);
  atLowest.sort((a, b) => (b.ngates - a.ngates) || (b.nradials - a.nradials));
  return atLowest[0].e;
}

/**
 * Pull one sweep out of a decoded volume, using the factory's own accessors.
 * @returns {object|null} { product, elevation, elevationAngle, azimuths, ranges,
 *                          data, nyquist, gateSpacingKm }
 */
function sweepFrom(factory, product) {
  const elevation = bestElevationFor(factory, product);
  if (elevation == null) return null;

  const data = factory.get_data(product, elevation);
  if (!data || !data.length) return null;

  // get_ranges() returns ngates+1 EDGES; a per-gate lookup wants centres.
  const edges = factory.get_ranges(product, elevation);
  const ranges = new Array(Math.max(0, edges.length - 1));
  for (let i = 0; i < ranges.length; i++) ranges[i] = (edges[i] + edges[i + 1]) / 2;

  let elevationAngle = null;
  let nyquist = null;
  try { elevationAngle = factory.get_elevation_angle(elevation); } catch (e) { /* optional */ }
  try {
    const n = factory.get_nyquist_vel(elevation);
    if (typeof n === 'number' && n > 0) nyquist = n;
  } catch (e) { /* optional */ }

  const azimuths = factory.get_azimuth_angles(elevation);
  const gateSpacingKm = ranges.length > 1 ? (ranges[1] - ranges[0]) : null;

  return {
    product,
    elevation,
    elevationAngle,
    azimuths,
    ranges,
    data,
    nyquist,
    gateSpacingKm,
    // Super-res is 0.25 km gates on a 0.5° azimuth grid; legacy is 1 km / 1°.
    // Reported so a caption can state it rather than implying it.
    superRes: !!(gateSpacingKm && gateSpacingKm < 0.5 && azimuths.length > 600),
  };
}

/** Radar site + position from the decoded volume. */
function locationFrom(factory) {
  let loc = null;
  try { loc = factory.get_location(); } catch (e) { loc = null; }
  const site = String(factory.station || '').replace(/\0/g, '').trim();
  if (!loc || !isFinite(loc[0])) return null;
  return { site, lat: loc[0], lon: loc[1], elev: loc[2] || 0 };
}

/** Volume scan time. */
function timeFrom(factory) {
  try {
    const t = factory.get_date();
    const d = (t instanceof Date) ? t : new Date(t);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
}

const api = {
  NEXRADLevel2File,
  Level2Factory,
  parseVolume,
  sweepFrom,
  bestElevationFor,
  locationFrom,
  timeFrom,
  colormaps,
  scaleValues,
  chroma,
};

if (typeof window !== 'undefined') window.VortexL2 = api;

module.exports = api;
