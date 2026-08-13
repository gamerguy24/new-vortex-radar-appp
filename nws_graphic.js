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

const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { DateTime } = require('luxon');

const noaaColors = require('./app/alerts/colors/noaa_colors');
const US_STATES = require('./app/graphics/warning_graphic/us_states');

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

  // subtle top/bottom vignette for text legibility
  const gTop = ctx.createLinearGradient(0, 0, 0, 120);
  gTop.addColorStop(0, 'rgba(3,7,14,0.55)'); gTop.addColorStop(1, 'rgba(3,7,14,0)');
  ctx.fillStyle = gTop; ctx.fillRect(0, 0, W, 120);

  // 4) top banner
  const bannerH = 96;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, bannerH);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(0, bannerH - 6, W, 6);

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  const evText = event.toUpperCase();
  const evSize = fitText(ctx, evText, W - 300, '800', 52, 30);
  ctx.font = `800 ${evSize}px ${FONT}`;
  ctx.fillText(evText, 26, bannerH / 2 + 2);

  // branding (right side of banner)
  ctx.textAlign = 'right';
  ctx.font = `800 22px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillText('VORTEX RADAR', W - 24, bannerH / 2 - 9);
  ctx.font = `600 13px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText('LIVE WARNING', W - 24, bannerH / 2 + 13);
  ctx.textAlign = 'left';

  // 5) bottom info strip
  const stripH = 132;
  const gStrip = ctx.createLinearGradient(0, H - stripH, 0, H);
  gStrip.addColorStop(0, 'rgba(3,7,14,0)'); gStrip.addColorStop(0.28, 'rgba(3,7,14,0.82)'); gStrip.addColorStop(1, 'rgba(3,7,14,0.96)');
  ctx.fillStyle = gStrip; ctx.fillRect(0, H - stripH, W, stripH);
  // accent rule
  ctx.fillStyle = accent; ctx.fillRect(0, H - stripH, W, 3);

  const counties = countyList(props.areaDesc);
  const areaLine = compactCounties(counties, 4) || (props.areaDesc || '');
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 27px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(truncateToWidth(ctx, areaLine, W - 210), 26, H - stripH + 44);

  // "Until …" + issuing office. Prefer the affected state's zone; for marine /
  // stateless areas, fall back to a rough longitude band so the label reads
  // "EDT/CDT/…" rather than a bare "UTC-4" offset.
  const tz = STATE_TZ[states[0]] || tzFromLon((bbox[0] + bbox[2]) / 2);
  const untilStr = formatUntil(props.expires || props.ends, tz);
  const office = officeName(props.senderName);
  ctx.font = `600 19px ${FONT}`;
  ctx.fillStyle = rgba(accent === 'rgb(200, 200, 200)' ? 'rgb(160,190,220)' : accent, 1);
  // brighten accent text for readability on dark
  ctx.fillStyle = lighten(accent);
  const infoLine = [untilStr ? `Until ${untilStr}` : null, office ? `NWS ${office}` : null].filter(Boolean).join('   •   ');
  ctx.fillText(truncateToWidth(ctx, infoLine, W - 210), 26, H - stripH + 74);

  // issued timestamp (bottom-left, dim)
  const issued = formatStamp(props.sent || props.effective, tz);
  if (issued) {
    ctx.font = `500 14px ${FONT}`;
    ctx.fillStyle = 'rgba(190,205,222,0.75)';
    ctx.fillText(`Issued ${issued}`, 26, H - 18);
  }

  // 6) US locator (bottom-right, above the strip text area)
  drawLocator(ctx, W - 176, H - stripH - 96, 150, 92, states);

  // radar attribution / legend chip (small, bottom-right of strip)
  ctx.font = `500 12px ${FONT}`;
  ctx.fillStyle = 'rgba(180,195,214,0.7)';
  ctx.textAlign = 'right';
  ctx.fillText('NEXRAD base reflectivity · NWS', W - 24, H - 18);
  ctx.textAlign = 'left';

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
