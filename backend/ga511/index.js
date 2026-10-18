/*
 * backend/ga511/index.js
 * State DOT traffic cameras from 511 sites that run the shared 511 platform
 * (same /api/v2/get/cameras API and /map/Cctv/<viewId> snapshots):
 *
 *   GET /api/511cams/ga   Georgia 511 (511ga.org)        key GA511_API_KEY
 *   GET /api/511cams/nc   NCDOT DriveNC (drivenc.gov)    key NC511_API_KEY
 *   GET /api/511cams/tn   TDOT SmartWay open data        key TN511_API_KEY
 *   GET /api/511cams/al   ALDOT ALGO Traffic             no key (public API)
 *   GET /api/511cams/sc   SCDOT 511SC                    no key (public GeoJSON)
 *
 * → GeoJSON points, one per enabled camera view.
 *
 * Tennessee is not on the shared platform: TDOT's open-data API
 * (www.tdot.tn.gov/opendata, the same feed smartway.tn.gov uses) takes the
 * key in an `ApiKey` header and returns its own shape, with a snapshot URL per
 * camera rather than one built from the id — so its features carry that URL
 * (`u`).
 *
 * TN KEY: TN511_API_KEY when set (a key TDOT issued to Echo Radar). Until then
 * — David's decision, 2026-10-17 — it falls back to the key smartway.tn.gov
 * publishes for its own visitors in its public config file, read at runtime
 * (never copied into this repo) so a rotation on TDOT's side is picked up. That
 * key is TDOT's, not ours: they can revoke or block it at any time, and the
 * layer then reports "unavailable" until an own key is set.
 *
 * WHY THIS IS PROXIED
 * The developer APIs need a key. Calling them from the browser would hand the
 * key to every visitor, and they allow only 10 calls a minute per key — a
 * handful of users toggling a layer would exhaust it. One cached fetch here
 * serves everyone.
 *
 * The snapshots themselves need no key (public, CORS-open, cached 60 s
 * upstream), so the browser loads them directly and builds the URL from the
 * view id — see SNAPSHOT in components/ga511_cams.js.
 *
 * Camera LISTS barely change (cameras are added or retired, not moved), so
 * each is cached for 10 minutes and served stale if the 511 site is down.
 *
 * Adding a state on the same platform = one entry here + one in
 * components/ga511_cams.js + a menu row + its key in .env.
 */

const REGIONS = {
  ga: { name: 'Georgia 511', api: 'https://511ga.org/api/v2/get/cameras', keyEnv: 'GA511_API_KEY', parse: parse511 },
  nc: { name: 'DriveNC', api: 'https://www.drivenc.gov/api/v2/get/cameras', keyEnv: 'NC511_API_KEY', parse: parse511 },
  tn: { name: 'TDOT SmartWay', api: 'https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras', keyEnv: 'TN511_API_KEY', keyHeader: 'ApiKey', parse: parseTdot, fallbackKey: smartwayKey },
  // ALDOT's ALGO Traffic API is open: no key, Cache-Control 300 s upstream.
  al: { name: 'ALGO Traffic', api: 'https://api.algotraffic.com/v4/Cameras', keyless: true, parse: parseAlgo },
  // 511SC has no developer API; its own map loads this public GeoJSON from the
  // Iteris CDN (Cache-Control 60 s). Same file the 511sc.org map draws from.
  sc: { name: '511SC', api: 'https://sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson', keyless: true, parse: parseIteris },
};
const TTL_MS = 10 * 60 * 1000;
const UA = 'EchoRadar (radar.twistcasterlivemedia.com)';

const cache = {};       // region -> { at, body }
const inflight = {};    // region -> promise

const keyFor = (r) => (REGIONS[r].keyEnv ? String(process.env[REGIONS[r].keyEnv] || '').trim() : '');
// A region can run without its own key when it is keyless or has a fallback source.
const usable = (r) => !!REGIONS[r].keyless || !!keyFor(r) || !!REGIONS[r].fallbackKey;

