/*
 * nws_graphic.js
 * Server-side broadcast-style warning graphic generator (1200x675 PNG).
 *
 * Given a single NWS alert feature (GeoJSON geometry + `properties`), it composites:
 *   1. a Mapbox Static basemap framed to the warning polygon,
 *   2. live NOAA NEXRAD base reflectivity (the same free ImageServer the Vortex
 *      Graphics studio uses in graphics/studio/engine/radar.js), warped from
 *      EPSG:4326 onto the web-mercator basemap,
 *   3. the warning polygon in its official NWS color (app/alerts/colors/noaa_colors.js),
 *   4. a TV-style banner + info strip + US locator + Vortex Radar branding.
 *
 * Runs entirely on the server with @napi-rs/canvas (prebuilt, no native build) —
 * no browser, no paid service. Every network step is guarded: if the basemap or
 * radar fetch fails the graphic still renders (basemap-less / radar-less) rather
 * than throwing, so a warning never goes ungraphic'd because of a transient CDN
 * hiccup.
 *
 * Exported: renderWarningGraphic(alert) -> Promise<Buffer> (PNG bytes).
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { DateTime } = require('luxon');
const turf = require('@turf/turf');
const topojson = require('topojson-client');

const noaaColors = require('./app/alerts/colors/noaa_colors');
const US_STATES = require('./app/graphics/warning_graphic/us_states');
let getCities = null;
try { ({ getCities } = require('./app/tools/manual_storm_track/mst_cities')); } catch { /* population chip optional */ }

const ROOT = __dirname;
const W = 1200;
const H = 675;

// The Mapbox token is already public (shipped in the client bundle at
// app/core/map/map.js). Server reads an env override, else falls back to it.
const MAPBOX_TOKEN = process.env.MAPBOX_STATIC_TOKEN ||
  'pk.eyJ1IjoiZGF2aWR3YWxsaXMwMCIsImEiOiJjbHlpNHJvZ2QwYzduMmpvZmdjejlkYjAxIn0.JNNcliJC4EFmok7iT5I6MQ';
const MAPBOX_STYLE = process.env.MAPBOX_STATIC_STYLE || 'dark-v11';

// Free, key-less NOAA reflectivity ImageServer (EPSG:4326 PNG over a bbox).
const RADAR_SERVICE =
  'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer/exportImage';

// NWS requires a descriptive User-Agent on api.weather.gov; reuse it here too.
const USER_AGENT = process.env.NWS_USER_AGENT ||
  'VortexRadar (vortex-dome22.onrender.com, davidwallis17@gmail.com)';

// Font family to draw with. Render's Ubuntu base has DejaVu/Liberation, so
// 'sans-serif' resolves; if a bundled font is registered we prefer it.
let FONT = 'sans-serif';
try {
  // If a font file is dropped at fonts/ it will be picked up and preferred.
  const fp = path.join(ROOT, 'fonts', 'Inter.ttf');
  if (require('fs').existsSync(fp) && GlobalFonts.registerFromPath(fp, 'VortexUI')) FONT = 'VortexUI';
} catch { /* fall back to sans-serif */ }

// ── state → primary IANA timezone (for a correct local "until" abbreviation) ──
const STATE_TZ = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise',
  IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago', KS: 'America/Chicago',
  KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles',
  NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York',
  NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver', DC: 'America/New_York', PR: 'America/Puerto_Rico',
};

// ── web-mercator helpers ──────────────────────────────────────────────────────
function mercNorm(lat) {
  const r = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; // 0 (N) .. 1 (S)
}
function invMercNorm(y) {
  const n = Math.PI * (1 - 2 * y);
  return Math.atan(Math.sinh(n)) * 180 / Math.PI;
}

// Frame a bbox [w,s,e,n] into the WxH canvas with padding; returns the map view.
function fitView([w, s, e, n]) {
  const padX = Math.max((e - w) * 0.14, 0.05);
  const padY = Math.max((n - s) * 0.14, 0.05);
  w -= padX; e += padX; s -= padY; n += padY;
  s = Math.max(s, -84); n = Math.min(n, 84);
  const centerLon = (w + e) / 2;
  const centerLat = invMercNorm((mercNorm(s) + mercNorm(n)) / 2);
  const lonFrac = Math.max((e - w) / 360, 1e-6);
  const latFrac = Math.max(Math.abs(mercNorm(s) - mercNorm(n)), 1e-6);
  const zoomX = Math.log2(W / (256 * lonFrac));
  const zoomY = Math.log2(H / (256 * latFrac));
  let zoom = Math.min(zoomX, zoomY);
  zoom = Math.max(3, Math.min(12, zoom));
  return { centerLon, centerLat, zoom };
}

