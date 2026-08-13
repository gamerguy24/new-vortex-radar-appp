/*
 * nws_bluesky.js
 * Automatic NWS warning → Bluesky posting.
 *
 * A single server-side poller (60s) reads api.weather.gov/alerts/active, decides
 * which new warnings should post (configurable by event type + geographic scope),
 * renders a broadcast graphic (nws_graphic.js), and posts it to Bluesky via the
 * free AT-Protocol API. A JSON store dedupes by NWS alert id and survives
 * restarts; on the first poll after (re)start it *baselines* currently-active
 * warnings (records them without posting) so a deploy never floods the feed.
 *
 * Everything is decoupled and guarded:
 *   - No Bluesky credentials?  Detection + graphics still run; records are marked
 *     `skipped:no-credentials` and shown in admin. Enabling later = set env vars.
 *   - Disabled in admin?       The poller no-ops (no fetch, no post).
 *   - Any network/render error never crashes the process; it logs `[NWS-BSKY]`
 *     and moves on, with exponential-backoff retries on transient post failures.
 *
 * Secrets (BLUESKY_HANDLE / BLUESKY_APP_PASSWORD) live only in env and are never
 * logged or sent to the browser.
 *
 * Mounted from server.js:
 *   require('./nws_bluesky').attachNwsBluesky({ app, requireAdmin, DATA_DIR, readJson, writeJson });
 */

const fs = require('fs');
const path = require('path');
const { AtpAgent, RichText } = require('@atproto/api');

const {
  renderWarningGraphic, untilLabel, areaLabel, officeName, affectedStates, countyList,
} = require('./nws_graphic');
const ALERT_TYPES = require('./app/alerts/alert_types');

const ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';
const USER_AGENT = process.env.NWS_USER_AGENT ||
  'VortexRadar (vortex-dome22.onrender.com, davidwallis17@gmail.com)';
const POLL_MS = Math.max(30, parseInt(process.env.NWS_POLL_SECONDS, 10) || 60) * 1000;
const MAX_POSTS_PER_CYCLE = parseInt(process.env.NWS_MAX_POSTS_PER_CYCLE, 10) || 8;
const BSKY_LIMIT = 300; // Bluesky post grapheme limit

const log = (...a) => console.log('[NWS-BSKY]', ...a);

// Event types posted ON by default (convective + immediate-threat). Everything
// else present in alert_types.js is available but OFF until the admin enables it.
const DEFAULT_ON = new Set([
  'Tornado Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning', 'Flood Warning',
  'Special Marine Warning', 'Extreme Wind Warning', 'Dust Storm Warning',
]);

// All 50 US states (USPS). Blank scope also covers DC/PR/territories.
const ALL_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

function defaultConfig() {
  const alertTypes = {};
  for (const t of ALERT_TYPES) {
    if (t.category === 'warning') alertTypes[t.name] = DEFAULT_ON.has(t.name);
  }
  return {
    enabled: false,           // master switch — nothing posts until explicitly turned on
    platform: 'bluesky',
    alertTypes,
    postUpdates: true,
    postCancellations: false,
    radarProduct: 'reflectivity', // 'reflectivity' (base reflectivity) | 'velocity' (base velocity)
    scope: { states: [...ALL_STATES], counties: [], offices: [] },
  };
}

