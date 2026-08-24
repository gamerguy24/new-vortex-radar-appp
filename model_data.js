/*
 * model_data.js
 * Access layer for NOAA numerical weather model archives on public S3 (no auth).
 * These are raw GRIB2 files (often 100s of MB), so the key trick is the `.idx`
 * sidecar every file has: it lists each GRIB2 message's byte offset + variable,
 * letting us HTTP-Range a single field (a few hundred KB) instead of the whole
 * file. Rendering (GRIB2 decode) is a later stage; this module just locates runs
 * and serves single-message byte ranges.
 *
 * Endpoints (all behind requireAuth), mounted by attachModels(app, requireAuth):
 *   GET /api/models                         -> catalog
 *   GET /api/models/:id/latest              -> newest available run (cycle models)
 *   GET /api/models/:id/hours?date&cycle&product   -> available forecast hours
 *   GET /api/models/:id/index?date&cycle&fhr&product -> parsed .idx messages
 *   GET /api/models/:id/grib?date&cycle&fhr&product&(msg|var&level) -> raw GRIB2 msg
 *   GET /api/models/:id/list?prefix         -> S3 listing (browse; used by NDFD)
 */

const { renderField, legendFor } = require('./grib2_render');
const { buildSounding } = require('./soundings_grib');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Optional SounderPy (Python) sounding renderer. When the host has it installed
// the sounding tool serves an exact SHARPpy/SounderPy image; if anything is
// missing or errors, the endpoint fails soft and the client falls back to the
// built-in JS renderer. Nothing else in the app depends on this.
const SOUNDERPY_PYTHON = process.env.SOUNDERPY_PYTHON || 'python3';
const SOUNDERPY_SCRIPT = path.join(__dirname, 'tools', 'sounding_sounderpy.py');
const SOUNDERPY_TIMEOUT_MS = parseInt(process.env.SOUNDERPY_TIMEOUT_MS, 10) || 60000;

