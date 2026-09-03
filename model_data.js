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

const { renderField, renderVectorMagnitude, renderDerived, legendFor } = require('./grib2_render');
const { DERIVED } = require('./grib2_derived');
const { buildCatalog, resolveDerived } = require('./model_products');
const { ECMWF_MODEL, parseEcmwfIndex } = require('./model_ecmwf');
const { climoSampler } = require('./model_climatology');
const { renderBarbs, drawBarbsOnto } = require('./grib2_barbs');
const { PNG } = require('pngjs');
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
    /*
     * All 24 of the day's cycles share one directory, and the filename regex
     * below deliberately does not pin the cycle (it also matches files listed
     * from elsewhere). Without this prefix the hour scan returned every hour
     * that existed for ANY cycle that day, so a run that had just started
     * advertised forecast hours it had not produced and every one of them 404'd.
     */
    hoursPrefix: (d, c, p) => `hrrr.${d}/conus/hrrr.t${c}z.${MODELS.hrrr.products[p || 'sfc']}`,
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
    hoursPrefix: (d, c) => `nam.${d}/nam.t${c}z.awphys`,
    file: (d, c, f) => `nam.${d}/nam.t${c}z.awphys${pad2(f)}.tm00.grib2`,
    fhrRe: () => /nam\.t\d{2}z\.awphys(\d{2})\.tm00\.grib2$/,
  },
  nam3km: {
    name: 'NAM 3 km CONUS nest', bucket: 'noaa-nam-pds', region: 'us-east-1',
    type: 'cycle', cycles: [0, 6, 12, 18], fhrMax: 60, fhrDigits: 2,
    products: { hires: 'conusnest.hires' }, defaultProduct: 'hires',
    dir: (d) => `nam.${d}/`,
    // Every NAM product for the day shares one directory, so narrow the hour
    // scan to this cycle's nest files (see availableHours).
    hoursPrefix: (d, c) => `nam.${d}/nam.t${c}z.conusnest.hires`,
    file: (d, c, f) => `nam.${d}/nam.t${c}z.conusnest.hiresf${pad2(f)}.tm00.grib2`,
    fhrRe: () => /nam\.t\d{2}z\.conusnest\.hiresf(\d{2})\.tm00\.grib2$/,
  },
  gefs: {
    name: 'GEFS (0.5° ensemble mean)', bucket: 'noaa-gefs-pds', region: 'us-east-1',
    type: 'cycle', cycles: [0, 6, 12, 18], fhrMax: 240, fhrDigits: 3,
    products: { mean: 'geavg' }, defaultProduct: 'mean',
    dir: (d, c) => `gefs.${d}/${c}/atmos/pgrb2ap5/`,
    file: (d, c, f) => `gefs.${d}/${c}/atmos/pgrb2ap5/geavg.t${c}z.pgrb2a.0p50.f${pad3(f)}`,
    fhrRe: () => /geavg\.t\d{2}z\.pgrb2a\.0p50\.f(\d{3})$/,
  },
  ecmwf: ECMWF_MODEL,
  ndfd: {
    name: 'NDFD (2.5 km gridded forecast)', bucket: 'noaa-ndfd-pds', region: 'us-east-1',
    type: 'browse', root: 'opnl/AR.conus/',
    note: 'Element-based (no run/cycle/.idx). Use /list to browse and /grib?key= to fetch.',
  },
};

const cycleList = (m) => (m.hourly ? Array.from({ length: 24 }, (_, i) => i) : (m.cycles || []));

// ─── S3 helpers (public buckets, no signing) ─────────────────────────────────
/*
 * HTTP header values must be ASCII (Node rejects anything above Latin-1
 * outright). Product labels are full of typographic characters — "0–6 km Bulk
 * Shear" carries an EN DASH, and units read "m²/s²" and "°F" — which made
 * every derived field 502 with "Invalid character in header content".
 *
 * headerText folds a label down to plain ASCII for X-Var. headerJson keeps the
 * real characters but escapes them as \uXXXX, which is still valid JSON, so
 * the client's existing JSON.parse of X-Legend gets the units back intact.
 */
