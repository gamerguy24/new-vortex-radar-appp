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
 * FACEBOOK: the same graphic also goes to a Facebook Page when FACEBOOK_PAGE_ID
 * and FACEBOOK_PAGE_TOKEN are set — a Page access token taken from
 * /me/accounts with a long-lived user token, which does not expire. Posted as
 * a photo with a fuller caption (Facebook has no 300-character limit). Each
 * destination can be switched off in admin; one failing never stops the other.
 *
 * Mounted from server.js:
 *   require('./nws_bluesky').attachNwsBluesky({ app, requireAdmin, DATA_DIR, readJson, writeJson });
 */

const fs = require('fs');
const path = require('path');
const { AtpAgent, RichText } = require('@atproto/api');
const turf = require('@turf/turf');

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
const FB_GRAPH = 'https://graph.facebook.com/' + (process.env.FACEBOOK_GRAPH_VERSION || 'v26.0');
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');

const log = (...a) => console.log('[NWS-BSKY]', ...a);

// Event types posted ON by default (convective + immediate-threat). Everything
// else present in alert_types.js is available but OFF until the admin enables it.
const DEFAULT_ON = new Set([
  'Tornado Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning', 'Flood Warning',
  'Special Marine Warning', 'Extreme Wind Warning', 'Dust Storm Warning',
]);

// All 50 US states (USPS). Blank scope also covers DC/PR/territories.
const ALL_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

// Watches wait this long after first sighting before posting, so the pieces a
// watch arrives in (one per WFO for SPC watches) are merged into one post.
const WATCH_SETTLE_S = parseInt(process.env.NWS_WATCH_SETTLE_SECONDS, 10);
const WATCH_SETTLE_MS = (Number.isFinite(WATCH_SETTLE_S) ? Math.max(0, WATCH_SETTLE_S) : 180) * 1000;
const isWarning = (event) => / Warning$/.test(event || '');
const isWatch = (event) => / Watch$/.test(event || '');
const CATALOG = ALERT_TYPES.filter((t) => t.category === 'warning' || t.category === 'watch').map((t) => t.name);

