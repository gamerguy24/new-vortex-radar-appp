/*
 * backend/ga511/index.js
 * State DOT traffic cameras from 511 sites that run the shared 511 platform
 * (same /api/v2/get/cameras API and /map/Cctv/<viewId> snapshots):
 *
 *   GET /api/511cams/ga   Georgia 511 (511ga.org)        key GA511_API_KEY
 *   GET /api/511cams/nc   NCDOT DriveNC (drivenc.gov)    key NC511_API_KEY
 *   GET /api/511cams/tn   TDOT SmartWay open data        key TN511_API_KEY
 *
 * → GeoJSON points, one per enabled camera view.
 *
 * Tennessee is not on the shared platform: TDOT's open-data API
 * (www.tdot.tn.gov/opendata, the same feed smartway.tn.gov uses) takes the
 * key in an `ApiKey` header and returns its own shape, with a snapshot URL per
 * camera rather than one built from the id — so its features carry that URL
 * (`u`). Keys are free from TDOT's open-data sign-up; never reuse the key the
 * SmartWay site itself sends, which is TDOT's own.
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
  tn: { name: 'TDOT SmartWay', api: 'https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras', keyEnv: 'TN511_API_KEY', keyHeader: 'ApiKey', parse: parseTdot },
};
const TTL_MS = 10 * 60 * 1000;
const UA = 'EchoRadar (radar.twistcasterlivemedia.com)';

const cache = {};       // region -> { at, body }
const inflight = {};    // region -> promise

const keyFor = (r) => String(process.env[REGIONS[r].keyEnv] || '').trim();

async function build(region) {
  const cfg = REGIONS[region];
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  let url = cfg.api;
  if (cfg.keyHeader) headers[cfg.keyHeader] = keyFor(region);
  else url += `?key=${encodeURIComponent(keyFor(region))}&format=json`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (r.status === 401 || r.status === 403) throw new Error(`${cfg.name} rejected the API key (${cfg.keyEnv}).`);
  if (r.status === 429) throw new Error(`${cfg.name} rate limit reached; try again in a minute.`);
  if (!r.ok) throw new Error(`${cfg.name} returned HTTP ${r.status}`);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error(`${cfg.name} returned an unexpected response.`);
  const features = cfg.parse(list);
  return JSON.stringify({ type: 'FeatureCollection', fetchedAt: new Date().toISOString(), features });
}

const point = (lon, lat, properties) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [+lon.toFixed(5), +lat.toFixed(5)] },
  properties,
});
const located = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

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
 * (the API publishes no schema): id, title, description, active ("true" as a
 * string), thumbnailUrl, location.coordinates[0].{lat,lng}, route, mileMarker.
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
    res.json(Object.fromEntries(Object.keys(REGIONS).map((r) => [r, !!keyFor(r)])));
  });

  app.get('/api/511cams/:region', requireAuth, async (req, res) => {
    const region = String(req.params.region || '').toLowerCase();
    const cfg = REGIONS[region];
    if (!cfg) return res.status(404).json({ error: 'Unknown 511 region.' });
    if (!keyFor(region)) {
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
  console.log('[511] attached —', Object.keys(REGIONS).map((r) => `${r}: ${keyFor(r) ? 'key configured' : REGIONS[r].keyEnv + ' not set'}`).join(', '));
}

module.exports = { attachGa511 };