function headerText(s) {
  return String(s == null ? '' : s)
    .replace(/[‐-―]/g, '-')      // hyphens, en/em dashes
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, '');         // anything left that is not printable ASCII
}
function headerJson(obj) {
  return JSON.stringify(obj)
    .replace(/[^\x20-\x7E]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function s3Base(bucket) { return `https://${bucket}.s3.amazonaws.com`; }
function s3KeyUrl(bucket, key) {
  return `${s3Base(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/*
 * List a bucket prefix, following continuation tokens.
 *
 * A single ListObjectsV2 call returns at most 1000 keys. That silently
 * truncated the NAM day directory - which holds every product and cycle for
 * the day and runs to thousands of keys - so the listing never reached
 * "awphys" and availableHours() came back EMPTY, leaving the NAM with no
 * forecast hours to scrub through. Paging is the correctness fix; the narrower
 * prefixes below are what keep it to one page in practice.
 *
 * Capped at 20 pages (20k keys) so a mistakenly broad prefix cannot turn into
 * an unbounded walk of the bucket.
 */
async function s3List(bucket, prefix, delimiter, maxPages = 20) {
  const keys = [];
  const prefixes = [];
  let token = null;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ 'list-type': '2', prefix: prefix || '', 'max-keys': '1000' });
    if (delimiter) params.set('delimiter', delimiter);
    if (token) params.set('continuation-token', token);
    const res = await fetchRetry(`${s3Base(bucket)}/?${params.toString()}`);
    if (!res.ok) throw new Error(`S3 list ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    for (const m of xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)) {
      if (m[1] && m[1] !== prefix) prefixes.push(m[1]);
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    const t = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
    if (!t) break;
    token = t[1];
  }
  return { keys, prefixes };
}

/*
 * Fetch, retrying the responses that mean "ask again" rather than "no".
 *
 * The ECMWF bucket throttles aggressively and answers 503 SlowDown under any
 * burst — and every probe here comes in bursts, because finding the newest run
 * means trying several cycles in a row. Treating that 503 as "the run does not
 * exist" made ECMWF look permanently unavailable even with the data sitting
 * right there. 404 still means absent and returns immediately; only the
 * transient statuses are retried, with a widening delay.
 */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/*
 * Six tries at 600ms doubling (~18s worst case) with jitter. That is a long
 * time to wait on a web request, but ECMWF routinely answers 503 two or three
 * times in a row before serving, and the alternative — reporting the field as
 * missing — is worse than being slow. Rendered PNGs are cached, so a given
 * field pays this at most once per run and hour.
 */
async function fetchRetry(url, opts = {}, tries = 6) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      if (!RETRY_STATUS.has(r.status)) return r;
      last = r;
    } catch (e) {
      last = null;
      if (i === tries - 1) throw e;
    }
    // Jitter keeps a burst of parallel requests from retrying in lockstep and
    // re-triggering the same throttle.
    const wait = 600 * Math.pow(2, i) * (0.75 + Math.random() * 0.5);
    await new Promise((res) => setTimeout(res, wait));
  }
  return last;
}

// A model's sidecar key: NOAA appends ".idx" to the full filename, ECMWF
// swaps ".grib2" for ".index". Models say which by supplying idxKey().
function idxKeyFor(m, key) { return m.idxKey ? m.idxKey(key) : key + '.idx'; }

/*
 * Named precipitation windows, in hours. These are the accumulations a desk
 * asks for by name; anything else is served by Total QPF or the step bucket.
 */
const QPF_WINDOWS = [3, 6, 12, 24, 48, 120];

/*
 * The run-total accumulation message: "0-6 hour acc fcst", "0-1 day acc fcst".
 * Explicitly NOT the step bucket ("5-6 hour acc"), which is why the leading
 * "0-" is required — differencing two step buckets would be meaningless.
 */
function findAccTotal(messages) {
  return messages.find((x) => x.variable.toUpperCase() === 'APCP'
    && /^0-\d+\s+(hour|day)\s+acc/i.test(x.forecast || '')) || null;
}

// Fetch one message's byte range from an arbitrary file (the QPF window needs
// a message from a different forecast hour than the one being rendered).
async function rangeFrom(fileUrl, msg) {
  const range = `bytes=${msg.start}-${msg.end == null ? '' : msg.end}`;
  const up = await fetchRetry(fileUrl, { headers: { Range: range } });
  if (!(up.ok || up.status === 206)) throw new Error(`S3 ${up.status}`);
  return new Uint8Array(await up.arrayBuffer());
}

