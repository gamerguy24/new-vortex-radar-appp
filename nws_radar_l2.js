/*
 * nws_radar_l2.js
 * Server-side NEXRAD Level 2 loader — the SAME data + decoder the main Vortex
 * Radar app uses, made to run in Node.
 *
 * It fetches super-res Level 2 volumes from the free AWS Open Data bucket
 * (noaa-nexrad-level2.s3.amazonaws.com) and decodes them with the app's own
 * libnexrad parser + Level2Factory — no reimplementation. Those modules are
 * written for the browser (WebGL plotting, a web-worker bzip decompressor, a DOM
 * progress bar), so before requiring them we:
 *   1. inject a synchronous `webworkify` shim into require.cache so the parser's
 *      decompress worker runs in-process, and
 *   2. stub the browser-only modules the Factory pulls in at load (map, WebGL
 *      plotter, dealias, menus) — none of which we call here.
 *
 * We only ever call the Factory's pure data getters:
 *   get_azimuth_angles / get_ranges / get_data / get_location / get_elevation_angle
 *
 * Exported: getRadarData(lat, lon, product) -> { site, azimuths, ranges, data,
 * location, product, elevationAngle, time } | null.  product: 'REF' | 'VEL'.
 */

const path = require('path');

const APP = path.join(__dirname, 'app');
const RADAR = path.join(APP, 'radar');

