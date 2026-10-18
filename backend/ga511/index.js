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
 *   GET /api/511cams/ok   ODOT OKTraffic (oktraffic.org) no key (public API, live HLS video)
 *   GET /api/511cams/ky   KYTC traffic cameras (ArcGIS)  no key (public FeatureServer)
 *   GET /api/511cams/ms   MDOT MDOTtraffic.com           no key (public page method)
 *   GET /api/511cams/ms/views/:site   the camera views at one MDOT site
 *   GET /api/511cams/la   LADOTD 511LA (511la.org)       no key (public list page data)
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

/*
 * Oklahoma: oktraffic.org is a LoopBack app; its map asks for camera poles with
 * their cameras and stream records. This is the same filter it sends for the
 * public: in-service web cameras not blocked from the traveller site.
 */
const OK_FILTER = JSON.stringify({ include: [{ relation: 'mapCameras', scope: { include: 'streamDictionary',
  where: { status: { neq: 'Out Of Service' }, type: 'Web', blockAtis: { neq: '1' } } } }] });

const REGIONS = {
  ga: { name: 'Georgia 511', api: 'https://511ga.org/api/v2/get/cameras', keyEnv: 'GA511_API_KEY', parse: parse511 },
  nc: { name: 'DriveNC', api: 'https://www.drivenc.gov/api/v2/get/cameras', keyEnv: 'NC511_API_KEY', parse: parse511 },
  tn: { name: 'TDOT SmartWay', api: 'https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras', keyEnv: 'TN511_API_KEY', keyHeader: 'ApiKey', parse: parseTdot, fallbackKey: smartwayKey },
  // ALDOT's ALGO Traffic API is open: no key, Cache-Control 300 s upstream.
  al: { name: 'ALGO Traffic', api: 'https://api.algotraffic.com/v4/Cameras', keyless: true, parse: parseAlgo },
  // 511SC has no developer API; its own map loads this public GeoJSON from the
  // Iteris CDN (Cache-Control 60 s). Same file the 511sc.org map draws from.
  sc: { name: '511SC', api: 'https://sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson', keyless: true, parse: parseIteris },
  // OKTraffic has no stills: every camera is a live HLS stream (CORS-open), one
  // pole carrying several. One feature per pole, its cameras as views (`vs`).
  ok: { name: 'OKTraffic', api: `https://oktraffic.org/api/CameraPoles?filter=${encodeURIComponent(OK_FILTER)}`, keyless: true, parse: parseOkTraffic },
  // KYTC's public camera FeatureServer: the layer behind its ArcGIS web map
  // (webmap 0666efd2054343b080b5c2f0924ef2ae). ~256 cameras, well under one page.
  ky: { name: 'KYTC', api: 'https://services2.arcgis.com/CcI36Pduqd0OR4W9/arcgis/rest/services/trafficCamerasCur_Prd/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson', keyless: true, parse: parseKytc },
  // MDOTtraffic.com's map calls an ASP.NET page method (POST, {"d": [...]})
  // that lists camera SITES only; a site's views live in its map bubble page,
  // fetched on demand by /api/511cams/ms/views/:site (siteViews below).
  ms: { name: 'MDOTtraffic', api: 'https://www.mdottraffic.com/default.aspx/LoadCameraData', keyless: true, post: true, parse: parseMdot },
  // 511LA is on the shared platform, but its developer API needs a key we do
  // not have. Its public /cctv list page reads this keyless DataTables
  // endpoint instead, 100 rows at most per request (loadListPages).
  la: { name: '511LA', api: 'https://www.511la.org/List/GetData/Cameras', host: 'https://www.511la.org', keyless: true, load: loadListPages, parse: parseList511 },
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
  // Sources that need more than one request fetch their own list.
  if (cfg.load) {
    const features = cfg.parse(await cfg.load(cfg));
    return JSON.stringify({ type: 'FeatureCollection', fetchedAt: new Date().toISOString(), features });
  }
  const own = keyFor(region);
  const key = cfg.keyless ? null : own || await cfg.fallbackKey(retried);
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  const opts = { headers, signal: AbortSignal.timeout(30000) };
  if (cfg.post) { opts.method = 'POST'; opts.body = '{}'; headers['Content-Type'] = 'application/json; charset=utf-8'; }
  let url = cfg.api;
  if (cfg.keyless) { /* public API */ }
  else if (cfg.keyHeader) headers[cfg.keyHeader] = key;
  else url += `?key=${encodeURIComponent(key)}&format=json`;
  const r = await fetch(url, opts);
  // A rejected fallback key may just have been rotated: re-read it once.
  if ((r.status === 401 || r.status === 403) && !own && !cfg.keyless && !retried) return build(region, true);
  if (r.status === 401 || r.status === 403) {
    throw new Error(own ? `${cfg.name} rejected the API key (${cfg.keyEnv}).`
      : `${cfg.name} refused the SmartWay site key — set your own ${cfg.keyEnv}.`);
  }
  if (r.status === 429) throw new Error(`${cfg.name} rate limit reached; try again in a minute.`);
  if (!r.ok) throw new Error(`${cfg.name} returned HTTP ${r.status}`);
  const json = await r.json();
  // Most sources return an array; 511SC and KYTC a GeoJSON FeatureCollection;
  // MDOT's ASP.NET page method wraps its array in {"d": [...]}.
  const list = Array.isArray(json) ? json : json && Array.isArray(json.features) ? json.features
    : json && Array.isArray(json.d) ? json.d : null;
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

/*
 * OKTraffic camera poles. A pole is one site ("I-44 & I-240") with one camera
 * per direction; each camera's streamDictionary.streamSrc is its HLS playlist.
 * Views go in `vs` as { t: title, l: button label, h: HLS url }.
 */
function parseOkTraffic(list) {
  const features = [];
  for (const pole of list) {
    const vs = [];
    let lat = NaN, lon = NaN, city = '';
    for (const m of (pole && pole.mapCameras) || []) {
      const h = m && m.streamDictionary && m.streamDictionary.streamSrc;
      if (!h || !/^https:\/\//.test(h)) continue;
      if (!located(lat, lon)) { lat = +m.latitude; lon = +m.longitude; }
      if (!city && m.city) city = m.city;
      vs.push({ t: String(m.location || pole.name || '').trim(), l: m.direction || String(vs.length + 1), h });
    }
    if (!vs.length || !located(lat, lon)) continue;
    numberRepeats(vs);
    features.push(point(lon, lat, {
      v: pole.id,
      n: String(pole.name || vs[0].t).trim(),
      r: '',
      d: '',
      vs,
      ...(city ? { s: city } : {}),
    }));
  }
  return features;
}

/*
 * KYTC FeatureServer (GeoJSON): description, highway, direction, milemarker,
 * county, status, snapshot. A few rows are Indiana cameras (TRIMARC, INDOT)
 * with http-only snapshots: an https page cannot load those and their https
 * URLs 404, so only https snapshots are kept.
 */
function parseKytc(list) {
  const features = [];
  for (const f of list) {
    const p = (f && f.properties) || {};
    const c = (f && f.geometry && f.geometry.coordinates) || [];
    const lon = +c[0], lat = +c[1];
    if (!/^https:\/\//.test(p.snapshot || '') || p.status === 'Offline' || !located(lat, lon)) continue;
    features.push(point(lon, lat, {
      v: p.id != null ? p.id : p.OBJECTID,
      n: String(p.description || p.name || '').trim(),
      r: p.highway || '',
      d: [p.direction, p.milemarker != null ? `Mile ${p.milemarker}` : ''].filter(Boolean).join(' · '),
      u: p.snapshot,
      ...(p.county ? { c: p.county } : {}),
    }));
  }
  return features;
}

/*
 * MDOTtraffic camera sites: markerid "camsite_<n>", tooltip (site name), lat,
 * lon. `x` tells the browser to fetch the site's views (siteViews).
 */
function parseMdot(list) {
  const features = [];
  for (const m of list) {
    const site = /^camsite_(\d+)$/.exec((m && m.markerid) || '');
    const lat = +(m && m.lat), lon = +(m && m.lon);
    if (!site || !located(lat, lon)) continue;
    features.push(point(lon, lat, { v: +site[1], n: String(m.tooltip || '').trim(), r: '', d: '', x: 1 }));
  }
  return features;
}

/*
 * One MDOT site's camera views, read from its map bubble page
 * (mapbubbles/camerasite.aspx?site=N). Each view is a button there:
 *   <a ... title='I-55 N at Lakeland Dr PTZ' ... onclick="javascript:switchImage('<thumbnail url>', ...)">N</a>
 * The thumbnail is a live Wowza still, asked for at 704x480 rather than the
 * bubble's 352x240. Cached 30 min per site; only sites someone opens are fetched.
 */
const VIEW_TTL_MS = 30 * 60 * 1000;
const viewCache = new Map();   // site -> { at, views } | { p } while a fetch is running
const bigger = (u) => u.replace(/size=\d+x\d+/, 'size=704x480');

// Two views facing the same way would get identical buttons ("N", "N"):
// number the repeats ("N 1", "N 2") so they can be told apart.
function numberRepeats(views) {
  const count = {};
  for (const v of views) count[v.l] = (count[v.l] || 0) + 1;
  const seen = {};
  for (const v of views) if (count[v.l] > 1) v.l = `${v.l} ${(seen[v.l] = (seen[v.l] || 0) + 1)}`;
  return views;
}
async function siteViews(site) {
  const hit = viewCache.get(site);
  if (hit && hit.p) return hit.p;
  if (hit && Date.now() - hit.at < VIEW_TTL_MS) return hit.views;
  const p = (async () => {
    const r = await fetch(`https://www.mdottraffic.com/mapbubbles/camerasite.aspx?site=${site}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`MDOTtraffic returned HTTP ${r.status}`);
    const html = await r.text();
    const views = [];
    const re = /<a[^>]*\btitle='([^']*)'[^>]*switchImage\('(https:\/\/[^']+)'[^>]*>([^<]*)<\/a>/g;
    for (let m; (m = re.exec(html));) views.push({ t: m[1].trim(), l: m[3].trim() || String(views.length + 1), u: bigger(m[2]) });
    // A single-view site may have no buttons: fall back to its one image.
    if (!views.length) {
      const img = /<img[^>]*id="camimg"[^>]*alt='([^']*)'[^>]*src='(https:\/\/[^']+)'/.exec(html);
      if (img) views.push({ t: img[1].trim(), l: '1', u: bigger(img[2]) });
    }
    return numberRepeats(views);
  })();
  viewCache.set(site, { p });
  try {
    const views = await p;
    viewCache.set(site, { at: Date.now(), views });
    return views;
  } catch (e) {
    if (hit && hit.views) { viewCache.set(site, hit); return hit.views; }
    viewCache.delete(site);
    throw e;
  }
}

/*
 * The shared platform's public list-page data (/List/GetData/Cameras), as the
 * /cctv page asks for it. The server caps `length` at 100, so page through
 * until recordsTotal is reached (336 sites in 511LA, 2026-10-18).
 */
async function loadListPages(cfg) {
  const rows = [];
  for (let start = 0, total = Infinity; start < total && start < 5000; start += 100) {
    const query = JSON.stringify({ columns: [{ data: null, name: '' }, { name: 'sortOrder', s: true }, { name: 'roadway', s: true }],
      order: [{ column: 1, dir: 'asc' }], start, length: 100, search: { value: '' } });
    const r = await fetch(`${cfg.api}?query=${encodeURIComponent(query)}&lang=en`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${cfg.name} returned HTTP ${r.status}`);
    const j = await r.json();
    if (!j || !Array.isArray(j.data)) throw new Error(`${cfg.name} returned an unexpected response.`);
    rows.push(...j.data);
    total = +j.recordsTotal || 0;
    if (!j.data.length) break;
  }
  return rows;
}

/*
 * List-page camera sites: location, roadway, latLng as WKT "POINT (lon lat)",
 * images[] (imageUrl "/map/Cctv/<id>", description "Traffic closest to this
 * camera is traveling eastbound on I-20."). Direction is always "Unknown" in
 * 511LA, so a view's button label comes from that description.
 */
function parseList511(list) {
  const features = [];
  const host = REGIONS.la.host;
  for (const site of list) {
    const m = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec((site && site.latLng && site.latLng.geography && site.latLng.geography.wellKnownText) || '');
    const lon = m ? +m[1] : NaN, lat = m ? +m[2] : NaN;
    if (!located(lat, lon) || site.visible === false) continue;
    const vs = (site.images || []).filter((im) => im && im.imageUrl && !im.disabled && !im.blocked).map((im, i) => {
      const dir = /traveling (north|south|east|west)bound/i.exec(im.description || '');
      return { t: String(im.description || '').trim(), l: dir ? dir[1][0].toUpperCase() + 'B' : String(i + 1), u: new URL(im.imageUrl, host).href };
    });
    if (!vs.length) continue;
    numberRepeats(vs);
    features.push(point(lon, lat, {
      v: site.id,
      n: String(site.location || '').trim(),
      r: site.roadway || '',
      d: site.direction && site.direction !== 'Unknown' ? site.direction : '',
      ...(vs.length > 1 ? { vs } : { u: vs[0].u, s: vs[0].t }),
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

  app.get('/api/511cams/ms/views/:site', requireAuth, async (req, res) => {
    const site = Number(req.params.site);
    if (!Number.isInteger(site) || site <= 0 || site > 1e6) return res.status(400).json({ error: 'Bad camera site.' });
    try {
      const views = await siteViews(site);
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.json({ views });
    } catch (e) {
      console.warn(`[511] ms site ${site} views unavailable:`, e.message);
      res.status(502).json({ error: e.message });
    }
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