/*
 * Combination plots: draw a barb field on top of an already-rendered shaded
 * field, in one image.
 *
 * This is what a desk actually reads — CAPE is a number until you can see
 * which way the wind is taking it, and flipping between two overlays loses the
 * relationship. Applied after the base render and cached under its own key, so
 * the plain field and the combined one can both be held without either being
 * recomputed.
 *
 * A barb overlay that cannot resolve is skipped rather than failing the
 * request: the shaded field underneath is still a correct, useful map.
 */
async function withBarbOverlay(entry, overlayId, ctx) {
  if (!overlayId) return entry;
  const def = DERIVED[overlayId];
  if (!def || !def.barbs) return entry;

  const key = `${ctx.cacheKey}|ov=${overlayId}`;
  const hit = pngGet(key);
  if (hit) return hit;

  const inputs = resolveDerived(ctx.messages, def);
  if (!inputs) return entry;

  const parts = [];
  for (const inp of inputs) parts.push(await ctx.grabRange(inp));

  const png = PNG.sync.read(Buffer.from(entry.png));
  drawBarbsOnto(png, parts[0], parts[1], ctx.bbox);
  const combined = {
    ...entry,
    png: PNG.sync.write(png),
    variable: `${entry.variable} + ${def.label}`,
  };
  pngSet(key, combined);
  return combined;
}

// The UTC time a forecast hour is valid at, from its run date/cycle.
function validDate(date, cycle, fhr) {
  const y = +date.slice(0, 4), mo = +date.slice(4, 6) - 1, d = +date.slice(6, 8);
  return new Date(Date.UTC(y, mo, d, +cycle) + Number(fhr) * 3600000);
}

async function headOk(url) {
  try { const r = await fetchRetry(url, { method: 'HEAD' }); return !!(r && r.ok); } catch { return false; }
}

/*
 * Parse a GRIB2 sidecar into messages with computed byte end offsets.
 *
 * `opts` carries the model's dialect: ECMWF names its sidecar `.index` and
 * writes JSON, so it is normalised by model_ecmwf into the same shape this
 * function returns for NOAA's `.idx`. Callers downstream cannot tell them
 * apart, which is the point.
 */
async function fetchIdx(bucket, key, opts = {}) {
  const res = await fetchRetry(s3KeyUrl(bucket, opts.idxKey ? opts.idxKey(key) : key + '.idx'));
  if (!res.ok) return null;
  const text = await res.text();
  if (opts.indexType === 'ecmwf') return parseEcmwfIndex(text, opts.fhr || 0);
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
      if (await headOk(s3KeyUrl(m.bucket, idxKeyFor(m, key)))) {
        return { date: dstr, cycle: pad2(c), product, key };
      }
    }
  }
  return null;
}

/*
 * List available forecast hours for a run by scanning the run dir.
 *
 * Models that share a directory between products (the NAM keeps every product
 * for the day in one folder) supply hoursPrefix() so the listing covers only
 * the cycle and product being asked about. That is both far cheaper and, since
 * it fits in one page, immune to the truncation that used to empty this list.
 */