// The key smartway.tn.gov's own config publishes (see TN KEY above). Cached 6 h.
const SMARTWAY_CONFIG = 'https://smartway.tn.gov/config/config.prod.json';
let swKey = null;     // { at, key }
async function smartwayKey(force) {
  if (!force && swKey && Date.now() - swKey.at < 6 * 3600 * 1000) return swKey.key;
  const r = await fetch(SMARTWAY_CONFIG, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`SmartWay config returned HTTP ${r.status}`);
  const key = String((await r.json()).apiKey || '').trim();
  if (!key) throw new Error('SmartWay config no longer carries a key — set TN511_API_KEY.');
  swKey = { at: Date.now(), key };
  return key;
}

async function build(region, retried) {
  const cfg = REGIONS[region];
  const own = keyFor(region);
  const key = cfg.keyless ? null : own || await cfg.fallbackKey(retried);
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  let url = cfg.api;
  if (cfg.keyless) { /* public API */ }
  else if (cfg.keyHeader) headers[cfg.keyHeader] = key;
  else url += `?key=${encodeURIComponent(key)}&format=json`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  // A rejected fallback key may just have been rotated: re-read it once.
  if ((r.status === 401 || r.status === 403) && !own && !cfg.keyless && !retried) return build(region, true);
  if (r.status === 401 || r.status === 403) {
    throw new Error(own ? `${cfg.name} rejected the API key (${cfg.keyEnv}).`
      : `${cfg.name} refused the SmartWay site key — set your own ${cfg.keyEnv}.`);
  }
  if (r.status === 429) throw new Error(`${cfg.name} rate limit reached; try again in a minute.`);
  if (!r.ok) throw new Error(`${cfg.name} returned HTTP ${r.status}`);
  const json = await r.json();
  // Most sources return an array; 511SC returns a GeoJSON FeatureCollection.
  const list = Array.isArray(json) ? json : json && Array.isArray(json.features) ? json.features : null;
  if (!list) throw new Error(`${cfg.name} returned an unexpected response.`);
  const features = cfg.parse(list);
  return JSON.stringify({ type: 'FeatureCollection', fetchedAt: new Date().toISOString(), features });
}

const point = (lon, lat, properties) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [+lon.toFixed(5), +lat.toFixed(5)] },
  properties,
});
const located = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

/*
 * ALDOT ALGO Traffic v4 /Cameras. Only accessLevel "Public" — a few are
 * FirstResponder/ALDOT-only and must not be shown. Each camera carries its own
 * snapshotImageUrl (keyless JPEG).
 */
function parseAlgo(list) {
  const features = [];
  for (const cam of list) {
    if (!cam || cam.accessLevel !== 'Public' || !cam.snapshotImageUrl) continue;
    const L = cam.location || {};
    const lat = +L.latitude, lon = +L.longitude;
    if (!located(lat, lon)) continue;
    const route = L.displayRouteDesignator || L.routeDesignator || '';
    const cross = L.displayCrossStreet || L.crossStreet || '';
    features.push(point(lon, lat, {
      v: cam.id,
      n: [route, cross].filter(Boolean).join(' @ ') || `Camera ${cam.id}`,
      r: route,
      d: L.direction && L.direction !== 'Unknown' ? L.direction : '',
      u: cam.snapshotImageUrl,
      ...(L.county ? { c: L.county } : {}),
      ...(L.city && L.city !== L.county ? { s: L.city } : {}),
    }));
  }
  return features;
}

/*
 * 511SC (Iteris ATIS) camera GeoJSON: Point features whose properties carry
 * description ("I-77 S @ MM 4.9"), route, direction, mrm (mile marker),
 * jurisdiction, active, problem_stream and image_url (keyless PNG snapshot).
 */
function parseIteris(list) {
  const features = [];
  for (const f of list) {
    const p = (f && f.properties) || {};
    const c = (f && f.geometry && f.geometry.coordinates) || [];
    const lon = +c[0], lat = +c[1];
    if (!p.active || p.problem_stream || !p.image_url || !located(lat, lon)) continue;
    features.push(point(lon, lat, {
      v: p.id,
      n: String(p.description || p.name || '').trim(),
      r: p.route || '',
      d: [p.direction, p.mrm != null ? `Mile ${p.mrm}` : ''].filter(Boolean).join(' · '),
      u: p.image_url,
      ...(p.jurisdiction ? { s: p.jurisdiction } : {}),
    }));
  }
  return features;
}