function projector(view) {
  const worldSize = 256 * Math.pow(2, view.zoom);
  const cx = (view.centerLon + 180) / 360 * worldSize;
  const cy = mercNorm(view.centerLat) * worldSize;
  return {
    worldSize, cx, cy,
    project(lon, lat) {
      return { x: W / 2 + ((lon + 180) / 360 * worldSize - cx), y: H / 2 + (mercNorm(lat) * worldSize - cy) };
    },
    lonAt(px) { return ((cx + (px - W / 2)) / worldSize) * 360 - 180; },
    latAt(py) { return invMercNorm((cy + (py - H / 2)) / worldSize); },
  };
}

// ── geometry helpers ──────────────────────────────────────────────────────────
function eachRing(geom, fn) {
  if (!geom) return;
  if (geom.type === 'Polygon') geom.coordinates.forEach(fn);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((poly) => poly.forEach(fn));
}
function geometryBbox(geom) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  eachRing(geom, (ring) => ring.forEach(([lon, lat]) => {
    if (lon < w) w = lon; if (lon > e) e = lon;
    if (lat < s) s = lat; if (lat > n) n = lat;
  }));
  return isFinite(w) ? [w, s, e, n] : null;
}

// USPS state codes affected by an alert (from areaDesc "County, ST; …" + geocode).
function affectedStates(props) {
  const set = new Set();
  const desc = String(props.areaDesc || '');
  const re = /,\s*([A-Z]{2})(?:;|$)/g; let m;
  while ((m = re.exec(desc))) set.add(m[1]);
  // SAME codes: first 2 digits are the state FIPS -> we only need USPS, which
  // areaDesc already gives; keep it simple and reliable.
  return [...set];
}

// Bbox for a state (from the bundled us_states.js FeatureCollection).
const STATE_NAME = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia', PR: 'Puerto Rico',
};
function stateFeature(abbr) {
  const name = STATE_NAME[abbr];
  return US_STATES.features.find((f) => f.properties.name === name) || null;
}
function statesBbox(abbrs) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const a of abbrs) {
    const f = stateFeature(a);
    if (!f) continue;
    const bb = geometryBbox(f.geometry);
    if (!bb) continue;
    w = Math.min(w, bb[0]); s = Math.min(s, bb[1]); e = Math.max(e, bb[2]); n = Math.max(n, bb[3]);
  }
  return isFinite(w) ? [w, s, e, n] : null;
}

// 2-digit state FIPS → USPS (for decoding county TopoJSON ids).
const STATE_FIPS_ABBR = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
  '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
  '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR',
};
const ABBR_OF = {}; for (const [a, n] of Object.entries(STATE_NAME)) ABBR_OF[n] = a;

// County geometry (bundled us-atlas TopoJSON), decoded once, grouped by state.
let _countyGeo = null;
function loadCountyGeo() {
  if (_countyGeo !== null) return _countyGeo;
  try {
    const topo = JSON.parse(fs.readFileSync(path.join(ROOT, 'graphics', 'studio', 'geo', 'counties-10m.json'), 'utf8'));
    const counties = topojson.feature(topo, topo.objects.counties).features;
    const byAbbr = {};
    for (const f of counties) {
      const fips = String(f.id).padStart(5, '0');
      const abbr = STATE_FIPS_ABBR[fips.slice(0, 2)];
      if (!abbr) continue;
      f.fips = fips; f.stateAbbr = abbr;
      (byAbbr[abbr] = byAbbr[abbr] || []).push(f);
    }
    _countyGeo = { byAbbr };
  } catch (e) {
    console.warn('[NWS-BSKY] county geometry unavailable:', e.message);
    _countyGeo = { byAbbr: null };
  }
  return _countyGeo;
}