function renderSounderpyImage(snd, meta) {
  return new Promise((resolve, reject) => {
    const base = path.join(os.tmpdir(), `vrsnd_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const jsonPath = base + '.json', pngPath = base + '.png';
    const cleanup = () => { try { fs.unlinkSync(jsonPath); } catch (e) {} try { fs.unlinkSync(pngPath); } catch (e) {} };
    try { fs.writeFileSync(jsonPath, JSON.stringify({ levels: snd.levels, surfaceZ: snd.surfaceZ, meta })); }
    catch (e) { return reject(e); }
    let stderr = '';
    let done = false;
    const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); fn(); };
    const py = spawn(SOUNDERPY_PYTHON, [SOUNDERPY_SCRIPT, jsonPath, pngPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => { try { py.kill('SIGKILL'); } catch (e) {} finish(() => { cleanup(); reject(new Error('render timed out')); }); }, SOUNDERPY_TIMEOUT_MS);
    py.stderr.on('data', (d) => { stderr += d.toString(); });
    py.on('error', (e) => finish(() => { cleanup(); reject(new Error('python not available (' + e.message + ')')); }));
    py.on('close', (code) => finish(() => {
      let buf = null;
      try { if (code === 0 && fs.existsSync(pngPath)) buf = fs.readFileSync(pngPath); } catch (e) {}
      cleanup();
      if (buf) resolve(buf);
      else reject(new Error((stderr.trim().split('\n').pop() || ('exit ' + code)).slice(0, 300)));
    }));
  });
}

// Byte-capped LRU of rendered field PNGs so scrubbing forecast hours / re-plotting
// is instant. Keyed by model+run+fhr+field+bbox.
const PNG_CACHE = { max: 120 * 1024 * 1024, bytes: 0, map: new Map() };
function pngGet(k) { const v = PNG_CACHE.map.get(k); if (v) { PNG_CACHE.map.delete(k); PNG_CACHE.map.set(k, v); } return v; }
function pngSet(k, buf) {
  if (PNG_CACHE.map.has(k)) { PNG_CACHE.bytes -= PNG_CACHE.map.get(k).png.length; PNG_CACHE.map.delete(k); }
  PNG_CACHE.map.set(k, buf); PNG_CACHE.bytes += buf.png.length;
  while (PNG_CACHE.bytes > PNG_CACHE.max && PNG_CACHE.map.size) {
    const fk = PNG_CACHE.map.keys().next().value;
    PNG_CACHE.bytes -= PNG_CACHE.map.get(fk).png.length; PNG_CACHE.map.delete(fk);
  }
}

const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(n).padStart(3, '0');

// ─── Model catalog ───────────────────────────────────────────────────────────
const MODELS = {
  hrrr: {
    name: 'HRRR (3 km CONUS)', bucket: 'noaa-hrrr-bdp-pds', region: 'us-east-1',
    type: 'cycle', hourly: true, fhrMax: 48, fhrDigits: 2,
    products: { sfc: 'wrfsfc', prs: 'wrfprs', nat: 'wrfnat', subh: 'wrfsubh' },
    defaultProduct: 'sfc', soundingProduct: 'prs',
    dir: (d) => `hrrr.${d}/conus/`,
    file: (d, c, f, p) => `hrrr.${d}/conus/hrrr.t${c}z.${MODELS.hrrr.products[p || 'sfc']}f${pad2(f)}.grib2`,
    // match a product's files in a dir listing -> capture forecast hour
    fhrRe: (p) => new RegExp(`hrrr\\.t\\d{2}z\\.${MODELS.hrrr.products[p || 'sfc']}f(\\d{2})\\.grib2$`),
  },
  gfs: {
    name: 'GFS (0.25° global)', bucket: 'noaa-gfs-bdp-pds', region: 'us-east-1',
    type: 'cycle', cycles: [0, 6, 12, 18], fhrMax: 384, fhrDigits: 3,
    products: { pgrb2: 'pgrb2.0p25' }, defaultProduct: 'pgrb2',
    dir: (d, c) => `gfs.${d}/${c}/atmos/`,
    file: (d, c, f) => `gfs.${d}/${c}/atmos/gfs.t${c}z.pgrb2.0p25.f${pad3(f)}`,
    fhrRe: () => /gfs\.t\d{2}z\.pgrb2\.0p25\.f(\d{3})$/,
  },
  nam: {
    name: 'NAM (12 km CONUS)', bucket: 'noaa-nam-pds', region: 'us-east-1',
    type: 'cycle', cycles: [0, 6, 12, 18], fhrMax: 84, fhrDigits: 2,
    products: { awphys: 'awphys' }, defaultProduct: 'awphys',
    dir: (d) => `nam.${d}/`,
    file: (d, c, f) => `nam.${d}/nam.t${c}z.awphys${pad2(f)}.tm00.grib2`,
    fhrRe: () => /nam\.t\d{2}z\.awphys(\d{2})\.tm00\.grib2$/,
  },
  gefs: {
    name: 'GEFS (0.5° ensemble mean)', bucket: 'noaa-gefs-pds', region: 'us-east-1',
    type: 'cycle', cycles: [0, 6, 12, 18], fhrMax: 240, fhrDigits: 3,
    products: { mean: 'geavg' }, defaultProduct: 'mean',
    dir: (d, c) => `gefs.${d}/${c}/atmos/pgrb2ap5/`,
    file: (d, c, f) => `gefs.${d}/${c}/atmos/pgrb2ap5/geavg.t${c}z.pgrb2a.0p50.f${pad3(f)}`,
    fhrRe: () => /geavg\.t\d{2}z\.pgrb2a\.0p50\.f(\d{3})$/,
  },
  ndfd: {
    name: 'NDFD (2.5 km gridded forecast)', bucket: 'noaa-ndfd-pds', region: 'us-east-1',
    type: 'browse', root: 'opnl/AR.conus/',
    note: 'Element-based (no run/cycle/.idx). Use /list to browse and /grib?key= to fetch.',
  },
};

const cycleList = (m) => (m.hourly ? Array.from({ length: 24 }, (_, i) => i) : (m.cycles || []));

// ─── S3 helpers (public buckets, no signing) ─────────────────────────────────
function s3Base(bucket) { return `https://${bucket}.s3.amazonaws.com`; }
function s3KeyUrl(bucket, key) {
  return `${s3Base(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function s3List(bucket, prefix, delimiter) {
  const params = new URLSearchParams({ 'list-type': '2', prefix: prefix || '', 'max-keys': '1000' });
  if (delimiter) params.set('delimiter', delimiter);
  const res = await fetch(`${s3Base(bucket)}/?${params.toString()}`);
  if (!res.ok) throw new Error(`S3 list ${res.status}`);
  const xml = await res.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  const prefixes = [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)]
    .map((m) => m[1]).filter((p) => p && p !== prefix);
  return { keys, prefixes };
}

async function headOk(url) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

// Parse a GRIB2 `.idx` into messages with computed byte end offsets.
async function fetchIdx(bucket, key) {
  const res = await fetch(`${s3KeyUrl(bucket, key)}.idx`);
  if (!res.ok) return null;
  const text = await res.text();
  const rows = text.trim().split('\n').filter(Boolean).map((line) => {
    const p = line.split(':');
    return { n: Number(p[0]), start: Number(p[1]), runTag: p[2], variable: p[3], level: p[4], forecast: p[5] };
  });
  for (let i = 0; i < rows.length; i++) {
    rows[i].end = i + 1 < rows.length ? rows[i + 1].start - 1 : null; // null => to EOF
  }
  return rows;
}

// Newest run (date, cycle) whose f0 .idx exists. Probes recent cycles.
async function latestRun(m, product) {
  const now = new Date();
  const curHour = now.getUTCHours();
  for (let dayBack = 0; dayBack < 2; dayBack++) {
    const d = new Date(now); d.setUTCDate(d.getUTCDate() - dayBack);
    const dstr = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
    const cycles = cycleList(m)
      .filter((c) => dayBack > 0 || c <= curHour)
      .sort((a, b) => b - a);
    for (const c of cycles) {
      const key = m.file(dstr, pad2(c), 0, product);
      if (await headOk(`${s3KeyUrl(m.bucket, key)}.idx`)) {
        return { date: dstr, cycle: pad2(c), product, key };
      }
    }
  }
  return null;
}

// List available forecast hours for a run by scanning the run dir.
async function availableHours(m, date, cycle, product) {
  const { keys } = await s3List(m.bucket, m.dir(date, cycle), null);
  const re = m.fhrRe(product);
  const hours = new Set();
  for (const k of keys) {
    if (k.endsWith('.idx')) continue;
    const name = k.split('/').pop();
    const mm = re.exec(name);
    if (mm) hours.add(Number(mm[1]));
  }
  return [...hours].sort((a, b) => a - b);
}

// ─── Route handlers ──────────────────────────────────────────────────────────
function catalog() {
  return Object.entries(MODELS).map(([id, m]) => ({
    id, name: m.name, bucket: m.bucket, region: m.region, type: m.type,
    products: m.products ? Object.keys(m.products) : undefined,
    defaultProduct: m.defaultProduct, fhrMax: m.fhrMax, note: m.note,
  }));
}

const VALID_DATE = /^\d{8}$/;
const VALID_CYCLE = /^\d{2}$/;

function attachModels(app, requireAuth) {
  const guard = requireAuth || ((req, res, next) => next());

  app.get('/api/models', guard, (req, res) => res.json({ models: catalog() }));

  app.get('/api/models/:id/latest', guard, async (req, res) => {
    const m = MODELS[req.params.id];
    if (!m) return res.status(404).json({ error: 'Unknown model' });
    if (m.type !== 'cycle') return res.status(400).json({ error: `${req.params.id} is browse-only; use /list` });
    try {
      const product = req.query.product || m.defaultProduct;
      const run = await latestRun(m, product);
      if (!run) return res.status(502).json({ error: 'No recent run found' });
      res.json({ id: req.params.id, ...run, url: s3KeyUrl(m.bucket, run.key) });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.get('/api/models/:id/hours', guard, async (req, res) => {
    const m = MODELS[req.params.id];
    if (!m || m.type !== 'cycle') return res.status(404).json({ error: 'Unknown cycle model' });
    const { date, cycle } = req.query;
    if (!VALID_DATE.test(date || '') || !VALID_CYCLE.test(cycle || '')) return res.status(400).json({ error: 'date=YYYYMMDD & cycle=HH required' });
    try {
      res.json({ hours: await availableHours(m, date, cycle, req.query.product || m.defaultProduct) });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.get('/api/models/:id/index', guard, async (req, res) => {
    const m = MODELS[req.params.id];
    if (!m || m.type !== 'cycle') return res.status(404).json({ error: 'Unknown cycle model' });
    const { date, cycle } = req.query;
    const fhr = Number(req.query.fhr || 0);
    if (!VALID_DATE.test(date || '') || !VALID_CYCLE.test(cycle || '') || !Number.isFinite(fhr)) {
      return res.status(400).json({ error: 'date=YYYYMMDD & cycle=HH & fhr required' });
    }
    try {
      const key = m.file(date, cycle, fhr, req.query.product || m.defaultProduct);
      const messages = await fetchIdx(m.bucket, key);
      if (!messages) return res.status(404).json({ error: 'No .idx for that file (not posted yet?)' });
      res.json({ key, count: messages.length, messages });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.get('/api/models/:id/grib', guard, async (req, res) => {
    const m = MODELS[req.params.id];
    if (!m) return res.status(404).json({ error: 'Unknown model' });
    try {
      let bucket = m.bucket, key, start = null, end = null;

      if (m.type === 'browse') {
        // Fetch a whole (or ranged) element file by explicit, validated key.
        key = String(req.query.key || '');
        if (!key.startsWith(m.root)) return res.status(400).json({ error: `key must start with ${m.root}` });
        if (key.includes('..')) return res.status(400).json({ error: 'bad key' });
      } else {
        const { date, cycle } = req.query;
        const fhr = Number(req.query.fhr || 0);
        if (!VALID_DATE.test(date || '') || !VALID_CYCLE.test(cycle || '')) return res.status(400).json({ error: 'date & cycle required' });
        key = m.file(date, cycle, fhr, req.query.product || m.defaultProduct);
        const messages = await fetchIdx(m.bucket, key);
        if (!messages) return res.status(404).json({ error: 'No .idx for that file' });
        let msg = null;
        if (req.query.msg != null) {
          msg = messages.find((x) => x.n === Number(req.query.msg));
        } else if (req.query.var) {
          const v = String(req.query.var).toUpperCase();
          const lvl = req.query.level ? String(req.query.level).toLowerCase() : null;
          msg = messages.find((x) => x.variable.toUpperCase() === v && (!lvl || x.level.toLowerCase() === lvl));
        }
        if (!msg) return res.status(404).json({ error: 'Message not found; check /index' });
        start = msg.start; end = msg.end;
      }

      const headers = {};
      if (start != null) headers.Range = `bytes=${start}-${end == null ? '' : end}`;
      const upstream = await fetch(s3KeyUrl(bucket, key), { headers });
      if (!(upstream.ok || upstream.status === 206)) return res.status(502).json({ error: `S3 ${upstream.status}` });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.status(200);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Grib-Key', key);
      res.send(buf);
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  // Decode + colorize a single field to an EPSG:4326 PNG for map overlay.
  app.get('/api/models/:id/field', guard, async (req, res) => {
    const m = MODELS[req.params.id];
    if (!m || m.type !== 'cycle') return res.status(404).json({ error: 'Unknown cycle model' });
    const { date, cycle } = req.query;
    const fhr = Number(req.query.fhr || 0);
    if (!VALID_DATE.test(date || '') || !VALID_CYCLE.test(cycle || '') || !Number.isFinite(fhr)) {
      return res.status(400).json({ error: 'date=YYYYMMDD & cycle=HH & fhr required' });
    }
    // bbox=W,S,E,N (defaults to CONUS)
    let bbox = [-125, 24, -66.5, 50];
    if (req.query.bbox) {
      const p = String(req.query.bbox).split(',').map(Number);
      if (p.length === 4 && p.every(Number.isFinite) && p[2] > p[0] && p[3] > p[1]) {
        bbox = [Math.max(-179, p[0]), Math.max(-85, p[1]), Math.min(179, p[2]), Math.min(85, p[3])];
      }
    }
    try {
      const key = m.file(date, cycle, fhr, req.query.product || m.defaultProduct);
      const messages = await fetchIdx(m.bucket, key);
      if (!messages) return res.status(404).json({ error: 'No .idx for that file' });
      let msg = null;
      if (req.query.msg != null) msg = messages.find((x) => x.n === Number(req.query.msg));
      else if (req.query.var) {
        const v = String(req.query.var).toUpperCase();
        const lvl = req.query.level ? String(req.query.level).toLowerCase() : null;
        msg = messages.find((x) => x.variable.toUpperCase() === v && (!lvl || x.level.toLowerCase() === lvl));
      }
      if (!msg) return res.status(404).json({ error: 'Field not found; check /index' });

      // Optional small render for thumbnails (w=180 etc.); default full res.
      const maxW = Math.max(60, Math.min(1600, Number(req.query.w) || 1400));
      const cacheKey = `${req.params.id}:${date}:${cycle}:${fhr}:${msg.n}:${bbox.join(',')}:${maxW}`;
      let entry = pngGet(cacheKey);
      if (!entry) {
        const range = `bytes=${msg.start}-${msg.end == null ? '' : msg.end}`;
        const upstream = await fetch(s3KeyUrl(m.bucket, key), { headers: { Range: range } });
        if (!(upstream.ok || upstream.status === 206)) return res.status(502).json({ error: `S3 ${upstream.status}` });
        const bytes = new Uint8Array(await upstream.arrayBuffer());
        const { png } = renderField(bytes, msg.variable, bbox, maxW);
        entry = { png, variable: msg.variable, level: msg.level, legend: legendFor(msg.variable) };
        pngSet(cacheKey, entry);
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Bbox', bbox.join(','));
      res.setHeader('X-Var', entry.variable);
      res.setHeader('X-Level', entry.level);
      res.setHeader('Access-Control-Expose-Headers', 'X-Legend, X-Var, X-Level, X-Bbox');
      res.setHeader('X-Legend', JSON.stringify(entry.legend));
      res.send(Buffer.from(entry.png));
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });

  // Point forecast sounding assembled from raw GRIB (soundings_grib.js).
  app.get('/api/models/:id/sounding', guard, async (req, res) => {
    const m = MODELS[req.params.id];
    if (!m || m.type !== 'cycle') return res.status(404).json({ error: 'Unknown cycle model' });
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat & lon required' });
    const fhr = Number(req.query.fhr || 0);
    if (!Number.isFinite(fhr)) return res.status(400).json({ error: 'bad fhr' });
    try {
      const product = req.query.product || m.soundingProduct || m.defaultProduct;
      let date = req.query.date, cycle = req.query.cycle;
      if (!VALID_DATE.test(date || '') || !VALID_CYCLE.test(cycle || '')) {
        const run = await latestRun(m, product);
        if (!run) return res.status(502).json({ error: 'No recent run found' });
        date = run.date; cycle = run.cycle;
      }
      const key = m.file(date, cycle, fhr, product);
      const messages = await fetchIdx(m.bucket, key);
      if (!messages) return res.status(404).json({ error: 'No .idx for that run/hour yet' });
      const fileUrl = s3KeyUrl(m.bucket, key);
      const header = `${m.name.split(' (')[0]} ${cycle}Z +${fhr}h · ${date}`;
      const snd = await buildSounding({ fileUrl, messages, lat, lon, header });
      res.json({ id: req.params.id, date, cycle, fhr, product, ...snd });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  // Exact SHARPpy/SounderPy sounding IMAGE (PNG), rendered by the Python helper.
  // Fails soft (501) when SounderPy isn't installed/errors so the client falls
  // back to the built-in JS sounding — this endpoint only ADDS capability.
  app.get('/api/models/:id/sounding/image', guard, async (req, res) => {
    const m = MODELS[req.params.id];
    if (!m || m.type !== 'cycle') return res.status(404).json({ error: 'Unknown cycle model' });
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat & lon required' });
    const fhr = Number(req.query.fhr || 0);
    if (!Number.isFinite(fhr)) return res.status(400).json({ error: 'bad fhr' });
    try {
      const product = req.query.product || m.soundingProduct || m.defaultProduct;
      let date = req.query.date, cycle = req.query.cycle;
      if (!VALID_DATE.test(date || '') || !VALID_CYCLE.test(cycle || '')) {
        const run = await latestRun(m, product);
        if (!run) return res.status(502).json({ error: 'No recent run found' });
        date = run.date; cycle = run.cycle;
      }
      const cacheKey = `spy:${req.params.id}:${date}:${cycle}:${fhr}:${product}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
      const cached = pngGet(cacheKey);
      if (cached) { res.setHeader('Cache-Control', 'no-store'); res.type('png'); return res.send(cached.png); }
      const key = m.file(date, cycle, fhr, product);
      const messages = await fetchIdx(m.bucket, key);
      if (!messages) return res.status(404).json({ error: 'No .idx for that run/hour yet' });
      const fileUrl = s3KeyUrl(m.bucket, key);
      const header = `${m.name.split(' (')[0]} ${cycle}Z +${fhr}h · ${date}`;
      const snd = await buildSounding({ fileUrl, messages, lat, lon, header });
      const meta = { lat, lon, model: m.name.split(' (')[0], modelId: req.params.id, fhr, date, cycle, cape: snd.cape, cin: snd.cin, title: header };
      const png = await renderSounderpyImage(snd, meta);
      pngSet(cacheKey, { png });
      res.setHeader('Cache-Control', 'no-store'); res.type('png'); res.send(png);
    } catch (e) {
      // 501 → the client quietly falls back to the built-in sounding.
      res.status(501).json({ error: 'sounderpy unavailable: ' + String(e.message || e) });
    }
  });

  app.get('/api/models/:id/list', guard, async (req, res) => {
    const m = MODELS[req.params.id];
    if (!m) return res.status(404).json({ error: 'Unknown model' });
    let prefix = String(req.query.prefix || (m.type === 'browse' ? m.root : ''));
    if (prefix.includes('..')) return res.status(400).json({ error: 'bad prefix' });
    try {
      const { keys, prefixes } = await s3List(m.bucket, prefix, req.query.flat ? null : '/');
      res.json({ bucket: m.bucket, prefix, prefixes, keys: keys.slice(0, 1000) });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });
}

// latestRun/fetchIdx/s3KeyUrl are exported so other server features can build
// point soundings from the same model data the Models browser serves
// (backend/tornado/environment.js). Additive only — no behaviour change here.
module.exports = { attachModels, MODELS, latestRun, fetchIdx, s3KeyUrl, availableHours };