// Shared 511 platform (GA, NC): cameras with Views, snapshot at /map/Cctv/<viewId>.
function parse511(list) {
  const features = [];
  for (const cam of list) {
    const lat = +cam.Latitude, lon = +cam.Longitude;
    if (!located(lat, lon)) continue;
    for (const v of cam.Views || []) {
      if (!v || !v.Id || v.Status !== 'Enabled') continue;
      // Short keys: thousands of cameras and no response compression on this server.
      features.push(point(lon, lat, {
        v: v.Id,
        n: String(cam.Location || v.Description || cam.Name || '').trim(),
        r: cam.Roadway || '',
        d: cam.Direction && cam.Direction !== 'Unknown' ? cam.Direction : '',
        ...(cam.County ? { c: cam.County } : {}),
      }));
    }
  }
  return features;
}

/*
 * TDOT open data. Field names are taken from what smartway.tn.gov reads
 * (the API publishes no schema; confirmed against the live feed 2026-10-17):
 * id, title, description, active ("true" as a string), thumbnailUrl,
 * location.coordinates[0].{lat,lng}, route, mileMarker, county.
 * Tolerates plain latitude/longitude too, in case the feed changes shape.
 */
function parseTdot(list) {
  const features = [];
  for (const cam of list) {
    if (!cam || String(cam.active).toLowerCase() !== 'true' || !cam.thumbnailUrl) continue;
    const c = (cam.location && Array.isArray(cam.location.coordinates) && cam.location.coordinates[0]) || {};
    const lat = +(c.lat ?? cam.latitude), lon = +(c.lng ?? c.lon ?? cam.longitude);
    if (!located(lat, lon)) continue;
    features.push(point(lon, lat, {
      v: cam.id,
      n: String(cam.title || cam.description || '').trim(),
      r: cam.route || '',
      d: cam.mileMarker != null && cam.mileMarker !== '' ? `Mile ${cam.mileMarker}` : '',
      u: cam.thumbnailUrl,
      ...(cam.county ? { c: cam.county } : {}),
      ...(cam.description && cam.description !== cam.title ? { s: String(cam.description).trim() } : {}),
    }));
  }
  return features;
}

async function cameras(region) {
  const hit = cache[region];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body;
  if (inflight[region]) return inflight[region];
  inflight[region] = (async () => {
    try {
      const body = await build(region);
      cache[region] = { at: Date.now(), body };
      return body;
    } catch (e) {
      if (hit) { console.warn(`[511] ${region} refresh failed, serving cached list:`, e.message); return hit.body; }
      throw e;
    } finally {
      delete inflight[region];
    }
  })();
  return inflight[region];
}

function attachGa511({ app, requireAuth }) {
  // Which regions have a key on this server — the menu hides the rest rather
  // than offering a switch that can only show "not set up".
  app.get('/api/511cams', requireAuth, (req, res) => {
    res.json(Object.fromEntries(Object.keys(REGIONS).map((r) => [r, usable(r)])));
  });

  app.get('/api/511cams/:region', requireAuth, async (req, res) => {
    const region = String(req.params.region || '').toLowerCase();
    const cfg = REGIONS[region];
    if (!cfg) return res.status(404).json({ error: 'Unknown 511 region.' });
    if (!usable(region)) {
      return res.status(503).json({ error: `${cfg.name} cameras are not set up on this server (${cfg.keyEnv} is missing).` });
    }
    try {
      const body = await cameras(region);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(body);
    } catch (e) {
      // Never echo the request URL: it carries the key.
      console.warn(`[511] ${region} cameras unavailable:`, e.message);
      res.status(502).json({ error: e.message });
    }
  });
  console.log('[511] attached —', Object.keys(REGIONS).map((r) => `${r}: ${REGIONS[r].keyless ? 'public' : keyFor(r) ? 'key configured'
    : REGIONS[r].fallbackKey ? 'using SmartWay site key' : REGIONS[r].keyEnv + ' not set'}`).join(', '));
}

module.exports = { attachGa511 };