async function availableHours(m, date, cycle, product) {
  const prefix = m.hoursPrefix ? m.hoursPrefix(date, cycle, product) : m.dir(date, cycle);
  const { keys } = await s3List(m.bucket, prefix, null);
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
      const messages = await fetchIdx(m.bucket, key, { idxKey: m.idxKey, indexType: m.indexType, fhr });
      if (!messages) return res.status(404).json({ error: 'No .idx for that file (not posted yet?)' });
      res.json({ key, count: messages.length, messages });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  /*
   * The product menu for one run, resolved against its actual index.
   *
   * The menu lives on the server because only the server has the `.idx` to
   * check against. The client renders exactly what comes back, so a model that
   * does not carry a field simply has no card for it rather than offering one
   * that fails when clicked.
   */
  app.get('/api/models/:id/products', guard, async (req, res) => {
    const m = MODELS[req.params.id];
    if (!m || m.type !== 'cycle') return res.status(404).json({ error: 'Unknown cycle model' });
    const { date, cycle } = req.query;
    const fhr = Number(req.query.fhr || 0);
    if (!VALID_DATE.test(date || '') || !VALID_CYCLE.test(cycle || '') || !Number.isFinite(fhr)) {
      return res.status(400).json({ error: 'date=YYYYMMDD & cycle=HH & fhr required' });
    }
    try {
      const key = m.file(date, cycle, fhr, req.query.product || m.defaultProduct);
      const messages = await fetchIdx(m.bucket, key, { idxKey: m.idxKey, indexType: m.indexType, fhr });
      if (!messages) return res.status(404).json({ error: 'No .idx for that file' });
      /*
       * The hour list is needed so the named QPF windows only appear when the
       * forecast hour they measure back to is actually published; output
       * intervals widen with lead time, so "fhr - 3" is not always a real file.
       * A listing failure must not take the whole menu down, so it degrades to
       * offering no windows rather than erroring.
       */
      let hours = null;
      try {
        hours = await availableHours(m, date, cycle, req.query.product || m.defaultProduct);
      } catch (e) { hours = null; }
      res.json({
        id: req.params.id, date, cycle, fhr,
        categories: buildCatalog(messages, { fhr, hours }),
      });
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
        const messages = await fetchIdx(m.bucket, key, { idxKey: m.idxKey, indexType: m.indexType, fhr });
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
      const messages = await fetchIdx(m.bucket, key, { idxKey: m.idxKey, indexType: m.indexType, fhr });
      if (!messages) return res.status(404).json({ error: 'No .idx for that file' });

      const fileUrl0 = s3KeyUrl(m.bucket, key);
      const grabRange = async (mm) => {
        const range = `bytes=${mm.start}-${mm.end == null ? '' : mm.end}`;
        const up = await fetchRetry(fileUrl0, { headers: { Range: range } });
        if (!(up.ok || up.status === 206)) throw new Error(`S3 ${up.status}`);
        return new Uint8Array(await up.arrayBuffer());
      };

      /*
       * derive=<id> renders a field COMPUTED from several messages — bulk
       * shear, a lapse rate, EHI, precipitation type. The recipe lives in
       * grib2_derived.js and is resolved against this run's index here, so a
       * model missing any ingredient gets a clean 404 instead of a wrong map.
       */
      /*
       * qpf=<hours> renders precipitation accumulated over a NAMED window
       * (3, 6, 12, 24, 48, 120 h) ending at this forecast hour.
       *
       * No single message holds it. Models publish a run-total accumulation
       * ("0-24 hour acc") and, at best, the bucket for the current step — so a
       * 12-hour total is the run-total here minus the run-total 12 hours ago,
       * which lives in a DIFFERENT FILE. That is the one thing the derived-field
       * machinery cannot express, since it works within one index, so it is
       * handled directly.
       *
       * Subtracting totals rather than summing every intermediate bucket means
       * two range requests instead of up to twelve, and it cannot drift if a
       * model's bucket length changes partway through a run.
       */
      // overlay=<barb field id> composites barbs onto whatever is rendered.
      const overlayId = req.query.overlay ? String(req.query.overlay) : null;
      const qpfWin = req.query.qpf != null ? Number(req.query.qpf) : null;
      if (qpfWin != null) {
        if (!QPF_WINDOWS.includes(qpfWin)) {
          return res.status(400).json({ error: `qpf must be one of ${QPF_WINDOWS.join(', ')}` });
        }
        const startFhr = fhr - qpfWin;
        if (startFhr < 0) {
          return res.status(404).json({ error: `${qpfWin}-hour QPF needs forecast hour ${qpfWin} or later` });
        }
        const here = findAccTotal(messages);
        if (!here) return res.status(404).json({ error: 'This model has no run-total precipitation field' });

        const maxW = Math.max(60, Math.min(1600, Number(req.query.w) || 1400));
        const cacheKey = `${req.params.id}:${date}:${cycle}:${fhr}:qpf=${qpfWin}:${bbox.join(',')}:${maxW}`;
        let entry = pngGet(cacheKey);
        if (!entry) {
          let png;
          if (startFhr === 0) {
            // The window starts at the run's own start, so the run-total IS the
            // answer — no second file, and nothing to subtract.
            png = renderField(await grabRange(here), 'APCP', bbox, maxW, 'precip', here.scale).png;
          } else {
            const startKey = m.file(date, cycle, startFhr, req.query.product || m.defaultProduct);
            const startMsgs = await fetchIdx(m.bucket, startKey, { idxKey: m.idxKey, indexType: m.indexType, fhr: startFhr });
            if (!startMsgs) return res.status(404).json({ error: `Forecast hour ${startFhr} is not posted yet` });
            const before = findAccTotal(startMsgs);
            if (!before) return res.status(404).json({ error: `No run-total precipitation at hour ${startFhr}` });

            const aBytes = await grabRange(here);
            const bBytes = await rangeFrom(s3KeyUrl(m.bucket, startKey), before);
            // Later total minus earlier total. Clamped at zero: accumulations
            // only ever increase, so a negative is decoder noise, not drying.
            png = renderDerived(
              [aBytes, bBytes],
              ([now, then]) => Math.max(0, now - then),
              'precip', bbox, maxW,
              [here.scale == null ? 1 : here.scale, before.scale == null ? 1 : before.scale],
            ).png;
          }
          entry = {
            png, variable: `${qpfWin}-h QPF`, level: 'surface',
            legend: legendFor('APCP', 'precip'),
          };
          pngSet(cacheKey, entry);
        }
        // Optional combination plot: barbs drawn over this field.
        entry = await withBarbOverlay(entry, overlayId, { messages, grabRange, bbox, cacheKey });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Bbox', bbox.join(','));
        res.setHeader('X-Var', headerText(entry.variable));
        res.setHeader('X-Level', headerText(entry.level));
        res.setHeader('Access-Control-Expose-Headers', 'X-Legend, X-Var, X-Level, X-Bbox');
        res.setHeader('X-Legend', headerJson(entry.legend));
        return res.send(Buffer.from(entry.png));
      }

      const deriveId = req.query.derive ? String(req.query.derive) : null;
      if (deriveId) {
        const def = DERIVED[deriveId];
        if (!def) return res.status(404).json({ error: `Unknown derived field: ${deriveId}` });
        const inputs = resolveDerived(messages, def);
        if (!inputs) return res.status(404).json({ error: `${def.label} is not available in this model run` });

        const maxW = Math.max(60, Math.min(1600, Number(req.query.w) || 1400));
        const cacheKey = `${req.params.id}:${date}:${cycle}:${fhr}:d=${deriveId}:${bbox.join(',')}:${maxW}`;
        let entry = pngGet(cacheKey);
        if (!entry) {
          /*
           * Sequential, not Promise.all. A derived field needs up to four byte
           * ranges, and firing them together is exactly the burst that makes
           * ECMWF answer 503 — which then costs far more in retries than the
           * parallelism saved. They are small ranges of one object.
           */
          const parts = [];
          for (const inp of inputs) parts.push(await grabRange(inp));
          // Per-input unit scales, set by adapters whose centre uses different
          // units to NOAA's (see model_ecmwf). 1 for every NOAA field.
          const scales = inputs.map((x) => x.scale == null ? 1 : x.scale);

          if (def.barbs) {
            // Glyphs rather than a ramp: barbs are drawn straight onto a
            // transparent canvas, so there is no per-pixel value to colour.
            const { png } = renderBarbs(parts[0], parts[1], bbox, maxW);
            entry = { png, variable: def.label, level: '', legend: legendFor(null, 'barb') };
          } else {
            /*
             * Anomaly fields need the long-term normal for the run's VALID
             * time, not for today: scrubbing to a +120 h forecast must compare
             * against THAT day's climatology, or a forecast crossing a season
             * boundary is measured against the wrong normal.
             */
            let extras = null;
            if (def.climo) extras = [await climoSampler(def.climo, validDate(date, cycle, fhr))];

            const { png } = renderDerived(parts, def.combine, def.kind, bbox, maxW, scales, extras);
            entry = { png, variable: def.label, level: '', legend: legendFor(null, def.kind) };
          }
          pngSet(cacheKey, entry);
        }
        // Optional combination plot: barbs drawn over this field.
        entry = await withBarbOverlay(entry, overlayId, { messages, grabRange, bbox, cacheKey });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Bbox', bbox.join(','));
        res.setHeader('X-Var', headerText(entry.variable));
        res.setHeader('X-Level', headerText(entry.level));
        res.setHeader('Access-Control-Expose-Headers', 'X-Legend, X-Var, X-Level, X-Bbox');
        res.setHeader('X-Legend', headerJson(entry.legend));
        return res.send(Buffer.from(entry.png));
      }

      let msg = null;
      if (req.query.msg != null) msg = messages.find((x) => x.n === Number(req.query.msg));
      else if (req.query.var) {
        const v = String(req.query.var).toUpperCase();
        const lvl = req.query.level ? String(req.query.level).toLowerCase() : null;
        msg = messages.find((x) => x.variable.toUpperCase() === v && (!lvl || x.level.toLowerCase() === lvl));
      }
      if (!msg) return res.status(404).json({ error: 'Field not found; check /index' });

      // A product may state the ramp its field should use, for variables whose
      // name alone is ambiguous (HGT is a cloud base at one level and a
      // geopotential height at another).
      const kindOverride = req.query.kind ? String(req.query.kind) : null;

      /*
       * Optional SECOND message -> render sqrt(a^2 + b^2) instead of the field
       * itself. Bulk wind shear is only stored as separate u and v components
       * (VUCSH / VVCSH), so the quantity a forecaster actually wants has no
       * single GRIB message and must be derived from the pair.
       */
      let msg2 = null;
      if (req.query.msg2 != null) {
        msg2 = messages.find((x) => x.n === Number(req.query.msg2)) || null;
        if (!msg2) return res.status(404).json({ error: 'Second field not found; check /index' });
      } else if (req.query.var2) {
        const v2 = String(req.query.var2).toUpperCase();
        const lvl2 = req.query.level2 ? String(req.query.level2).toLowerCase() : (msg.level || '').toLowerCase();
        msg2 = messages.find((x) => x.variable.toUpperCase() === v2 && (!lvl2 || x.level.toLowerCase() === lvl2)) || null;
        if (!msg2) return res.status(404).json({ error: 'Second field not found; check /index' });
      }

      // Optional small render for thumbnails (w=180 etc.); default full res.
      const maxW = Math.max(60, Math.min(1600, Number(req.query.w) || 1400));
      const cacheKey = `${req.params.id}:${date}:${cycle}:${fhr}:${msg.n}${msg2 ? '+' + msg2.n : ''}`
        + `${kindOverride ? ':k=' + kindOverride : ''}:${bbox.join(',')}:${maxW}`;
      let entry = pngGet(cacheKey);
      if (!entry) {
        if (msg2) {
          // One request each; they are separate byte ranges of the same object.
          const [a, b] = await Promise.all([grabRange(msg), grabRange(msg2)]);
          const { png } = renderVectorMagnitude(a, b, msg.variable, bbox, maxW);
          entry = { png, variable: msg.variable, level: msg.level, legend: legendFor(msg.variable) };
        } else {
          const { png } = renderField(await grabRange(msg), msg.variable, bbox, maxW, kindOverride, msg.scale);
          entry = { png, variable: msg.variable, level: msg.level, legend: legendFor(msg.variable, kindOverride) };
        }
        pngSet(cacheKey, entry);
      }
      // Optional combination plot: barbs drawn over this field.
      entry = await withBarbOverlay(entry, overlayId, { messages, grabRange, bbox, cacheKey });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Bbox', bbox.join(','));
      res.setHeader('X-Var', headerText(entry.variable));
      res.setHeader('X-Level', headerText(entry.level));
      res.setHeader('Access-Control-Expose-Headers', 'X-Legend, X-Var, X-Level, X-Bbox');
      res.setHeader('X-Legend', headerJson(entry.legend));
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
      const messages = await fetchIdx(m.bucket, key, { idxKey: m.idxKey, indexType: m.indexType, fhr });
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
      const messages = await fetchIdx(m.bucket, key, { idxKey: m.idxKey, indexType: m.indexType, fhr });
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