// Counties (in the affected states) the warning polygon actually touches.
function affectedCounties(geom, abbrs, geo) {
  if (!geo || !geo.byAbbr || !geom) return [];
  let poly; try { poly = turf.feature(geom); } catch { return []; }
  const out = [];
  for (const abbr of abbrs) for (const c of (geo.byAbbr[abbr] || [])) {
    try { if (turf.booleanIntersects(poly, c)) out.push(c); } catch { /* skip */ }
  }
  return out;
}

// Rough population inside the polygon (sum of city populations within it).
function estimatePopulation(geom) {
  if (!getCities || !geom) return null;
  try {
    const poly = turf.feature(geom);
    const bb = turf.bbox(poly);
    let pop = 0;
    for (const c of getCities()) {
      if (c.lon < bb[0] || c.lon > bb[2] || c.lat < bb[1] || c.lat > bb[3]) continue;
      if (turf.booleanPointInPolygon(turf.point([c.lon, c.lat]), poly)) pop += c.population || 0;
    }
    return pop > 0 ? pop : null;
  } catch { return null; }
}

const param = (p, k) => (p && p.parameters && p.parameters[k] && p.parameters[k][0]) || null;
const DIR_ABBR = { north: 'N', south: 'S', east: 'E', west: 'W', northeast: 'NE', northwest: 'NW', southeast: 'SE', southwest: 'SW' };
function parseMovement(desc) {
  const mv = String(desc || '').match(/moving\s+(northeast|northwest|southeast|southwest|north|south|east|west)\w*\s+at\s+(\d+)\s*mph/i);
  return mv ? `${DIR_ABBR[mv[1].toLowerCase()] || mv[1]} at ${mv[2]} MPH` : null;
}

// #rrggbb / rgb() → rgba string; light mix toward white.
function toRgb(c) {
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c || '');
  if (m) return [+m[1], +m[2], +m[3]];
  const h = String(c || '#c8102e').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbaFrom(c, a) { const [r, g, b] = toRgb(c); return `rgba(${r},${g},${b},${a})`; }
function lightenC(c, t) { const [r, g, b] = toRgb(c); const mix = (v) => Math.round(v + (255 - v) * t); return `rgb(${mix(r)},${mix(g)},${mix(b)})`; }