// ── stub the browser-only modules BEFORE requiring the parser/factory ─────────
function putStub(absFile, exports) {
  const p = require.resolve(absFile);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

// A synchronous stand-in for webworkify: runs the worker module in-process so
// postMessage/onmessage form a synchronous two-way channel.
function syncWorkify(mod) {
  const workerScope = {};
  const mainListeners = [];
  workerScope.addEventListener = (t, fn) => { if (t === 'message') workerScope.__on = fn; };
  workerScope.postMessage = (data) => { for (const fn of mainListeners) fn({ data }); };
  mod(workerScope); // registers workerScope.__on
  return {
    addEventListener: (t, fn) => { if (t === 'message') mainListeners.push(fn); },
    postMessage: (data) => { if (workerScope.__on) workerScope.__on({ data }); },
  };
}

let _parserMod = null;   // NEXRADLevel2File
let _factoryMod = null;  // Level2Factory
function ensureModules() {
  if (_parserMod && _factoryMod) return;
  // global self so worker-style modules don't throw at load.
  if (typeof global.self === 'undefined') global.self = global;

  // webworkify → synchronous shim (used by the parser + factory).
  putStub('webworkify', syncWorkify);
  // DOM progress bar → no-op.
  putStub(path.join(APP, 'core', 'misc', 'progress_bar'), {
    show_progress_bar() {}, hide_progress_bar() {},
    set_progress_bar_width() {}, set_progress_bar_text() {},
  });
  // Browser-only modules the Factory requires at load but we never invoke.
  putStub(path.join(RADAR, 'plot', 'plot_to_map'), () => {});
  putStub(path.join(RADAR, 'plot', 'calculate_coordinates'), () => {});
  putStub(path.join(APP, 'core', 'map', 'map'), {});
  putStub(path.join(RADAR, 'libnexrad_helpers', 'display_file_info'), function () {});
  putStub(path.join(RADAR, 'libnexrad_helpers', 'level2', 'elevation_menu'), function () {});
  putStub(path.join(RADAR, 'libnexrad_helpers', 'level2', 'dealias', 'dealias'), function () {});

  _parserMod = require(path.join(RADAR, 'libnexrad', 'level2', 'level2_parser'));
  _factoryMod = require(path.join(RADAR, 'libnexrad', 'level2', 'level2_factory'));
}

// ── nearest NEXRAD site ───────────────────────────────────────────────────────
const { NEXRAD_LOCATIONS } = require('./app/radar/libnexrad/nexrad_locations');
function nearestStation(lat, lon) {
  let best = null, bestD = Infinity;
  for (const id of Object.keys(NEXRAD_LOCATIONS)) {
    const v = NEXRAD_LOCATIONS[id];
    const slat = v && v.lat, slon = v && v.lon;
    if (typeof slat !== 'number' || typeof slon !== 'number') continue;
    const dLat = slat - lat;
    const dLon = (slon - lon) * Math.cos(lat * Math.PI / 180);
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// ── latest Level 2 volume URL from the AWS Open Data bucket ────────────────────
const L2_BUCKET = 'https://noaa-nexrad-level2.s3.amazonaws.com';
const USER_AGENT = process.env.NWS_USER_AGENT ||
  'VortexRadar (vortex-dome22.onrender.com, davidwallis17@gmail.com)';

// The same volumes are mirrored on Google Cloud; we try AWS first, then GCP, so
// a listing/egress hiccup on one doesn't sink us.
const GCP_BUCKET = 'https://storage.googleapis.com/gcp-public-data-nexrad-l2';
const GCP_LIST = 'https://storage.googleapis.com/storage/v1/b/gcp-public-data-nexrad-l2/o';

async function listKeysAWS(prefix) {
  const url = `${L2_BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error('AWS list HTTP ' + res.status);
  const xml = await res.text();
  const keys = []; const re = /<Key>([^<]+)<\/Key>/g; let m;
  while ((m = re.exec(xml))) keys.push(m[1]);
  return keys;
}
async function listKeysGCP(prefix) {
  const url = `${GCP_LIST}?prefix=${encodeURIComponent(prefix)}&maxResults=1000&fields=items(name)`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error('GCP list HTTP ' + res.status);
  const j = await res.json();
  return (j.items || []).map((i) => i.name);
}
function newestVolume(keys) {
  const v = keys.filter((k) => !k.endsWith('_MDM') && /_V0\d$/.test(k));
  return v.length ? v[v.length - 1] : null;
}

// Returns { key, source } where source is 'aws' | 'gcp'.
async function latestLevel2Key(station) {
  const now = new Date();
  for (let dayBack = 0; dayBack < 2; dayBack++) {
    const d = new Date(now.getTime() - dayBack * 86400000);
    const prefix = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${station}/`;
    let key = null, source = null;
    try { key = newestVolume(await listKeysAWS(prefix)); source = 'aws'; } catch { /* try GCP */ }
    if (!key) { try { key = newestVolume(await listKeysGCP(prefix)); source = 'gcp'; } catch { /* none */ } }
    if (key) return { key, source };
  }
  return null;
}

async function fetchBuffer(url, ms = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}

// Lowest-elevation sweep whose base record actually contains the product
// (handles split-cut VCPs where REF and VEL are in different sweeps).
function bestElevationFor(factory, product) {
  let best = null, bestAng = Infinity;
  for (let e = 1; e <= factory.nscans; e++) {
    const sweep = factory.grouped_sweeps[e];
    if (!sweep || !sweep[0] || !sweep[0][product] || !sweep[0][product].ngates) continue;
    let ang; try { ang = factory.get_elevation_angle(e); } catch { continue; }
    if (ang < bestAng) { bestAng = ang; best = e; }
  }
  return best;
}

// Parse a Level 2 buffer into a Level2Factory (synchronous with our shims).
function decodeVolume(buffer, filename) {
  ensureModules();
  const NEXRADLevel2File = _parserMod;
  const Level2Factory = _factoryMod;
  let factory = null;
  // The parser is chatty (console.log per stage); quiet it during decode.
  const origLog = console.log;
  console.log = () => {};
  try {
    // The parser's constructor is callback-style; our sync worker shim makes the
    // callback fire before the constructor returns.
    // eslint-disable-next-line no-new
    new NEXRADLevel2File(buffer, (radarObj) => { factory = new Level2Factory(radarObj); }, filename);
  } finally { console.log = origLog; }
  return factory;
}

// Cache the single most-recently decoded volume so a burst of warnings near the
// same radar (e.g. a squall line) reuses one ~15MB decode instead of repeating
// it. Only one is kept — parsed volumes are large, and Render's RAM is limited.
let _volCache = null; // { key, factory }

async function fetchVolume(key, source) {
  const url = source === 'gcp' ? `${GCP_BUCKET}/${key}` : `${L2_BUCKET}/${key}`;
  try { return await fetchBuffer(url); }
  catch (e) {
    // cross-source fallback
    const alt = source === 'gcp' ? `${L2_BUCKET}/${key}` : `${GCP_BUCKET}/${key}`;
    return fetchBuffer(alt);
  }
}

/**
 * Fetch + decode the nearest radar's latest volume and return the base-sweep
 * (0.5°) data for a product. product: 'REF' (reflectivity) or 'VEL' (velocity).
 */
async function getRadarData(lat, lon, product = 'REF') {
  const site = nearestStation(lat, lon);
  if (!site) return null;
  const found = await latestLevel2Key(site);
  if (!found) { console.warn('[NWS-BSKY] no Level 2 file for', site); return null; }
  const { key, source } = found;

  let factory;
  if (_volCache && _volCache.key === key) {
    factory = _volCache.factory;
  } else {
    const buf = await fetchVolume(key, source);
    factory = decodeVolume(buf, key.split('/').pop());
    if (factory) _volCache = { key, factory };
  }
  if (!factory) { console.warn('[NWS-BSKY] Level 2 decode produced no factory for', site); return null; }

  // Split-cut VCPs put reflectivity and velocity in SEPARATE sweeps at the same
  // (lowest) elevation angle — pick the lowest-angle sweep that actually holds
  // the requested product.
  const elevation = bestElevationFor(factory, product);
  if (elevation == null) { console.warn('[NWS-BSKY] no', product, 'sweep for', site); return null; }
  const azimuths = factory.get_azimuth_angles(elevation);
  const ranges = factory.get_ranges(product, elevation);
  const data = factory.get_data(product, elevation);
  const location = factory.get_location();
  let elevationAngle = null, time = null;
  try { elevationAngle = factory.get_elevation_angle(elevation); } catch { /* ignore */ }
  try { time = factory.get_date(); } catch { /* ignore */ }

  return { site, azimuths, ranges, data, location, product, elevationAngle, time };
}

module.exports = { getRadarData, nearestStation, latestLevel2Key, decodeVolume };