function defaultConfig() {
  const alertTypes = {};
  for (const name of CATALOG) alertTypes[name] = DEFAULT_ON.has(name);
  return {
    enabled: false,           // master switch — nothing posts until explicitly turned on
    platform: 'bluesky',
    // Every NWS "… Warning" / "… Watch", including ones not in the catalog
    // (Gale Warning, High Wind Watch…). When on, the per-type boxes are ignored.
    allWarnings: true,
    allWatches: true,
    alertTypes,
    postUpdates: true,
    postCancellations: false,
    radarProduct: 'reflectivity', // 'reflectivity' (base reflectivity) | 'velocity' (base velocity)
    scope: { states: [...ALL_STATES], counties: [], offices: [] },
    // Where posts go. A destination also needs its env credentials to post.
    destinations: { bluesky: true, facebook: true },
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
  config.destinations = { bluesky: true, facebook: true, ...(config.destinations || {}) };
  let store = readJson(POSTS_FILE, {}) || {};
  let baselined = false;   // has this process baselined active alerts yet?
  let polling = false;     // guard against overlapping cycles
  const watchSeen = new Map(); // watch eventKey → first sighting (ms), for WATCH_SETTLE_MS

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

  // ── Facebook Page (Graph API photo post) ─────────────────────────────────────
  const facebookConfigured = () =>
    !!(process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_PAGE_TOKEN);
  const fbToken = () => String(process.env.FACEBOOK_PAGE_TOKEN || '').trim();
  const fbPage = () => String(process.env.FACEBOOK_PAGE_ID || '').trim();

  // A Graph error, with a fix for the ones that are not worth retrying.
  function fbError(j, status) {
    const err = (j && j.error) || {};
    let msg = err.message || ('HTTP ' + status);
    const e = new Error(msg);
    if (err.code === 190) {
      e.message = 'Facebook rejected the Page token (expired or revoked). Get a new Page token from '
        + 'Graph API Explorer › me/accounts and update FACEBOOK_PAGE_TOKEN.';
      e.noRetry = true;
    } else if (err.code === 200 || err.code === 10 || err.code === 100) {
      e.message = 'Facebook refused the post: ' + msg + ' — the token needs pages_manage_posts for this Page.';
      e.noRetry = true;
    }
    return e;
  }

  async function postToFacebook(text, png) {
    if (!facebookConfigured()) return { skipped: 'no-credentials' };
    const fd = new FormData();
    fd.append('source', new Blob([png], { type: 'image/png' }), 'warning.png');
    fd.append('message', text);
    fd.append('published', 'true');
    fd.append('access_token', fbToken());
    const r = await fetch(`${FB_GRAPH}/${encodeURIComponent(fbPage())}/photos`, { method: 'POST', body: fd });
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    if (!r.ok || !j || j.error) throw fbError(j, r.status);
    return { id: j.post_id || j.id };
  }

  /*
   * Facebook's caption: the Bluesky line, plus the hazard details, the
   * office's own first instruction paragraph and a link — all NWS fields,
   * nothing invented.
   */
  function buildFacebookText(alert, { prefix = '' } = {}) {
    const p = alert.properties || {};
    const params = p.parameters || {};
    const until = untilLabel(alert);
    const office = officeName(p.senderName);
    const lines = [];
    let head = (prefix ? prefix + ' ' : '') + `⚠️ ${p.event || 'Weather Warning'}`;
    const areas = areaLabel(alert, 12);
    if (areas) head += ` for ${areas}`;
    if (until) head += ` until ${until}`;
    lines.push(head + '.');
    const tornado = tornadoNote(p);
    if (tornado) lines.push(tornado);
    const hazards = [];
    if (params.maxWindGust && params.maxWindGust[0]) hazards.push('Wind: ' + params.maxWindGust[0]);
    if (params.maxHailSize && params.maxHailSize[0]) hazards.push('Hail: ' + params.maxHailSize[0] + ' in');
    if (hazards.length) lines.push(hazards.join(' · '));
    const instruction = String(p.instruction || '').split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
    if (instruction) lines.push(instruction.length > 500 ? instruction.slice(0, 500).replace(/\s+\S*$/, '') + '…' : instruction);
    if (office) lines.push(`Issued by NWS ${office}.`);
    if (APP_URL) lines.push(`Live radar: ${APP_URL}`);
    return lines.join('\n\n');
  }

  // Destinations switched on in admin AND with credentials on the server.
  function activeDestinations() {
    const d = config.destinations || {};
    const out = [];
    if (d.bluesky !== false && blueskyConfigured()) out.push('bluesky');
    if (d.facebook !== false && facebookConfigured()) out.push('facebook');
    return out;
  }

  /** Post to every active destination; one failing never stops the other. */
  async function postEverywhere(alert, png, { prefix = '', alt, only } = {}) {
    const results = {}; const errors = [];
    for (const dest of only || activeDestinations()) {
      try {
        if (dest === 'bluesky') {
          results.bluesky = await withRetry(() => postToBluesky(buildPostText(alert, { prefix }), png, alt));
        } else {
          results.facebook = await withRetry(() => postToFacebook(buildFacebookText(alert, { prefix }), png));
        }
      } catch (e) {
        errors.push(`${dest}: ${e.message || String(e)}`);
      }
    }
    return { results, errors };
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
  function typeEnabled(event) {
    if (config.allWarnings && isWarning(event)) return true;
    if (config.allWatches && isWatch(event)) return true;
    return !!config.alertTypes[event];
  }

  // One VTEC event (office.phen.sig.ETN) can arrive as several alerts: one per
  // segment, and one per WFO for SPC watches (all KWNS). They share this key.
  function eventKey(id, props) {
    const vtec = ((props.parameters && props.parameters.VTEC) || [])[0] || '';
    const m = /^\/[OTEX]\.[A-Z]{3}\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\./.exec(vtec);
    return m ? `${m[1]}.${m[2]}.${m[3]}.${m[4]}` : id;
  }

  // Post order when the per-cycle cap bites: immediate threats first.
  function priority(event) {
    if (/^(Tornado|Extreme Wind) Warning$/.test(event)) return 0;
    if (/^(Severe Thunderstorm|Flash Flood|Snow Squall|Dust Storm) Warning$/.test(event)) return 1;
    if (isWarning(event)) return 2;
    if (/^(Tornado|Severe Thunderstorm) Watch$/.test(event)) return 3;
    return 4;
  }

  // Several alerts of one event → one alert covering all their areas.
  function mergeAlerts(alerts) {
    if (alerts.length === 1) return alerts[0];
    const [first] = alerts;
    const props = { ...first.properties };
    const uniq = (xs) => [...new Set(xs)];
    const all = (f) => alerts.flatMap((a) => f(a.properties || {}) || []);
    props.areaDesc = uniq(all((p) => String(p.areaDesc || '').split(/;\s*/)).filter(Boolean)).join('; ');
    props.affectedZones = uniq(all((p) => p.affectedZones));
    props.geocode = { ...(props.geocode || {}), UGC: uniq(all((p) => p.geocode && p.geocode.UGC)), SAME: uniq(all((p) => p.geocode && p.geocode.SAME)) };
    const expires = alerts.map((a) => a.properties.expires).filter(Boolean).sort();
    if (expires.length) props.expires = expires[expires.length - 1];
    const polys = [];
    for (const a of alerts) eachPolygon(a.geometry, (p) => polys.push(p));
    return { ...first, properties: props, geometry: polys.length ? { type: 'MultiPolygon', coordinates: polys } : null };
  }

  function eachPolygon(geom, fn) {
    if (!geom) return;
    if (geom.type === 'Polygon') fn(geom.coordinates);
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(fn);
  }

  /*
   * Watches and zone-based warnings carry no polygon — only affectedZones
   * URLs. Fetch those zone shapes (cached; zones never change) so the
   * graphic outlines the real area instead of a whole state.
   */
  const zoneCache = new Map();
  async function zoneGeometry(url) {
    if (zoneCache.has(url)) return zoneCache.get(url);
    let geom = null;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' }, signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const j = await r.json();
        if (j.geometry) geom = turf.simplify(turf.feature(j.geometry), { tolerance: 0.005, highQuality: false }).geometry;
      }
    } catch { /* leave null — the graphic falls back to the state view */ }
    if (geom || zoneCache.size < 5000) zoneCache.set(url, geom);
    return geom;
  }
  async function withZoneGeometry(alert) {
    const zones = ((alert.properties || {}).affectedZones || []).slice(0, 120);
    if (alert.geometry || !zones.length) return alert;
    const polys = [];
    for (let i = 0; i < zones.length; i += 8) {
      const geoms = await Promise.all(zones.slice(i, i + 8).map(zoneGeometry));
      for (const g of geoms) eachPolygon(g, (p) => polys.push(p));
    }
    if (!polys.length) return alert;
    let geometry = { type: 'MultiPolygon', coordinates: polys };
    // Dissolve shared county borders into one outline, like an SPC watch map.
    try {
      const u = turf.union(turf.featureCollection(polys.map((p) => turf.polygon(p))));
      if (u && u.geometry) geometry = u.geometry;
    } catch { /* keep the per-zone pieces */ }
    return { ...alert, geometry };
  }
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
        if (e && e.noRetry) throw e;     // a bad token will not get better in 30 seconds
        const status = e && (e.status || (e.headers && 429));
        const wait = Math.min(30000, 1500 * Math.pow(2, i)) + Math.floor(Math.random() * 500);
        log(`post attempt ${i + 1}/${tries} failed (${e.message || status}); retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  // Render + (optionally) post one alert; persist the outcome.
  async function handleAlert(id, alert, isUpdate, key, only) {
    const rec = { ...baseRec(alert, 'pending'), key: key || id };
    let png = null;
    try {
      png = await renderWarningGraphic(await withZoneGeometry(alert), { radarProduct: config.radarProduct });
      const file = path.join(GRAPHICS_DIR, `${sanitizeId(id)}.png`);
      fs.writeFileSync(file, png);
      rec.graphicPath = path.basename(file);
    } catch (e) {
      rec.status = 'error'; rec.error = 'graphic: ' + e.message;
      store[id] = rec; saveStore();
      log('graphic render failed for', id, '-', e.message);
      return rec;
    }

    const dests = only || activeDestinations();
    if (!dests.length) {
      rec.status = 'skipped'; rec.reason = 'no-credentials';
      store[id] = rec; saveStore();
      log('generated graphic (no destination configured) for', rec.event, '—', shortArea(alert));
      return rec;
    }

    const alt = `${rec.event} for ${areaLabel(alert, 8)}. ${untilLabel(alert) ? 'Until ' + untilLabel(alert) + '.' : ''}`;
    const { results, errors } = await postEverywhere(alert, png, { prefix: isUpdate ? 'UPDATE:' : '', alt, only: dests });
    const done = Object.keys(results);
    rec.status = done.length ? 'posted' : 'error';
    rec.postedTo = done;
    if (results.bluesky) { rec.postUri = results.bluesky.uri || null; rec.postCid = results.bluesky.cid || null; }
    if (results.facebook) rec.fbPostId = results.facebook.id || null;
    rec.error = errors.length ? 'post: ' + errors.join(' | ') : null;
    store[id] = rec; saveStore();
    if (done.length) log('posted', rec.event, '—', shortArea(alert), '→', done.join(' + '));
    if (errors.length) log('post failed for', id, '-', rec.error);
    return rec;
  }

  function shortArea(alert) { return areaLabel(alert, 3); }
  function sanitizeId(id) { return String(id).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120); }

  async function fetchActive() {
    const res = await fetch(ALERTS_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('NWS alerts HTTP ' + res.status);
    return (await res.json()).features || [];
  }

  // ── the poll cycle ────────────────────────────────────────────────────────────
  async function poll() {
    if (!config.enabled || polling) return;
    polling = true;
    try {
      const feats = await fetchActive();
      let posted = 0; let changed = false;
      const handledKeys = new Set(Object.values(store).map((r) => r.key).filter(Boolean));
      const groups = new Map(); // eventKey → [{ id, alert, isUpdate }]

      for (const alert of feats) {
        const id = alert.id;
        const props = alert.properties || {};
        if (!id || !props.event) continue;

        // Only ever consider (store) alerts we actually care about — keeps the
        // dedup store small even during nationwide severe outbreaks.
        if (!typeEnabled(props.event) || !matchesScope(props)) continue;

        const rec = store[id];
        const key = eventKey(id, props);
        const msgType = props.messageType;
        const isUpdate = msgType === 'Update';
        const isCancel = msgType === 'Cancel';

        // Cold-start baseline: record active-but-unseen alerts WITHOUT posting.
        if (!baselined && !rec) {
          store[id] = { ...baseRec(alert, 'baseline'), key }; handledKeys.add(key); changed = true; continue;
        }

        if (rec) {
          const materialUpdate = isUpdate && config.postUpdates &&
            rec.status === 'posted' && rec.sig !== alertSig(alert);
          if (!materialUpdate) continue; // already handled, nothing material changed
        }

        if (isCancel && !config.postCancellations) {
          store[id] = baseRec(alert, 'skipped', 'cancellation-disabled'); changed = true; continue;
        }

        // A late piece of an event that was already posted: never post it twice.
        if (!rec && handledKeys.has(key)) {
          store[id] = { ...baseRec(alert, 'skipped', 'same-event'), key }; changed = true; continue;
        }

        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ id, alert, isUpdate: isUpdate && !!rec });
      }

      const now = Date.now();
      for (const k of watchSeen.keys()) if (!groups.has(k)) watchSeen.delete(k);
      const ordered = [...groups.entries()].sort((a, b) =>
        priority(a[1][0].alert.properties.event) - priority(b[1][0].alert.properties.event));
      for (const [key, items] of ordered) {
        if (isWatch(items[0].alert.properties.event)) {
          if (!watchSeen.has(key)) watchSeen.set(key, now);
          if (now - watchSeen.get(key) < WATCH_SETTLE_MS) continue; // let the other pieces arrive
        }
        if (posted >= MAX_POSTS_PER_CYCLE) continue; // defer to next cycle (still unstored → re-evaluated)
        posted++;
        const [lead, ...rest] = items;
        const rec = await handleAlert(lead.id, mergeAlerts(items.map((x) => x.alert)), lead.isUpdate, key);
        for (const x of rest) {
          store[x.id] = { ...baseRec(x.alert, rec.status, 'merged'), key, mergedInto: lead.id }; changed = true;
        }
        watchSeen.delete(key);
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
      facebookConfigured: facebookConfigured(),
      facebookPageId: facebookConfigured() ? fbPage() : null,
      activeDestinations: activeDestinations(),
      pollSeconds: POLL_MS / 1000,
      alertTypeCatalog: CATALOG,
      storeSize: Object.keys(store).length,
    });
  });

  app.post('/admin/nwsx/config', requireAdmin, express_json_guard, (req, res) => {
    const b = req.body || {};
    if (typeof b.enabled === 'boolean') config.enabled = b.enabled;
    if (typeof b.postUpdates === 'boolean') config.postUpdates = b.postUpdates;
    if (typeof b.postCancellations === 'boolean') config.postCancellations = b.postCancellations;
    if (typeof b.allWarnings === 'boolean') config.allWarnings = b.allWarnings;
    if (typeof b.allWatches === 'boolean') config.allWatches = b.allWatches;
    if (b.radarProduct === 'reflectivity' || b.radarProduct === 'velocity') config.radarProduct = b.radarProduct;
    if (b.destinations && typeof b.destinations === 'object') {
      for (const k of ['bluesky', 'facebook']) {
        if (typeof b.destinations[k] === 'boolean') config.destinations[k] = b.destinations[k];
      }
    }
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

  /*
   * Post recent alerts by hand — for alerts that slipped by while auto-posting
   * was off (or were baselined when it was switched on). Lists every active
   * warning/watch issued in the last N minutes, one row per event, and posts
   * the ones the admin ticks. Posting runs in the background (each graphic
   * takes several seconds); the panel polls GET /recent for progress.
   */
  let job = { running: false, total: 0, done: 0, current: null, errors: [] };

  function recentGroups(feats, minutes) {
    const since = Date.now() - minutes * 60000;
    const groups = new Map();
    for (const alert of feats) {
      const p = alert.properties || {};
      if (!alert.id || !p.event) continue;
      if (!isWarning(p.event) && !isWatch(p.event) && !config.alertTypes[p.event]) continue;
      if (!(Date.parse(p.sent || p.effective || '') >= since)) continue;
      const key = eventKey(alert.id, p);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(alert);
    }
    return groups;
  }

  // What happened to this event so far: posted / posting / not posted (why).
  function eventStatus(key, alerts) {
    const ids = new Set(alerts.map((a) => a.id));
    const recs = Object.entries(store).filter(([id, r]) => r.key === key || ids.has(id)).map(([, r]) => r);
    const posted = recs.find((r) => r.status === 'posted');
    if (posted) return { status: 'posted', postedTo: posted.postedTo || [] };
    if (recs.some((r) => r.status === 'pending')) return { status: 'posting' };
    const last = recs.find((r) => r.status === 'error') || recs[0];
    if (!last) return { status: 'new', reason: config.enabled ? 'waiting for next poll' : 'auto-posting was off' };
    const why = { baseline: 'already active when auto-posting started' }[last.status] || last.reason || last.status;
    return { status: last.status === 'error' ? 'error' : 'not posted', reason: why, error: last.error || null };
  }

  app.get('/admin/nwsx/recent', requireAdmin, async (req, res) => {
    const minutes = Math.min(24 * 60, Math.max(5, parseInt(req.query.minutes, 10) || 30));
    try {
      const groups = recentGroups(await fetchActive(), minutes);
      const items = [...groups.entries()].map(([key, alerts]) => {
        const merged = mergeAlerts(alerts);
        const p = merged.properties;
        return {
          key, event: p.event, area: areaLabel(merged, 6), office: officeName(p.senderName),
          sent: p.sent, expires: p.expires, pieces: alerts.length,
          matchesFilters: typeEnabled(p.event) && alerts.some((a) => matchesScope(a.properties || {})),
          ...eventStatus(key, alerts),
        };
      }).sort((a, b) => String(b.sent).localeCompare(String(a.sent)));
      res.json({
        minutes, items, job,
        destinations: { bluesky: blueskyConfigured(), facebook: facebookConfigured() },
        defaultDestinations: activeDestinations(),
      });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  app.post('/admin/nwsx/post-recent', requireAdmin, express_json_guard, async (req, res) => {
    if (job.running) return res.status(409).json({ error: 'Already posting — wait for it to finish.' });
    const b = req.body || {};
    const keys = Array.isArray(b.keys) ? [...new Set(b.keys.map(String))].slice(0, 50) : [];
    const ready = { bluesky: blueskyConfigured(), facebook: facebookConfigured() };
    const only = (Array.isArray(b.destinations) ? b.destinations : []).filter((d) => ready[d]);
    if (!keys.length) return res.status(400).json({ error: 'Tick at least one alert.' });
    if (!only.length) return res.status(400).json({ error: 'Choose Facebook or Bluesky (its env vars must be set on the server).' });
    let groups;
    try { groups = recentGroups(await fetchActive(), 24 * 60); }
    catch (e) { return res.status(502).json({ error: e.message }); }
    const todo = keys.filter((k) => groups.has(k) && eventStatus(k, groups.get(k)).status !== 'posted');
    if (!todo.length) return res.status(400).json({ error: 'Those alerts have expired or were already posted.' });

    // Claim every piece now so the poller cannot post the same event meanwhile.
    for (const k of todo) for (const a of groups.get(k)) store[a.id] = { ...baseRec(a, 'pending'), key: k };
    saveStore();
    job = { running: true, total: todo.length, done: 0, current: null, errors: [] };
    log('manual post of', todo.length, 'recent alert(s) by', req.user && req.user.email, '→', only.join(' + '));
    res.json({ ok: true, queued: todo.length, skipped: keys.length - todo.length });

    (async () => {
      for (const k of todo) {
        const alerts = groups.get(k);
        const [lead, ...rest] = alerts;
        job.current = `${lead.properties.event} — ${shortArea(lead)}`;
        try {
          const rec = await handleAlert(lead.id, mergeAlerts(alerts), false, k, only);
          for (const a of rest) store[a.id] = { ...baseRec(a, rec.status, 'merged'), key: k, mergedInto: lead.id };
          if (rec.error) job.errors.push(`${lead.properties.event}: ${rec.error}`);
        } catch (e) {
          for (const a of alerts) store[a.id] = { ...baseRec(a, 'error'), key: k, error: e.message };
          job.errors.push(`${lead.properties.event}: ${e.message}`);
        }
        saveStore();
        job.done++;
      }
      job.running = false; job.current = null;
    })();
  });

  // Diagnostic: does the Level 2 radar pipeline work from THIS host? Reports the
  // nearest station, which source served the volume, bytes, and gate count.
  app.get('/admin/nwsx/radar-check', requireAdmin, async (req, res) => {
    let lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
    if (!isFinite(lat) || !isFinite(lon)) { lat = 35.33; lon = -97.28; } // near KTLX (central US)
    const product = req.query.product === 'velocity' ? 'VEL' : 'REF';
    try {
      const { diagnose } = require('./nws_radar_l2');
      res.json(await diagnose(lat, lon, product));
    } catch (e) { res.status(500).json({ error: e.message }); }
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
      let posted = null; let errors = [];
      /*
       * `destination` tests ONE place, and only needs its credentials — not
       * its admin switch — so a destination can be tried before it goes live.
       */
      const dest = req.body && req.body.destination;
      let only;
      if (dest === 'facebook' || dest === 'bluesky') {
        const ready = dest === 'facebook' ? facebookConfigured() : blueskyConfigured();
        if (doPost && !ready) {
          return res.status(400).json({ error: dest === 'facebook'
            ? 'FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN are not set on the server (restart after editing .env).'
            : 'Bluesky credentials not configured on the server.' });
        }
        only = [dest];
      }
      if (doPost) {
        if (!only && !activeDestinations().length) {
          return res.status(400).json({ error: 'No destination is configured and switched on (Bluesky or Facebook).' });
        }
        const out = await postEverywhere(alert, png, { prefix: '[TEST]', alt: 'Echo Radar test warning graphic.', only });
        posted = out.results; errors = out.errors;
        log('TEST post sent by admin', req.user && req.user.email, '→', Object.keys(posted).join(' + ') || 'nothing',
          errors.length ? '| errors: ' + errors.join(' | ') : '');
        if (!Object.keys(posted).length) return res.status(500).json({ error: errors.join(' | ') });
      }
      const prefix = doPost ? '[TEST]' : '';
      res.json({
        ok: true,
        previewText: buildPostText(alert, { prefix }),
        facebookText: buildFacebookText(alert, { prefix }),
        image: 'data:image/png;base64,' + png.toString('base64'),
        posted,
        errors,
      });
    } catch (e) {
      log('test failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /*
   * Is the Facebook Page token good? Names the Page it posts to and says when
   * the token expires — a Page token from /me/accounts should say never. The
   * token itself is never sent to the browser.
   */
  app.get('/admin/nwsx/facebook-check', requireAdmin, async (req, res) => {
    if (!facebookConfigured()) {
      return res.json({ ok: false, error: 'FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN are not set on the server.' });
    }
    try {
      const t = encodeURIComponent(fbToken());
      const page = await (await fetch(`${FB_GRAPH}/${encodeURIComponent(fbPage())}?fields=id,name&access_token=${t}`)).json();
      if (page.error) return res.json({ ok: false, error: fbError(page, 400).message });
      const dbg = ((await (await fetch(`${FB_GRAPH}/debug_token?input_token=${t}&access_token=${t}`)).json()) || {}).data || {};
      const scopes = dbg.scopes || [];
      res.json({
        ok: true,
        page: page.name, pageId: page.id,
        tokenType: dbg.type || null,
        expires: dbg.expires_at ? new Date(dbg.expires_at * 1000).toISOString() : 'never',
        canPost: scopes.includes('pages_manage_posts'),
      });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // ── start the poller ──────────────────────────────────────────────────────────
  // Interval always ticks; poll() no-ops while disabled so toggling the master
  // switch in admin takes effect without a restart.
  setInterval(() => { poll().catch((e) => log('unhandled poll rejection:', e.message)); }, POLL_MS);
  setTimeout(() => { poll().catch((e) => log('unhandled poll rejection:', e.message)); }, 4000);
  log(`attached — polling every ${POLL_MS / 1000}s;`,
    `enabled: ${config.enabled};`, `bluesky: ${blueskyConfigured() ? 'configured' : 'not configured'};`,
    `facebook: ${facebookConfigured() ? 'configured' : 'not configured'}`);

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