// Equirectangular projection fitting a [minX,minY,maxX,maxY] bbox into w×h,
// latitude-corrected so shapes aren't stretched (mirrors warning_graphic.js).
function fitProjection(bbox, w, h, padFrac) {
  let [minX, minY, maxX, maxY] = bbox;
  const padX = (maxX - minX) * (padFrac || 0.07);
  const padY = (maxY - minY) * (padFrac || 0.07);
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  const midLat = ((minY + maxY) / 2) * Math.PI / 180;
  const k = Math.cos(midLat) || 1;
  const geoW = (maxX - minX) * k, geoH = (maxY - minY);
  const s = Math.min(w / geoW, h / geoH);
  const offX = (w - geoW * s) / 2, offY = (h - geoH * s) / 2;
  return (lng, lat) => [offX + (lng - minX) * k * s, offY + (maxY - lat) * s];
}
function tracePath(ctx, geom, project) {
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  ctx.beginPath();
  for (const poly of polys) for (const ring of poly) {
    ring.forEach((pt, i) => { const [x, y] = project(pt[0], pt[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
  }
}
function haloText(ctx, text, x, y, px) {
  ctx.font = `700 ${px}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, px * 0.28);
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff'; ctx.fillText(text, x, y);
}

// Zoomed state "spotlight" with county detail — returns an off-screen canvas.
// Mirrors renderSpotlight() in app/graphics/warning_graphic/warning_graphic.js.
function renderSpotlight(w, h, geom, stateNames, accent, geo, affected) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext('2d');
  const affSet = new Set((affected || []).map((c) => c.fips));
  const affStates = US_STATES.features.filter((f) => stateNames.includes(f.properties.name));
  if (!affStates.length || !geo || !geo.byAbbr) return null;

  // Frame to the affected counties (zoomed to the warning) so labels have room;
  // fall back to the whole state when we don't know the counties.
  let project;
  if (affected && affected.length) {
    const bb = turf.bbox(turf.featureCollection(affected.map((c) => turf.feature(c.geometry))));
    project = fitProjection(bb, w, h, 0.55);
  } else {
    const bb = turf.bbox(turf.featureCollection(affStates.map((f) => turf.feature(f.geometry))));
    project = fitProjection(bb, w, h, 0.07);
  }

  // 1) neighbor states (muted context)
  for (const f of US_STATES.features) {
    if (stateNames.includes(f.properties.name)) continue;
    tracePath(ctx, f.geometry, project);
    ctx.fillStyle = 'rgba(120,132,150,0.16)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
  }
  // 2) affected state fill
  for (const f of affStates) { tracePath(ctx, f.geometry, project); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill(); }

  // 3) county borders in the affected state(s)
  const abbrs = stateNames.map((n) => ABBR_OF[n]).filter(Boolean);
  const cList = [];
  for (const abbr of abbrs) for (const c of (geo.byAbbr[abbr] || [])) cList.push(c);
  ctx.lineWidth = 1;
  for (const c of cList) { tracePath(ctx, c.geometry, project); ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.stroke(); }

  // 4) highlight affected counties
  for (const c of cList) {
    if (!affSet.has(c.fips)) continue;
    tracePath(ctx, c.geometry, project);
    ctx.fillStyle = rgbaFrom(accent, 0.34); ctx.fill();
    ctx.strokeStyle = rgbaFrom(accent, 0.95); ctx.lineWidth = 1.4; ctx.stroke();
  }
  // 5) crisp state outline
  ctx.lineJoin = 'round';
  for (const f of affStates) { tracePath(ctx, f.geometry, project); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.2; ctx.stroke(); }
  // 6) the warning polygon
  if (geom) {
    tracePath(ctx, geom, project); ctx.fillStyle = rgbaFrom(accent, 0.16); ctx.fill('evenodd');
    tracePath(ctx, geom, project); ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.stroke();
    tracePath(ctx, geom, project); ctx.strokeStyle = lightenC(accent, 0.35); ctx.lineWidth = 2; ctx.stroke();
  }
  // 7) county labels. When we've zoomed to the affected cluster, label every
  // county in view (off-view ones are skipped by the bounds check below).
  const labelAll = (affected && affected.length) ? true : cList.length <= 46;
  const fontPx = Math.max(10, Math.round(w * 0.032));
  for (const c of cList) {
    const on = affSet.has(c.fips);
    if (!on && !labelAll) continue;
    let ctr; try { ctr = turf.getCoord(turf.centroid(c)); } catch { continue; }
    const [x, y] = project(ctr[0], ctr[1]);
    if (x < -20 || x > w + 20 || y < -10 || y > h + 10) continue;
    if (on) haloText(ctx, c.properties.name, x, y, fontPx);
    else {
      ctx.font = `600 ${Math.round(fontPx * 0.82)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText(c.properties.name, x, y);
    }
  }
  return cv;
}

// ── colors ────────────────────────────────────────────────────────────────────
function eventColor(event) {
  const c = noaaColors[event];
  if (c && c.rgb) return c.rgb;
  const e = (event || '').toLowerCase();
  if (e.includes('tornado')) return 'rgb(233, 51, 35)';
  if (e.includes('severe thunderstorm')) return 'rgb(244, 185, 65)';
  if (e.includes('flash flood') || e.includes('flood')) return 'rgb(103, 214, 96)';
  if (e.includes('winter') || e.includes('blizzard') || e.includes('ice') || e.includes('snow')) return 'rgb(146, 141, 233)';
  if (e.includes('marine')) return 'rgb(60, 170, 200)';
  if (e.includes('hurricane') || e.includes('tropical') || e.includes('storm surge')) return 'rgb(199, 63, 155)';
  return 'rgb(200, 200, 200)';
}
function rgba(rgbStr, a) {
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(rgbStr || '');
  if (!m) return `rgba(200,200,200,${a})`;
  return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
}

// ── network (guarded) ─────────────────────────────────────────────────────────
async function fetchBuffer(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}

async function loadBasemap(view) {
  const url = `https://api.mapbox.com/styles/v1/mapbox/${MAPBOX_STYLE}/static/` +
    `${view.centerLon.toFixed(5)},${view.centerLat.toFixed(5)},${view.zoom.toFixed(2)}/` +
    `${W}x${H}@2x?access_token=${MAPBOX_TOKEN}&attribution=false&logo=false`;
  try { return await loadImage(await fetchBuffer(url)); }
  catch (e) { console.warn('[NWS-BSKY] basemap fetch failed:', e.message); return null; }
}

// Warp the EPSG:4326 radar raster (over its own bbox) onto the mercator view,
// compositing over whatever is already on the canvas. No-op on any failure.
async function drawRadar(ctx, proj, view) {
  // Visible geographic rectangle of the current view (invert the corners).
  const vW = proj.lonAt(0), vE = proj.lonAt(W), vN = proj.latAt(0), vS = proj.latAt(H);
  const rw = Math.max(600, Math.round(1000));
  const rh = Math.max(1, Math.round(rw * (vN - vS) / (vE - vW)));
  const url = `${RADAR_SERVICE}?bbox=${vW},${vS},${vE},${vN}&bboxSR=4326&imageSR=4326` +
    `&size=${rw},${rh}&format=png32&transparent=true&f=image`;
  let img;
  try { img = await loadImage(await fetchBuffer(url)); }
  catch (e) { console.warn('[NWS-BSKY] radar fetch failed:', e.message); return; }

  const sw = img.width, sh = img.height;
  const src = createCanvas(sw, sh);
  src.getContext('2d').drawImage(img, 0, 0, sw, sh);
  const sdata = src.getContext('2d').getImageData(0, 0, sw, sh).data;

  const out = ctx.getImageData(0, 0, W, H);
  const od = out.data;
  const OPACITY = 0.72;
  for (let py = 0; py < H; py++) {
    const lat = proj.latAt(py + 0.5);
    const v = (vN - lat) / (vN - vS);
    if (v < 0 || v >= 1) continue;
    const sy = Math.min(sh - 1, (v * sh) | 0);
    for (let px = 0; px < W; px++) {
      const lon = proj.lonAt(px + 0.5);
      const u = (lon - vW) / (vE - vW);
      if (u < 0 || u >= 1) continue;
      const sx = Math.min(sw - 1, (u * sw) | 0);
      const si = (sy * sw + sx) * 4;
      const sa = sdata[si + 3];
      if (sa < 12) continue;
      const a = (sa / 255) * OPACITY;
      const di = (py * W + px) * 4;
      od[di] = sdata[si] * a + od[di] * (1 - a);
      od[di + 1] = sdata[si + 1] * a + od[di + 1] * (1 - a);
      od[di + 2] = sdata[si + 2] * a + od[di + 2] * (1 - a);
      od[di + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

// ── text helpers ──────────────────────────────────────────────────────────────
function fitText(ctx, text, maxW, weight, startPx, minPx) {
  let size = startPx;
  for (; size >= minPx; size--) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  return size;
}
function truncateToWidth(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// Compact county list from areaDesc ("County1, ST; County2, ST").
function countyList(areaDesc) {
  const parts = String(areaDesc || '').split(';').map((p) => p.trim()).filter(Boolean)
    .map((p) => p.replace(/,\s*[A-Z]{2}$/, ''));
  return parts;
}
function compactCounties(parts, maxNames = 4) {
  if (!parts.length) return '';
  if (parts.length <= maxNames) return parts.join(', ');
  return `${parts.slice(0, maxNames).join(', ')} +${parts.length - maxNames} more`;
}

// ── US locator inset ──────────────────────────────────────────────────────────
function drawLocator(ctx, x, y, w, h, highlightAbbrs) {
  // Continental-US bbox for the mini map.
  const B = [-125, 24, -66.5, 49.5];
  const sx = w / (B[2] - B[0]);
  const sy = h / (B[3] - B[1]);
  const s = Math.min(sx, sy);
  const offX = x + (w - (B[2] - B[0]) * s) / 2;
  const offY = y + (h - (B[3] - B[1]) * s) / 2;
  const P = (lon, lat) => [offX + (lon - B[0]) * s, offY + (B[3] - lat) * s];

  ctx.save();
  ctx.fillStyle = 'rgba(8,14,26,0.86)';
  roundRect(ctx, x - 6, y - 6, w + 12, h + 12, 8); ctx.fill();
  // Clip to the panel so any stray geometry can't bleed outside the inset.
  roundRect(ctx, x - 6, y - 6, w + 12, h + 12, 8); ctx.clip();

  const NON_CONUS = new Set(['Alaska', 'Hawaii', 'Puerto Rico']);
  const hi = new Set(highlightAbbrs.map((a) => STATE_NAME[a]));
  for (const f of US_STATES.features) {
    if (NON_CONUS.has(f.properties.name)) continue; // equirectangular inset = CONUS only
    const isHi = hi.has(f.properties.name);
    ctx.beginPath();
    eachRing(f.geometry, (ring) => {
      ring.forEach(([lon, lat], i) => { const [X, Y] = P(lon, lat); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.closePath();
    });
    ctx.fillStyle = isHi ? '#ffd23f' : 'rgba(120,140,170,0.28)';
    ctx.fill();
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── main ──────────────────────────────────────────────────────────────────────
async function renderWarningGraphic(alert) {
  const props = (alert && alert.properties) || {};
  const geom = alert && alert.geometry;
  const event = props.event || 'Weather Warning';
  const accent = eventColor(event);

  const states = affectedStates(props);
  const bbox = geometryBbox(geom) || statesBbox(states) || [-98, 35, -95, 38];
  const view = fitView(bbox);
  const proj = projector(view);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 1) base fill (in case basemap fails) + basemap
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, W, H);
  const base = await loadBasemap(view);
  if (base) ctx.drawImage(base, 0, 0, W, H);

  // 2) radar (guarded; composites over basemap)
  await drawRadar(ctx, proj, view);

  // 3) warning polygon in official color
  if (geometryBbox(geom)) {
    ctx.save();
    ctx.beginPath();
    eachRing(geom, (ring) => {
      ring.forEach(([lon, lat], i) => { const p = proj.project(lon, lat); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.closePath();
    });
    ctx.fillStyle = rgba(accent, 0.16);
    ctx.fill('evenodd');
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = accent;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.restore();
  }

  // subtle top vignette for banner/text legibility
  const gTop = ctx.createLinearGradient(0, 0, 0, 120);
  gTop.addColorStop(0, 'rgba(3,7,14,0.55)'); gTop.addColorStop(1, 'rgba(3,7,14,0)');
  ctx.fillStyle = gTop; ctx.fillRect(0, 0, W, 120);

  // County/state context we reuse across the chrome.
  const stateNames = states.map((a) => STATE_NAME[a]).filter(Boolean);
  const geo = loadCountyGeo();
  const affected = affectedCounties(geom, states, geo);

  // ── 4) top banner: EVENT + "IN STATE", brand on the right ────────────────────
  const bannerH = 96;
  ctx.fillStyle = accent; ctx.fillRect(0, 0, W, bannerH);
  ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(0, bannerH - 6, W, 6);

  const subState = stateNames.length ? 'IN ' + stateNames.join(' & ').toUpperCase() : '';
  ctx.textBaseline = 'alphabetic';
  const evText = event.toUpperCase();
  const evSize = fitText(ctx, evText, W - 320, '800', 48, 28);
  ctx.font = `800 ${evSize}px ${FONT}`; ctx.fillStyle = '#ffffff';
  ctx.fillText(evText, 26, subState ? 46 : 60);
  if (subState) {
    ctx.font = `800 18px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(truncateToWidth(ctx, subState, W - 320), 27, 74);
  }
  // branding (right side of banner)
  ctx.textAlign = 'right';
  ctx.font = `800 22px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillText('VORTEX RADAR', W - 24, bannerH / 2 - 6);
  ctx.font = `700 12px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillText('LIVE WARNING', W - 24, bannerH / 2 + 14);
  ctx.textAlign = 'left';

  const tz = STATE_TZ[states[0]] || tzFromLon((bbox[0] + bbox[2]) / 2);
  const untilStr = formatUntil(props.expires || props.ends, tz);
  const office = officeName(props.senderName);
  const issued = formatStamp(props.sent || props.effective, tz);

  // ── hazard chips (parsed from NWS params) ────────────────────────────────────
  const chips = [];
  const addChip = (label, val) => { if (val) chips.push({ label, val: String(val) }); };
  addChip('WIND', param(props, 'maxWindGust'));
  addChip('HAIL', param(props, 'maxHailSize') ? `${param(props, 'maxHailSize')}"` : null);
  addChip('TORNADO', param(props, 'tornadoDetection'));
  addChip('DAMAGE', param(props, 'thunderstormDamageThreat') || param(props, 'tornadoDamageThreat'));
  addChip('MOVING', parseMovement(props.description));
  const pop = estimatePopulation(geom);
  addChip('POP', pop ? pop.toLocaleString() : null);

  // ── 5) county spotlight inset (bottom-left, above the strip) ──────────────────
  const stripH = 150;
  const insetBottom = H - stripH - 12;
  if (geo && geo.byAbbr && stateNames.length) {
    const mapW = 256, mapH = 156;
    const spot = renderSpotlight(mapW * 2, mapH * 2, geom, stateNames, accent, geo, affected);
    if (spot) {
      const cw = mapW + 20, ch = mapH + 62, cx = 24, cy = insetBottom - ch;
      ctx.save();
      roundRect(ctx, cx, cy, cw, ch, 12);
      ctx.fillStyle = 'rgba(8,13,23,0.84)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.clip();
      // header
      ctx.font = `800 11px ${FONT}`; ctx.fillStyle = '#9fd2ff'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillText(`AFFECTED AREA · ${stateNames.join(' & ').toUpperCase()}`, cx + 12, cy + 20);
      // spotlight map
      ctx.drawImage(spot, cx + 10, cy + 30, mapW, mapH);
      // caption
      const cap = affected.length ? `${affected.length} ${affected.length === 1 ? 'county' : 'counties'} affected` : stateNames.join(' & ');
      ctx.beginPath(); ctx.arc(cx + 16, cy + ch - 15, 5, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
      ctx.font = `700 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(truncateToWidth(ctx, cap, cw - 40), cx + 27, cy + ch - 10);
      ctx.restore();
    }
  }

  // ── reflectivity legend inset (bottom-right, above the strip) ─────────────────
  {
    const lw = 214, lh = 66, lx = W - 24 - lw, ly = insetBottom - lh;
    roundRect(ctx, lx, ly, lw, lh, 12);
    ctx.fillStyle = 'rgba(8,13,23,0.82)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = `700 11px ${FONT}`; ctx.fillStyle = 'rgba(230,238,247,0.85)'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('REFLECTIVITY (dBZ)', lx + 14, ly + 20);
    const bx = lx + 14, by = ly + 28, bw = lw - 28, bh = 11;
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    ['#00d200', '#00a000', '#ffff00', '#ff9000', '#ff0000', '#c00000', '#ff00ff', '#a000a0']
      .forEach((c, i, a) => grad.addColorStop(i / (a.length - 1), c));
    ctx.fillStyle = grad; roundRect(ctx, bx, by, bw, bh, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = `600 11px ${FONT}`; ctx.fillStyle = 'rgba(200,212,226,0.72)';
    const marks = [['5', bx], ['30', bx + bw * 0.33], ['50', bx + bw * 0.62], ['75', bx + bw]];
    marks.forEach(([t, mx], i) => { ctx.textAlign = i === marks.length - 1 ? 'right' : (i === 0 ? 'left' : 'center'); ctx.fillText(t, mx, by + bh + 15); });
    ctx.textAlign = 'left';
  }

  // ── 6) bottom info strip (lower third) ───────────────────────────────────────
  const gStrip = ctx.createLinearGradient(0, H - stripH, 0, H);
  gStrip.addColorStop(0, 'rgba(3,7,14,0)'); gStrip.addColorStop(0.42, 'rgba(3,7,14,0.80)'); gStrip.addColorStop(1, 'rgba(3,7,14,0.96)');
  ctx.fillStyle = gStrip; ctx.fillRect(0, H - stripH, W, stripH);
  ctx.fillStyle = accent; ctx.fillRect(0, H - stripH, W, 3);

  // draw hazard chips right-to-left; remember where the cluster starts.
  let chipsLeft = W - 24;
  if (chips.length) {
    const chipCY = H - stripH + 46;
    let cursor = W - 24;
    for (const chip of chips) {
      ctx.font = `800 16px ${FONT}`; const vw = ctx.measureText(chip.val).width;
      ctx.font = `700 10px ${FONT}`; const lwid = ctx.measureText(chip.label).width;
      const cw = Math.max(vw, lwid) + 26, chh = 46;
      const x = cursor - cw;
      if (x < W * 0.46) break; // keep the left half for the area/until text
      const y = chipCY - chh / 2;
      roundRect(ctx, x, y, cw, chh, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.font = `700 10px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.60)';
      ctx.fillText(chip.label, x + 13, y + 17);
      ctx.font = `800 16px ${FONT}`; ctx.fillStyle = '#ffffff';
      ctx.fillText(chip.val, x + 13, y + 36);
      cursor = x - 8; chipsLeft = x;
    }
  }

  const leftMaxW = (chips.length ? chipsLeft : W - 24) - 26 - 18;
  const areaLine = compactCounties(countyList(props.areaDesc), 5) || (props.areaDesc || '');
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 28px ${FONT}`; ctx.fillStyle = '#ffffff';
  ctx.fillText(truncateToWidth(ctx, areaLine, leftMaxW), 26, H - stripH + 46);

  ctx.font = `700 19px ${FONT}`; ctx.fillStyle = lighten(accent);
  const infoLine = [untilStr ? `Until ${untilStr}` : null, office ? `NWS ${office}` : null].filter(Boolean).join('   •   ');
  ctx.fillText(truncateToWidth(ctx, infoLine, leftMaxW), 26, H - stripH + 78);

  if (issued) {
    ctx.font = `500 14px ${FONT}`; ctx.fillStyle = 'rgba(190,205,222,0.72)';
    ctx.fillText(`Issued ${issued}  ·  NEXRAD base reflectivity, NWS`, 26, H - 18);
  }

  return canvas.toBuffer('image/png');
}

// ── formatting ────────────────────────────────────────────────────────────────
function tzFromLon(lon) {
  if (!isFinite(lon)) return null;
  if (lon > -87.5) return 'America/New_York';
  if (lon > -101) return 'America/Chicago';
  if (lon > -115) return 'America/Denver';
  if (lon > -130) return 'America/Los_Angeles';
  return 'America/Anchorage';
}
function officeName(senderName) {
  // "NWS Nashville TN" -> "Nashville TN"
  return String(senderName || '').replace(/^NWS\s+/i, '').trim();
}
function lighten(rgbStr) {
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(rgbStr || '');
  if (!m) return '#cfe0f2';
  const mix = (c) => Math.round(c + (255 - c) * 0.45);
  return `rgb(${mix(+m[1])},${mix(+m[2])},${mix(+m[3])})`;
}
function formatUntil(iso, tz) {
  if (!iso) return '';
  try {
    let dt = DateTime.fromISO(iso, { setZone: true });
    if (tz) dt = dt.setZone(tz);
    return dt.toFormat('h:mm a ZZZZ'); // e.g. 5:45 PM CDT
  } catch { return ''; }
}
function formatStamp(iso, tz) {
  if (!iso) return '';
  try {
    let dt = DateTime.fromISO(iso, { setZone: true });
    if (tz) dt = dt.setZone(tz);
    return dt.toFormat('ccc h:mm a ZZZZ');
  } catch { return ''; }
}

// Resolve the alert's display timezone (affected state, else longitude band).
function alertTz(alert) {
  const props = (alert && alert.properties) || {};
  const states = affectedStates(props);
  const bbox = geometryBbox(alert && alert.geometry) || statesBbox(states) || [-97, 35, -95, 37];
  return STATE_TZ[states[0]] || tzFromLon((bbox[0] + bbox[2]) / 2);
}
// "5:45 PM CDT" for the alert's expiration (in its local zone). '' if unknown.
function untilLabel(alert) {
  const p = (alert && alert.properties) || {};
  return formatUntil(p.expires || p.ends, alertTz(alert));
}
// Compact affected-area string ("A, B, C +N more"). Never empty if areaDesc set.
function areaLabel(alert, maxNames = 5) {
  const p = (alert && alert.properties) || {};
  return compactCounties(countyList(p.areaDesc), maxNames) || String(p.areaDesc || '');
}

module.exports = {
  renderWarningGraphic,
  untilLabel, areaLabel, officeName, affectedStates, countyList, compactCounties, eventColor,
  _internal: { fitView, projector, formatUntil, alertTz },
};
