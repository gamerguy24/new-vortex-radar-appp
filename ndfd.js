/*
 * ndfd.js
 * Makes the NWS NDFD (2.5 km gridded forecast) plottable. NDFD lives on S3 as
 * per-element files (opnl/AR.conus/<VP>/ds.<elem>.bin) — each is a run of GRIB2
 * messages (one per forecast time) wrapped in WMO headers. We fetch a file
 * (cached), split it into messages, and decode+render a chosen one to a PNG
 * overlay with the same pipeline as the other models. Lambert grid + complex
 * packing → fully supported by grib2_decode.js.
 *
 *   GET /api/models/ndfd/elem?vp&elem              -> { count, times:[{i,fhr}] }
 *   GET /api/models/ndfd/elemfield?vp&elem&msg&bbox&w -> colorized PNG
 */

const { renderField, legendFor } = require('./grib2_render');

const BUCKET = 'noaa-ndfd-pds';
const ROOT = 'opnl/AR.conus';
const s3 = (key) => `https://${BUCKET}.s3.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`;

// Element name -> a GRIB variable label (drives the color ramp via classify()).
const NDFD_VAR = {
  temp: 'TMP', maxt: 'TMAX', mint: 'TMIN', td: 'DPT', apt: 'APT',
  wspd: 'WIND', wgust: 'GUST', qpf: 'APCP', snow: 'ASNOW', iceaccum: 'APCP',
  sky: 'TCDC', rhm: 'RH', maxrh: 'RH', minrh: 'RH', pop12: 'POP',
};
// The curated fields we expose (label + element + emoji), all decode cleanly.
const NDFD_FIELDS = [
  { label: '2 m Temp', elem: 'temp', icon: '🌡️' },
  { label: 'Max Temp', elem: 'maxt', icon: '🔥' },
  { label: 'Min Temp', elem: 'mint', icon: '❄️' },
  { label: 'Dewpoint', elem: 'td', icon: '💧' },
  { label: 'Apparent Temp', elem: 'apt', icon: '🥵' },
  { label: 'Sky Cover', elem: 'sky', icon: '☁️' },
  { label: 'Rel. Humidity', elem: 'rhm', icon: '💦' },
  { label: 'PoP (12 hr)', elem: 'pop12', icon: '🌧️' },
  { label: 'Wind Speed', elem: 'wspd', icon: '🌬️' },
  { label: 'Wind Gust', elem: 'wgust', icon: '💨' },
  { label: 'QPF', elem: 'qpf', icon: '🌧️' },
  { label: 'Snow', elem: 'snow', icon: '🌨️' },
];
const VPS = ['VP.001-003', 'VP.004-007', 'VP.008-450'];

// ── raw file cache (whole element files; ~1 MB × 41 messages ≈ 40 MB each) ─────
const CACHE = { max: 260 * 1024 * 1024, bytes: 0, map: new Map() };
function fget(k) { const v = CACHE.map.get(k); if (v) { CACHE.map.delete(k); CACHE.map.set(k, v); } return v; }
function fset(k, buf) {
  if (CACHE.map.has(k)) { CACHE.bytes -= CACHE.map.get(k).length; CACHE.map.delete(k); }
  CACHE.map.set(k, buf); CACHE.bytes += buf.length;
  while (CACHE.bytes > CACHE.max && CACHE.map.size) {
    const fk = CACHE.map.keys().next().value;
    CACHE.bytes -= CACHE.map.get(fk).length; CACHE.map.delete(fk);
  }
}
async function fetchFile(vp, elem) {
  const key = `${ROOT}/${vp}/ds.${elem}.bin`;
  let buf = fget(key);
  if (!buf) {
    const r = await fetch(s3(key));
    if (!r.ok) throw new Error('S3 ' + r.status);
    buf = Buffer.from(await r.arrayBuffer());
    fset(key, buf);
  }
  return buf;
}

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

// Split concatenated GRIB2 messages (each preceded by a WMO header block).
function splitMessages(buf) {
  const msgs = []; const n = buf.length;
  for (let i = 0; i + 16 < n; i++) {
    if (buf[i] === 71 && buf[i + 1] === 82 && buf[i + 2] === 73 && buf[i + 3] === 66 && buf[i + 7] === 2) {
      const len = u32(buf, i + 8) * 4294967296 + u32(buf, i + 12);
      if (len > 0 && i + len <= n && buf[i + len - 4] === 55 && buf[i + len - 1] === 55) {
        msgs.push({ start: i, len });
        i += len - 1;
      }
    }
  }
  return msgs;
}

// Forecast time (in section-4 units, usually hours) of a message.
function forecastHour(buf, start) {
  try {
    let off = start + 16, len = u32(buf, off); off += len; // skip section 1
    while (off < buf.length - 4) {
      const tag = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
      if (tag === '7777') break;
      len = u32(buf, off);
      if (buf[off + 4] === 4) return u32(buf, off + 18); // section 4: forecast time
      off += len;
    }
  } catch (e) { /* ignore */ }
  return null;
}

const VALID_ELEM = /^[a-z0-9]+$/;
const VALID_VP = /^VP\.[0-9-]+$/;

function attachNdfd(app, guard) {
  const g = guard || ((req, res, next) => next());

  app.get('/api/models/ndfd/catalog', g, (req, res) => res.json({ fields: NDFD_FIELDS, vps: VPS }));

  app.get('/api/models/ndfd/elem', g, async (req, res) => {
    const vp = String(req.query.vp || ''), elem = String(req.query.elem || '');
    if (!VALID_VP.test(vp) || !VALID_ELEM.test(elem)) return res.status(400).json({ error: 'vp & elem required' });
    try {
      const buf = await fetchFile(vp, elem);
      const msgs = splitMessages(buf);
      res.json({ vp, elem, count: msgs.length, times: msgs.map((m, i) => ({ i, fhr: forecastHour(buf, m.start) })) });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.get('/api/models/ndfd/elemfield', g, async (req, res) => {
    const vp = String(req.query.vp || ''), elem = String(req.query.elem || '');
    const mi = Number(req.query.msg || 0);
    if (!VALID_VP.test(vp) || !VALID_ELEM.test(elem)) return res.status(400).json({ error: 'vp & elem required' });
    let bbox = [-125, 24, -66.5, 50];
    if (req.query.bbox) {
      const p = String(req.query.bbox).split(',').map(Number);
      if (p.length === 4 && p.every(Number.isFinite) && p[2] > p[0] && p[3] > p[1]) {
        bbox = [Math.max(-179, p[0]), Math.max(-85, p[1]), Math.min(179, p[2]), Math.min(85, p[3])];
      }
    }
    const maxW = Math.max(60, Math.min(1600, Number(req.query.w) || 1400));
    try {
      const buf = await fetchFile(vp, elem);
      const msgs = splitMessages(buf);
      if (!msgs.length) return res.status(404).json({ error: 'No GRIB messages in element file' });
      const m = msgs[Math.max(0, Math.min(msgs.length - 1, mi))];
      const bytes = new Uint8Array(buf.subarray(m.start, m.start + m.len));
      const variable = NDFD_VAR[elem] || elem.toUpperCase();
      const { png } = renderField(bytes, variable, bbox, maxW);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Bbox', bbox.join(','));
      res.setHeader('X-Var', variable);
      res.setHeader('Access-Control-Expose-Headers', 'X-Legend, X-Var, X-Bbox');
      res.setHeader('X-Legend', JSON.stringify(legendFor(variable)));
      res.send(Buffer.from(png));
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });
}

module.exports = { attachNdfd, NDFD_FIELDS, VPS };