function attachNwsBluesky({ app, requireAdmin, DATA_DIR, readJson, writeJson }) {
  const CONFIG_FILE = path.join(DATA_DIR, 'nwsx_config.json');
  const POSTS_FILE = path.join(DATA_DIR, 'nwsx_posts.json');
  const GRAPHICS_DIR = path.join(DATA_DIR, 'warning_graphics');
  try { fs.mkdirSync(GRAPHICS_DIR, { recursive: true }); } catch { /* ignore */ }

  // ── state ───────────────────────────────────────────────────────────────────
  let config = { ...defaultConfig(), ...(readJson(CONFIG_FILE, null) || {}) };
  // Merge alertTypes so newly-added event names get a default without wiping saved toggles.
  config.alertTypes = { ...defaultConfig().alertTypes, ...(config.alertTypes || {}) };
  config.scope = { states: [], counties: [], offices: [], ...(config.scope || {}) };
  let store = readJson(POSTS_FILE, {}) || {};
  let baselined = false;   // has this process baselined active alerts yet?
  let polling = false;     // guard against overlapping cycles

  const saveConfig = () => writeJson(CONFIG_FILE, config);
  const saveStore = () => writeJson(POSTS_FILE, store);
  if (!fs.existsSync(CONFIG_FILE)) saveConfig(); // materialize defaults on first boot

  const blueskyConfigured = () =>
    !!(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD);

  // ── Bluesky client (lazy login, session reuse) ───────────────────────────────
  let agent = null; let agentAt = 0;
  async function bskyAgent() {
    if (!blueskyConfigured()) return null;
    if (agent && Date.now() - agentAt < 50 * 60 * 1000) return agent;
    // Normalize: strip whitespace and a stray leading "@" from the handle.
    const identifier = String(process.env.BLUESKY_HANDLE || '').trim().replace(/^@/, '');
    const password = String(process.env.BLUESKY_APP_PASSWORD || '').trim();
    const a = new AtpAgent({ service: process.env.BLUESKY_SERVICE || 'https://bsky.social' });
    try {
      await a.login({ identifier, password });
    } catch (e) {
      // Surface a precise, non-secret hint for the most common misconfigs.
      const msg = (e && e.message) || String(e);
      if (/invalid identifier or password/i.test(msg)) {
        throw new Error('Bluesky rejected the credentials. Check that BLUESKY_HANDLE is your full handle ' +
          '(e.g. name.bsky.social, no @) and BLUESKY_APP_PASSWORD is an App Password ' +
          '(Settings → App Passwords, format xxxx-xxxx-xxxx-xxxx) — not your account login password.');
      }
      throw e;
    }
    agent = a; agentAt = Date.now();
    log('Bluesky session established for', identifier);
    return agent;
  }

  async function postToBluesky(text, png, altText) {
    const a = await bskyAgent();
    if (!a) return { skipped: 'no-credentials' };
    const up = await a.uploadBlob(png, { encoding: 'image/png' });
    const rt = new RichText({ text });
    await rt.detectFacets(a);
    const res = await a.post({
      $type: 'app.bsky.feed.post',
      text: rt.text,
      facets: rt.facets,
      embed: {
        $type: 'app.bsky.embed.images',
        images: [{ alt: (altText || text).slice(0, 900), image: up.data.blob }],
      },
      createdAt: new Date().toISOString(),
    });
    return { uri: res.uri, cid: res.cid };
  }

  // ── text ─────────────────────────────────────────────────────────────────────
  // Built only from NWS fields — never invents details, never claims a confirmed
  // tornado unless properties.parameters.tornadoDetection says "OBSERVED".
  function buildPostText(alert, { prefix = '' } = {}) {
    const p = alert.properties || {};
    const event = p.event || 'Weather Warning';
    const until = untilLabel(alert);
    const office = officeName(p.senderName);
    const tornado = tornadoNote(p);

    // Compose, then trim the *area list* (not the critical fields) to fit 300.
    const build = (maxNames) => {
      let s = prefix ? prefix + ' ' : '';
      s += `⚠️ ${event}`;
      const areas = areaLabel(alert, maxNames);
      if (areas) s += ` for ${areas}`;
      if (until) s += ` until ${until}`;
      s += '.';
      if (tornado) s += ` ${tornado}`;
      if (office) s += ` (NWS ${office})`;
      return s;
    };
    let text = build(5);
    for (let n = 4; graphemeLen(text) > BSKY_LIMIT && n >= 1; n--) text = build(n);
    if (graphemeLen(text) > BSKY_LIMIT) {
      // Still too long: drop office, keep event + until (never truncate those).
      let s = (prefix ? prefix + ' ' : '') + `⚠️ ${event}`;
      if (until) s += ` until ${until}`;
      s += '.';
      text = s;
    }
    return text;
  }
  function tornadoNote(p) {
    const params = p.parameters || {};
    const det = (params.tornadoDetection || []).join(' ').toUpperCase();
    const dmg = (params.tornadoDamageThreat || []).join(' ').toUpperCase();
    if (dmg.includes('CATASTROPHIC')) return 'Confirmed large, destructive tornado.';
    if (det.includes('OBSERVED')) return 'Confirmed tornado.';
    return ''; // radar-indicated / unspecified — don't overstate
  }
  function graphemeLen(s) {
    try { return new RichText({ text: s }).graphemeLength; } catch { return s.length; }
  }

  // ── eligibility / scope ──────────────────────────────────────────────────────
  function typeEnabled(event) { return !!config.alertTypes[event]; }
  function matchesScope(props) {
    const sc = config.scope || {};
    const hasStates = sc.states && sc.states.length;
    const hasCounties = sc.counties && sc.counties.length;
    const hasOffices = sc.offices && sc.offices.length;
    if (!hasStates && !hasCounties && !hasOffices) return true; // empty scope = entire US
    const states = affectedStates(props);
    if (hasStates && states.some((s) => sc.states.includes(s))) return true;
    if (hasOffices) {
      const office = officeName(props.senderName).toLowerCase();
      if (sc.offices.some((o) => office.includes(String(o).toLowerCase()))) return true;
    }
    if (hasCounties) {
      const counties = countyList(props.areaDesc).map((c) => c.toLowerCase());
      if (sc.counties.some((c) => counties.includes(String(c).toLowerCase()))) return true;
    }
    return false;
  }

  // A short signature to detect *material* changes on an Update (new polygon or
  // escalated threat) vs. an administrative re-issue.
  function alertSig(alert) {
    const p = alert.properties || {};
    const params = p.parameters || {};
    const geomLen = alert.geometry ? JSON.stringify(alert.geometry.coordinates).length : 0;
    const threat = [
      (params.tornadoDetection || []).join(','),
      (params.tornadoDamageThreat || []).join(','),
      (params.maxWindGust || []).join(','),
      (params.maxHailSize || []).join(','),
    ].join('|');
    return `${geomLen}:${threat}`;
  }

  function baseRec(alert, status, reason) {
    const p = alert.properties || {};
    return {
      event: p.event, office: officeName(p.senderName),
      issued: p.sent, effective: p.effective, expires: p.expires,
      msgType: p.messageType, sig: alertSig(alert),
      status, reason: reason || null, postUri: null, postCid: null,
      graphicPath: null, error: null, ts: new Date().toISOString(),
    };
  }

  async function withRetry(fn, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        const status = e && (e.status || (e.headers && 429));
        const wait = Math.min(30000, 1500 * Math.pow(2, i)) + Math.floor(Math.random() * 500);
        log(`post attempt ${i + 1}/${tries} failed (${e.message || status}); retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  // Render + (optionally) post one alert; persist the outcome.
  async function handleAlert(id, alert, isUpdate) {
    const rec = baseRec(alert, 'pending');
    let png = null;
    try {
      png = await renderWarningGraphic(alert, { radarProduct: config.radarProduct });
      const file = path.join(GRAPHICS_DIR, `${sanitizeId(id)}.png`);
      fs.writeFileSync(file, png);
      rec.graphicPath = path.basename(file);
    } catch (e) {
      rec.status = 'error'; rec.error = 'graphic: ' + e.message;
      store[id] = rec; saveStore();
      log('graphic render failed for', id, '-', e.message);
      return;
    }

    if (!blueskyConfigured()) {
      rec.status = 'skipped'; rec.reason = 'no-credentials';
      store[id] = rec; saveStore();
      log('generated graphic (no Bluesky creds) for', rec.event, '—', shortArea(alert));
      return;
    }

    const text = buildPostText(alert, { prefix: isUpdate ? 'UPDATE:' : '' });
    const alt = `${rec.event} for ${areaLabel(alert, 8)}. ${untilLabel(alert) ? 'Until ' + untilLabel(alert) + '.' : ''}`;
    try {
      const res = await withRetry(() => postToBluesky(text, png, alt));
      rec.status = 'posted'; rec.postUri = res.uri || null; rec.postCid = res.cid || null;
      store[id] = rec; saveStore();
      log('posted', rec.event, '—', shortArea(alert), '→', res.uri || '(no uri)');
    } catch (e) {
      rec.status = 'error'; rec.error = 'post: ' + (e.message || String(e));
      store[id] = rec; saveStore();
      log('post failed for', id, '-', rec.error);
    }
  }

  function shortArea(alert) { return areaLabel(alert, 3); }
  function sanitizeId(id) { return String(id).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120); }

  // ── the poll cycle ────────────────────────────────────────────────────────────
  async function poll() {
    if (!config.enabled || polling) return;
    polling = true;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      let data;
      try {
        const res = await fetch(ALERTS_URL, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
      } finally { clearTimeout(t); }

      const feats = data.features || [];
      let posted = 0; let changed = false;

      for (const alert of feats) {
        const id = alert.id;
        const props = alert.properties || {};
        if (!id || !props.event) continue;

        // Only ever consider (store) alerts we actually care about — keeps the
        // dedup store small even during nationwide severe outbreaks.
        if (!typeEnabled(props.event) || !matchesScope(props)) continue;

        const rec = store[id];
        const msgType = props.messageType;
        const isUpdate = msgType === 'Update';
        const isCancel = msgType === 'Cancel';

        // Cold-start baseline: record active-but-unseen alerts WITHOUT posting.
        if (!baselined && !rec) { store[id] = baseRec(alert, 'baseline'); changed = true; continue; }

        if (rec) {
          const materialUpdate = isUpdate && config.postUpdates &&
            rec.status === 'posted' && rec.sig !== alertSig(alert);
          if (!materialUpdate) continue; // already handled, nothing material changed
        }

        if (isCancel && !config.postCancellations) {
          store[id] = baseRec(alert, 'skipped', 'cancellation-disabled'); changed = true; continue;
        }

        if (posted >= MAX_POSTS_PER_CYCLE) continue; // defer to next cycle (still unstored → re-evaluated)
        posted++;
        await handleAlert(id, alert, isUpdate && !!rec);
      }

      if (!baselined) { baselined = true; log(`baselined ${feats.length} active alerts (none posted on cold start)`); }
      if (changed) saveStore();
      pruneStore();
    } catch (e) {
      log('poll error:', e.message);
    } finally {
      polling = false;
    }
  }

  // Drop records whose warning expired > 6h ago so the store can't grow forever.
  function pruneStore() {
    const cutoff = Date.now() - 6 * 3600 * 1000;
    let changed = false;
    for (const [id, rec] of Object.entries(store)) {
      const exp = rec.expires ? Date.parse(rec.expires) : NaN;
      if (isFinite(exp) && exp < cutoff) {
        delete store[id]; changed = true;
        try { fs.unlinkSync(path.join(GRAPHICS_DIR, `${sanitizeId(id)}.png`)); } catch { /* ignore */ }
      }
    }
    if (changed) saveStore();
  }

  // ── admin API (all requireAdmin) ──────────────────────────────────────────────
  app.get('/admin/nwsx/config', requireAdmin, (req, res) => {
    res.json({
      config,
      blueskyConfigured: blueskyConfigured(),
      blueskyHandle: process.env.BLUESKY_HANDLE || null,
      pollSeconds: POLL_MS / 1000,
      alertTypeCatalog: ALERT_TYPES.filter((t) => t.category === 'warning').map((t) => t.name),
      storeSize: Object.keys(store).length,
    });
  });

  app.post('/admin/nwsx/config', requireAdmin, express_json_guard, (req, res) => {
    const b = req.body || {};
    if (typeof b.enabled === 'boolean') config.enabled = b.enabled;
    if (typeof b.postUpdates === 'boolean') config.postUpdates = b.postUpdates;
    if (typeof b.postCancellations === 'boolean') config.postCancellations = b.postCancellations;
    if (b.radarProduct === 'reflectivity' || b.radarProduct === 'velocity') config.radarProduct = b.radarProduct;
    if (b.alertTypes && typeof b.alertTypes === 'object') {
      for (const [k, v] of Object.entries(b.alertTypes)) {
        if (k in config.alertTypes) config.alertTypes[k] = !!v;
      }
    }
    if (b.scope && typeof b.scope === 'object') {
      const clean = (arr) => Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 500) : [];
      config.scope = {
        states: (clean(b.scope.states)).map((s) => s.toUpperCase()),
        counties: clean(b.scope.counties),
        offices: clean(b.scope.offices),
      };
    }
    saveConfig();
    log('config updated by admin', req.user && req.user.email, '| enabled:', config.enabled);
    res.json({ ok: true, config });
  });

  app.get('/admin/nwsx/log', requireAdmin, (req, res) => {
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    const rows = Object.entries(store)
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
      .slice(0, limit);
    res.json({ rows, total: Object.keys(store).length });
  });

  app.get('/admin/nwsx/graphic/:id', requireAdmin, (req, res) => {
    const file = path.join(GRAPHICS_DIR, `${sanitizeId(req.params.id)}.png`);
    if (!file.startsWith(GRAPHICS_DIR) || !fs.existsSync(file)) return res.status(404).end();
    res.type('png').send(fs.readFileSync(file));
  });

  // Test mode: render a synthetic sample (NEVER a real alert). Posts a clearly
  // [TEST]-labeled item only when { post: true } is explicitly sent.
  app.post('/admin/nwsx/test', requireAdmin, express_json_guard, async (req, res) => {
    const sample = String((req.body && req.body.sample) || 'tornado');
    const doPost = !!(req.body && req.body.post);
    const radarProduct = (req.body && req.body.radarProduct) || config.radarProduct;
    const alert = sampleAlert(sample);
    try {
      const png = await renderWarningGraphic(alert, { radarProduct });
      let posted = null;
      if (doPost) {
        if (!blueskyConfigured()) return res.status(400).json({ error: 'Bluesky credentials not configured on the server.' });
        const text = buildPostText(alert, { prefix: '[TEST]' });
        posted = await withRetry(() => postToBluesky(text, png, 'Vortex Radar test warning graphic.'));
        log('TEST post sent by admin', req.user && req.user.email, '→', posted.uri);
      }
      res.json({
        ok: true,
        previewText: buildPostText(alert, { prefix: doPost ? '[TEST]' : '' }),
        image: 'data:image/png;base64,' + png.toString('base64'),
        posted,
      });
    } catch (e) {
      log('test failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── start the poller ──────────────────────────────────────────────────────────
  // Interval always ticks; poll() no-ops while disabled so toggling the master
  // switch in admin takes effect without a restart.
  setInterval(() => { poll().catch((e) => log('unhandled poll rejection:', e.message)); }, POLL_MS);
  setTimeout(() => { poll().catch((e) => log('unhandled poll rejection:', e.message)); }, 4000);
  log(`attached — polling every ${POLL_MS / 1000}s;`,
    `enabled: ${config.enabled};`, `bluesky: ${blueskyConfigured() ? 'configured' : 'not configured'}`);

  // Internal handle (used by tests to drive one poll deterministically).
  return { _pollOnce: poll, _store: () => store, _config: () => config };
}

// A tiny inline JSON body guard so we don't depend on the caller's body parser
// order. express.json() is already applied globally in server.js, but this makes
// the module self-contained if req.body is undefined.
function express_json_guard(req, res, next) {
  if (req.body && typeof req.body === 'object') return next();
  req.body = {};
  next();
}

// ── synthetic samples for the admin "Test" button (not real alerts) ────────────
function sampleAlert(kind) {
  const now = Date.now();
  const iso = (msFromNow) => new Date(now + msFromNow).toISOString();
  const base = (event, extra = {}) => ({
    id: 'urn:test:' + kind + ':' + now,
    geometry: {
      type: 'Polygon',
      coordinates: [[[-86.95, 36.05], [-86.55, 36.18], [-86.35, 36.02], [-86.50, 35.82], [-86.85, 35.80], [-86.95, 36.05]]],
    },
    properties: {
      event, messageType: extra.messageType || 'Alert',
      areaDesc: 'Davidson, TN; Rutherford, TN; Wilson, TN; Williamson, TN; Sumner, TN',
      senderName: 'NWS Nashville TN',
      sent: iso(0), effective: iso(0), expires: iso(45 * 60 * 1000),
      parameters: extra.parameters || {},
    },
  });
  switch (kind) {
    case 'severe': return base('Severe Thunderstorm Warning', { parameters: { maxWindGust: ['70 MPH'], maxHailSize: ['1.75'] } });
    case 'flash-flood': return base('Flash Flood Warning');
    case 'update': return base('Tornado Warning', { messageType: 'Update', parameters: { tornadoDetection: ['OBSERVED'], tornadoDamageThreat: ['CONSIDERABLE'] } });
    case 'cancellation': return base('Tornado Warning', { messageType: 'Cancel' });
    case 'tornado':
    default: return base('Tornado Warning', { parameters: { tornadoDetection: ['RADAR INDICATED'] } });
  }
}

module.exports = { attachNwsBluesky };
