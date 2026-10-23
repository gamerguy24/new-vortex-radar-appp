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
 *   GET /api/511cams/la   LADOTD 511LA (511la.org)       no key (public list page data)
 *   GET /api/511cams/ar   ARDOT iDriveArkansas           no key (public GeoJSON; stills only)
 *   GET /api/511cams/tx   TxDOT DriveTexas (MapLarge)    no key (public table; live HLS video)
 *   GET /api/511cams/:region/views/:id   cameras looked up when one is opened (ms, tx)
 *   GET /api/511cams/national            every state above in one layer (see NATIONAL)
 *   GET /api/511cams/:region/cam/:id     one camera's details, for the national layer's popup
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
const zlib = require('zlib');

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
  ms: { name: 'MDOTtraffic', api: 'https://www.mdottraffic.com/default.aspx/LoadCameraData', keyless: true, post: true, parse: parseMdot,
    views: { id: (s) => (/^\d{1,6}$/.test(s) && +s > 0 ? +s : null), get: (site) => siteViews(site), maxAge: 600 } },
  // 511LA is on the shared platform, but its developer API needs a key we do
  // not have. Its public /cctv list page reads this keyless DataTables
  // endpoint instead, 100 rows at most per request (loadListPages).
  la: { name: '511LA', api: 'https://www.511la.org/List/GetData/Cameras', host: 'https://www.511la.org', keyless: true, load: loadListPages, parse: parseList511 },
  // iDriveArkansas publishes this GeoJSON (CORS *, 60 s cache) and a keyless
  // snapshot per camera at layers.idrivearkansas.com/cameras/<id>.jpg. Its live
  // video is NOT usable here: the CDN wants a session cookie on
  // .idrivearkansas.com, minted only after an AWS WAF bot check (sometimes a
  // CAPTCHA) and refused to other origins. Getting round that would mean
  // defeating their bot protection, so the popup links to their site instead.
  ar: { name: 'iDriveArkansas', api: 'https://layers.idrivearkansas.com/cameras.geojson', keyless: true, parse: parseArdot },
  // DriveTexas keeps its cameras in a public MapLarge table (CORS *). Video
  // only: the table's imageurl points at "localhost". Each row's HLS URL
  // carries a token that lapses after 10 minutes, so the list carries no URLs
  // and a fresh one is looked up when a camera is opened (txViews).
  tx: { name: 'DriveTexas', api: 'https://dtx-e-cdn.maplarge.com', keyless: true, load: loadTxList, parse: parseTx,
    views: { id: (s) => (/^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null), get: (name) => txViews(name), maxAge: 0 } },

  // Shared 511 platform, read through its public list page (see la).
  pa: list511('www.511pa.com', '511PA', { noVideo: true }),
  az: list511('www.az511.gov', 'AZ511'),
  wi: list511('511wi.gov', '511WI'),
  ct: list511('ctroads.org', 'CTroads'),
  id: list511('511.idaho.gov', 'Idaho 511'),
  nv: list511('www.nvroads.com', 'NVroads'),
  ut: list511('udottraffic.utah.gov', 'UDOT Traffic'),
  ak: list511('511.alaska.gov', 'Alaska 511'),
  fl: list511('fl511.com', 'FL511', { noVideo: true }),
  vt: list511('newengland511.org', 'New England 511', { state: 'Vermont' }),
  nh: list511('newengland511.org', 'New England 511', { state: 'New Hampshire' }),
  me: list511('newengland511.org', 'New England 511', { state: 'Maine' }),

  // Castle Rock CARS camera API.
  ny: cars('nysdottg', '511NY'),
  mn: cars('mntg', '511MN'),
  ia: cars('iatg', '511IA'),
  ks: cars('kstg', 'KanDrive'),
  ne: cars('netg', 'Nebraska 511'),
  ma: cars('matg', 'Mass511'),
  in: cars('intg', '511IN'),
  co: cars('cotg', 'COtrip'),

  // SD511 (Iteris ATIS): camera sites with several views each.
  sd: { name: 'SD511', api: 'https://sd.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson', keyless: true, parse: parseIterisSites },

  // State DOTs with their own public feeds.
  ca: { name: 'Caltrans', api: 'https://cwwp2.dot.ca.gov', keyless: true, load: loadCaltrans, parse: parseCaltrans, ttl: 30 * 60 * 1000 },
  de: { name: 'DelDOT', api: 'https://tmc.deldot.gov/json/videocamera.json', keyless: true, parse: parseDeldot, list: (j) => j.videoCameras },
  mo: { name: 'MoDOT Traveler', api: 'https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json', keyless: true, parse: parseModot },
  // TripCheck answers 406 to Accept: application/json (the file is served as JavaScript).
  or: { name: 'TripCheck', api: 'https://tripcheck.com/Scripts/map/data/cctvinventory.js', keyless: true, accept: '*/*', parse: parseTripcheck },
  md: { name: 'MDOT SHA CHART', api: 'https://chartexp1.sha.maryland.gov/CHARTExportClientService/getCameraMapDataJSON.do', keyless: true, parse: parseChart, list: (j) => j.data },
  mi: { name: 'MDOT MiDrive', api: 'https://mdotjboss.state.mi.us/MiDrive/camera/list', keyless: true, parse: parseMidrive },
  wa: { name: 'WSDOT', api: 'https://data.wsdot.wa.gov/mobile/Cameras.json', keyless: true, parse: parseWsdot, list: (j) => j.cameras && j.cameras.items },
  wv: { name: 'WV511', api: 'https://www.wv511.org/wsvc/gmap.asmx/buildCamerasJSONjs', keyless: true, load: loadWv511, parse: parseWv511 },
  // 511 Virginia (Iteris ClearRoute): same camera fields as 511SC, plus HLS.
  va: { name: '511 Virginia', api: 'https://511.vdot.virginia.gov/services/511/map/layers/map/cams', keyless: true, parse: parseIteris },
  il: { name: 'IDOT', api: 'https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0', keyless: true, load: loadArcgisPages, parse: parseIdot },
  nd: { name: 'NDDOT', api: 'https://travelfiles.dot.nd.gov/geojson_nc/cameras.json', keyless: true, parse: parseNddot },
  mt: { name: '511MT', api: 'https://mt.cdn.iteris-atis.com', keyless: true, load: loadMt511, parse: parseIterisSites },
  // Ohio: official OHGO Public API, free key (register at publicapi.ohgo.com).
  oh: { name: 'OHGO', api: 'https://publicapi.ohgo.com/api/v1/cameras', keyEnv: 'OHGO_API_KEY', load: loadOhgo, parse: parseOhgo },
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
    const features = cfg.parse(await cfg.load(cfg), cfg);
    return JSON.stringify({ type: 'FeatureCollection', fetchedAt: new Date().toISOString(), features });
  }
  const own = keyFor(region);
  const key = cfg.keyless ? null : own || await cfg.fallbackKey(retried);
  const headers = { 'User-Agent': UA, Accept: cfg.accept || 'application/json' };
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
  // cfg.list picks the array out of sources that wrap it in their own object.
  const list = cfg.list ? cfg.list(json) : Array.isArray(json) ? json : json && Array.isArray(json.features) ? json.features
    : json && Array.isArray(json.d) ? json.d : null;
  if (!Array.isArray(list)) throw new Error(`${cfg.name} returned an unexpected response.`);
  const features = cfg.parse(list, cfg);
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
 * Iteris ATIS camera GeoJSON (511SC, 511 Virginia): Point features whose
 * properties carry description ("I-77 S @ MM 4.9"), route, direction, mrm
 * (mile marker), jurisdiction, active, problem_stream, image_url (keyless
 * snapshot) and, in Virginia's, https_url (CORS-open HLS).
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
      ...(https(p.https_url) ? { h: p.https_url } : {}),
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
 * /cctv page asks for it. The server caps `length` at 100, so read the first
 * page for recordsTotal, then the rest four at a time (FL511 is ~50 pages).
 */
async function loadListPages(cfg) {
  const page = async (start) => {
    const query = JSON.stringify({ columns: [{ data: null, name: '' }, { name: 'sortOrder', s: true }, { name: 'roadway', s: true }],
      order: [{ column: 1, dir: 'asc' }], start, length: 100, search: { value: '' } });
    const r = await fetch(`${cfg.api}?query=${encodeURIComponent(query)}&lang=en`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${cfg.name} returned HTTP ${r.status}`);
    const j = await r.json();
    if (!j || !Array.isArray(j.data)) throw new Error(`${cfg.name} returned an unexpected response.`);
    return j;
  };
  const first = await page(0);
  const total = Math.min(+first.recordsTotal || 0, 10000);
  const starts = [];
  for (let st = 100; st < total; st += 100) starts.push(st);
  const pages = [];
  while (starts.length) pages.push(...await Promise.all(starts.splice(0, 4).map(page)));
  return [first, ...pages].flatMap((j) => j.data);
}

/*
 * List-page camera sites: location, roadway, latLng as WKT "POINT (lon lat)",
 * state, images[] (imageUrl "/map/Cctv/<id>", description "Traffic closest to
 * this camera is traveling eastbound on I-20.", videoUrl, isVideoAuthRequired).
 * Direction is often "Unknown", so a view's button label comes from that
 * description. Video only where the site plays it without a login (CTroads
 * requires one; 511PA and FL511 refuse it even where not flagged: noVideo). cfg.state keeps one state of a multi-state
 * site (New England 511 = Vermont, New Hampshire, Maine).
 */
function parseList511(list, cfg) {
  const features = [];
  for (const site of list) {
    if (!site || site.visible === false || (cfg.state && site.state !== cfg.state)) continue;
    if (/\(test\)/i.test(site.location || '')) continue;
    const m = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec((site.latLng && site.latLng.geography && site.latLng.geography.wellKnownText) || '');
    const lon = m ? +m[1] : NaN, lat = m ? +m[2] : NaN;
    if (!located(lat, lon)) continue;
    const vs = (site.images || []).filter((im) => im && im.imageUrl && !im.disabled && !im.blocked).map((im, i) => {
      const dir = /traveling (north|south|east|west)bound/i.exec(im.description || '');
      const live = !cfg.noVideo && im.videoUrl && !im.videoDisabled && !im.isVideoAuthRequired && https(im.videoUrl);
      return { t: String(im.description || '').trim(), l: dir ? dir[1][0].toUpperCase() + 'B' : String(i + 1),
        u: new URL(im.imageUrl, cfg.host).href, ...(live ? { h: im.videoUrl } : {}) };
    });
    if (!vs.length) continue;
    numberRepeats(vs);
    features.push(point(lon, lat, {
      v: site.id,
      n: String(site.location || '').trim(),
      r: site.roadway || '',
      d: site.direction && site.direction.trim() !== 'Unknown' ? site.direction.trim() : '',
      ...(vs.length > 1 ? { vs } : { u: vs[0].u, s: vs[0].t, ...(vs[0].h ? { h: vs[0].h } : {}) }),
    }));
  }
  return features;
}

/*
 * iDriveArkansas cameras.geojson: id, status ("online"), name ("I-30 @ Red
 * River"), route_type_abbr + route, direction_name, hls_stream_protected
 * (cookie-gated, unused). Snapshot = layers.idrivearkansas.com/cameras/<id>.jpg
 * (what their own image API redirects to; a PNG, 720x405, 60 s cache).
 * `w` = where to watch the live video.
 */
function parseArdot(list) {
  const features = [];
  for (const f of list) {
    const p = (f && f.properties) || {};
    const c = (f && f.geometry && f.geometry.coordinates) || [];
    const lon = +c[0], lat = +c[1];
    if (p.status !== 'online' || p.id == null || !located(lat, lon)) continue;
    const road = p.route ? `${p.route_type_abbr === 'Interstate' ? 'I-' : p.route_type_abbr === 'US' ? 'US ' : 'Hwy '}${p.route}` : '';
    features.push(point(lon, lat, {
      v: p.id,
      n: String(p.name || '').trim(),
      r: road,
      d: p.direction_name || '',
      u: `https://layers.idrivearkansas.com/cameras/${encodeURIComponent(p.id)}.jpg`,
      w: 'https://www.idrivearkansas.com/',
    }));
  }
  return features;
}

/*
 * DriveTexas / MapLarge. The table name rolls to a new version every couple of
 * minutes (with fresh stream tokens); queries must name the ACTIVE version,
 * because CloudFront caches a query URL for days and an unversioned query soon
 * hands back expired tokens. GetActiveTableID itself is cached only 30 s.
 */
const TX_HOST = 'https://dtx-e-cdn.maplarge.com';
let txTable = null;   // { at, table }
async function txActiveTable() {
  if (txTable && Date.now() - txTable.at < 30 * 1000) return txTable.table;
  const r = await fetch(`${TX_HOST}/Remote/GetActiveTableID?shortTableId=appgeo/cameraPoint&cacheBust=${Math.round(Date.now() / 1000)}`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`DriveTexas returned HTTP ${r.status}`);
  const j = await r.json();
  if (!j || !j.success || !j.table) throw new Error('DriveTexas returned an unexpected response.');
  txTable = { at: Date.now(), table: j.table };
  return j.table;
}
async function txQuery(sqlselect, where, take) {
  const table = await txActiveTable();
  const request = JSON.stringify({ action: 'table/query', query: { sqlselect, start: 0, table, take, where } });
  const r = await fetch(`${TX_HOST}/Api/ProcessDirect?request=${encodeURIComponent(request)}`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`DriveTexas returned HTTP ${r.status}`);
  const j = await r.json();
  if (!j || !j.success || !j.data || !j.data.data) throw new Error('DriveTexas returned an unexpected response.');
  // MapLarge answers column-wise: { name: [...], XY: [...] } → rows.
  const cols = j.data.data, keys = Object.keys(cols);
  const n = keys.length ? Math.min(...keys.map((k) => cols[k].length)) : 0;
  return Array.from({ length: n }, (_, i) => Object.fromEntries(keys.map((k) => [k, cols[k][i]])));
}
function loadTxList() { return txQuery(['name', 'description', 'XY'], [], 20000); }

// Rows: name ("TX_DAL_500"), description ("IH20 @ CR118 MM 41 Pecos CTY (EB)"), XY (WKT).
function parseTx(list) {
  const features = [];
  for (const row of list) {
    const m = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(row.XY || '');
    const lon = m ? +m[1] : NaN, lat = m ? +m[2] : NaN;
    if (!row.name || /test/i.test(row.name) || !located(lat, lon)) continue;
    features.push(point(lon, lat, { v: row.name, n: String(row.description || row.name).trim(), r: '', d: '', x: 1 }));
  }
  return features;
}

// One camera's stream, with a token minted at the current table version.
async function txViews(name) {
  const rows = await txQuery(['name', 'description', 'httpsurl'], [{ col: 'name', test: 'Equal', value: name }], 1);
  const row = rows[0];
  if (!row || !/^https:\/\//.test(row.httpsurl || '')) return [];
  return [{ t: String(row.description || name).trim(), l: '1', h: row.httpsurl }];
}

/*
 * Castle Rock CARS camera API (<agency>tg.carsprogram.org/cameras_v1/api/cameras),
 * the feed behind 511 sites in NY, MN, IA, KS, NE, MA, IN and CO. ("sdtg" is
 * San Diego, not South Dakota: it lists Caltrans District 11 cameras.) Public,
 * CORS-open. Each camera has views of type STILL_IMAGE (url = a JPEG), WMP
 * (url = HLS, videoPreviewUrl = its still) or MJPEG (url = a stream an <img>
 * can show). Only https media is kept: some feeds list http images from
 * neighbouring states, which an https page cannot load.
 */
const https = (u) => typeof u === 'string' && u.startsWith('https://');
const dirLabel = (text, i) => {
  const m = /\b(north|south|east|west)(bound)?\b/i.exec(text || '');
  return m ? m[1][0].toUpperCase() + (m[2] ? 'B' : '') : String(i + 1);
};
function parseCars(list) {
  const features = [];
  for (const cam of list) {
    if (!cam || cam.public === false) continue;
    const L = cam.location || {};
    const lat = +L.latitude, lon = +L.longitude;
    if (!located(lat, lon)) continue;
    const vs = [];
    for (const v of cam.views || []) {
      if (!v) continue;
      const u = v.type === 'STILL_IMAGE' ? v.url : v.videoPreviewUrl || (v.type === 'MJPEG' ? v.url : null);
      const h = v.type === 'WMP' && /\.m3u8(\?|$)/.test(v.url || '') ? v.url : null;
      if (!https(u) && !https(h)) continue;
      vs.push({ t: String(v.name || cam.name || '').trim(), l: dirLabel(v.name, vs.length), ...(https(u) ? { u } : {}), ...(https(h) ? { h } : {}) });
    }
    if (!vs.length) continue;
    numberRepeats(vs);
    features.push(point(lon, lat, {
      v: cam.id,
      n: String(cam.name || '').trim(),
      r: L.routeId || '',
      d: '',
      ...(L.cityReference ? { s: L.cityReference } : {}),
      ...(vs.length > 1 ? { vs } : { ...(vs[0].u ? { u: vs[0].u } : {}), ...(vs[0].h ? { h: vs[0].h } : {}) }),
    }));
  }
  return features;
}
// Function declarations, not arrows: REGIONS calls these before this point.
function cars(agency, name) {
  return { name, api: `https://${agency}.carsprogram.org/cameras_v1/api/cameras`, keyless: true, parse: parseCars };
}
function list511(host, name, extra) {
  return { name, api: `https://${host}/List/GetData/Cameras`, host: `https://${host}`, keyless: true,
    load: loadListPages, parse: parseList511, ttl: 30 * 60 * 1000, ...extra };
}

/*
 * Caltrans CWWP2: one public JSON per district (d1..d12), CORS-open. Each
 * record's cctv has inService, location (locationName, nearbyPlace, route,
 * direction, lat/lon — its `county` is unreliable) and imageData with a
 * still (static.currentImageURL) and, for many, an HLS streamingVideoURL.
 */
async function loadCaltrans(cfg) {
  const lists = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const d = i + 1;
    try {
      const r = await fetch(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${String(d).padStart(2, '0')}.json`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ((await r.json()).data || []).map((x) => x && x.cctv);
    } catch (e) {
      console.warn(`[511] ${cfg.name} district ${d} unavailable:`, e.message);
      return [];
    }
  }));
  const all = lists.flat().filter(Boolean);
  if (!all.length) throw new Error(`${cfg.name} returned no cameras.`);
  return all;
}
function parseCaltrans(list) {
  const features = [];
  for (const c of list) {
    if (String(c.inService) !== 'true') continue;
    const L = c.location || {}, img = c.imageData || {};
    const lat = +L.latitude, lon = +L.longitude;
    const u = img.static && img.static.currentImageURL, h = img.streamingVideoURL;
    if (!located(lat, lon) || (!https(u) && !https(h))) continue;
    features.push(point(lon, lat, {
      v: `${L.district}-${c.index}`,
      n: String(L.locationName || '').trim(),
      r: L.route || '',
      d: L.direction || '',
      ...(L.nearbyPlace ? { s: L.nearbyPlace } : {}),
      ...(https(u) ? { u } : {}), ...(https(h) ? { h } : {}),
    }));
  }
  return features;
}

/*
 * Iteris ATIS camera SITES (SD511): Point features whose properties carry
 * name, route, mrm and cameras[] ({ name "Camera Looking South", description,
 * image }). Unlike 511SC's file (parseIteris), one feature holds several views.
 */
function parseIterisSites(list) {
  const features = [];
  for (const f of list) {
    const p = (f && f.properties) || {};
    const c = (f && f.geometry && f.geometry.coordinates) || [];
    if (!located(+c[1], +c[0])) continue;
    const vs = (p.cameras || []).filter((k) => k && https(k.image))
      .map((k, i) => ({ t: String(k.description || k.name || '').trim(), l: dirLabel(k.name, i) === String(i + 1) && /surface/i.test(k.name || '') ? 'Road' : dirLabel(k.name, i), u: k.image }));
    if (!vs.length) continue;
    numberRepeats(vs);
    features.push(point(+c[0], +c[1], {
      v: p.id != null ? p.id : `${c[0]},${c[1]}`,
      n: String(p.name || p.description || '').trim(),
      r: p.route || '',
      d: p.mrm != null && p.mrm !== '' ? `Mile ${p.mrm}` : '',
      ...(vs.length > 1 ? { vs } : { u: vs[0].u, s: vs[0].t }),
    }));
  }
  return features;
}

/*
 * ArcGIS FeatureServer layers capped at maxRecordCount rows per query: page
 * with resultOffset until a short page (IDOT's layer is 3,700+ at 1,000 a page).
 */
async function loadArcgisPages(cfg) {
  const rows = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const r = await fetch(`${cfg.api}/query?where=1%3D1&outFields=*&outSR=4326&resultOffset=${offset}&resultRecordCount=1000&f=geojson`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`${cfg.name} returned HTTP ${r.status}`);
    const j = await r.json();
    if (!j || !Array.isArray(j.features)) throw new Error(`${cfg.name} returned an unexpected response.`);
    rows.push(...j.features);
    if (j.features.length < 1000) break;
  }
  return rows;
}

// IDOT "Illinois Gateway Traffic Cameras": CameraLocation, CameraDirection, SnapShot, TooOld ("true" = stale image).
function parseIdot(list) {
  const features = [];
  for (const f of list) {
    const p = (f && f.properties) || {};
    const c = (f && f.geometry && f.geometry.coordinates) || [];
    if (!https(p.SnapShot) || p.TooOld === 'true' || !located(+c[1], +c[0])) continue;
    features.push(point(+c[0], +c[1], {
      v: p.OBJECTID, n: String(p.CameraLocation || '').trim(), r: '',
      d: p.CameraDirection && p.CameraDirection !== 'NONE' ? p.CameraDirection : '', u: p.SnapShot,
    }));
  }
  return features;
}

// NDDOT travelfiles cameras.json: sites with Region and Cameras[] ({ Description, FullPath, Direction }).
function parseNddot(list) {
  const features = [];
  for (const f of list) {
    const p = (f && f.properties) || {};
    const c = (f && f.geometry && f.geometry.coordinates) || [];
    if (!located(+c[1], +c[0])) continue;
    const vs = (p.Cameras || []).filter((k) => k && https(k.FullPath)).map((k, i) => ({
      t: String(k.Description || '').trim(), l: k.Direction ? (/pavement/i.test(k.Description || '') ? 'Road' : k.Direction.length <= 3 ? k.Direction.toUpperCase() : k.Direction[0].toUpperCase()) : String(i + 1), u: k.FullPath,
    }));
    if (!vs.length) continue;
    numberRepeats(vs);
    // "Ray - West (US 2 MP 51.3) - NDDOT" → site "Ray", road "US 2 MP 51.3".
    const m = /^(.*?)\s*-\s*[^(]*\(([^)]*)\)/.exec(vs[0].t);
    features.push(point(+c[0], +c[1], {
      v: p.ObjectID != null ? p.ObjectID : f.id, n: m ? m[1] : vs[0].t, r: m ? m[2] : '', d: '',
      ...(p.Region ? { s: p.Region } : {}),
      ...(vs.length > 1 ? { vs } : { u: vs[0].u }),
    }));
  }
  return features;
}

// 511MT (Iteris): MDT's own cameras are on its weather stations (rwis), plus a few others (cameras).
async function loadMt511(cfg) {
  const files = ['icons.rwis.geojson', 'icons.cameras.geojson'];
  const lists = await Promise.all(files.map(async (file) => {
    const r = await fetch(`https://mt.cdn.iteris-atis.com/geojson/icons/metadata/${file}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${cfg.name} returned HTTP ${r.status}`);
    return (await r.json()).features || [];
  }));
  return lists.flat();
}

/*
 * OHGO Public API (publicapi.ohgo.com, ODOT). Needs a free key from
 * publicapi.ohgo.com in OHGO_API_KEY. Camera sites: Id, Latitude, Longitude,
 * Location, Description, CameraViews[] ({ Direction, SmallUrl, LargeUrl,
 * MainRoute }). Field case is taken loosely (docs show PascalCase, the live
 * error body is camelCase). Untested until a key is set.
 */
async function loadOhgo(cfg) {
  const key = keyFor('oh');
  const rows = [];
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`https://publicapi.ohgo.com/api/v1/cameras?page-all=true&page=${page}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json', Authorization: `APIKEY ${key}` }, signal: AbortSignal.timeout(30000) });
    if (r.status === 401 || r.status === 403) throw new Error(`${cfg.name} rejected the API key (${cfg.keyEnv}).`);
    if (!r.ok) throw new Error(`${cfg.name} returned HTTP ${r.status}`);
    const j = await r.json();
    const results = j.results || j.Results || [];
    rows.push(...results);
    const pages = +(j.totalPageCount || j.TotalPageCount || 1);
    if (!results.length || page >= pages) break;
  }
  return rows;
}
function parseOhgo(list) {
  const g = (o, k) => (o ? (o[k] !== undefined ? o[k] : o[k[0].toLowerCase() + k.slice(1)]) : undefined);
  const features = [];
  for (const c of list) {
    const lat = +g(c, 'Latitude'), lon = +g(c, 'Longitude');
    if (!located(lat, lon)) continue;
    const vs = (g(c, 'CameraViews') || []).map((v, i) => ({ t: String(g(v, 'MainRoute') || '').trim(), l: dirLabel(g(v, 'Direction'), i), u: g(v, 'LargeUrl') || g(v, 'SmallUrl') }))
      .filter((v) => https(v.u));
    if (!vs.length) continue;
    numberRepeats(vs);
    features.push(point(lon, lat, {
      v: g(c, 'Id'), n: String(g(c, 'Location') || g(c, 'Description') || '').trim(), r: vs[0].t, d: '',
      ...(vs.length > 1 ? { vs } : { u: vs[0].u }),
    }));
  }
  return features;
}

// DelDOT: { videoCameras: [{ id, title, county, lat, lon, enabled, status, urls.m3u8s }] }. Video only.
function parseDeldot(list) {
  const features = [];
  for (const c of list) {
    const h = c && c.urls && c.urls.m3u8s;
    if (!c || !c.enabled || c.status !== 'Active' || !https(h) || !located(+c.lat, +c.lon)) continue;
    features.push(point(+c.lon, +c.lat, { v: c.id, n: String(c.title || c.id).trim(), r: '', d: '', h, ...(c.county ? { c: c.county } : {}) }));
  }
  return features;
}

// MoDOT Traveler: [{ location, x (lon), y (lat), html (HLS) }]. Video only.
function parseModot(list) {
  const features = [];
  for (const c of list) {
    if (!c || !https(c.html) || !located(+c.y, +c.x)) continue;
    const id = (/\/rtplive\/([^/]+)\//.exec(c.html) || [])[1] || c.location;
    features.push(point(+c.x, +c.y, { v: id, n: String(c.location || '').trim(), r: '', d: '', h: c.html }));
  }
  return features;
}

// ODOT TripCheck (ESRI JSON): attributes cameraId, filename, latitude, longitude, route, title.
function parseTripcheck(list) {
  const features = [];
  for (const f of list) {
    const a = (f && f.attributes) || {};
    if (!a.filename || !located(+a.latitude, +a.longitude)) continue;
    features.push(point(+a.longitude, +a.latitude, {
      v: a.cameraId, n: String(a.title || '').trim(), r: String(a.route || '').trim(), d: '',
      u: `https://tripcheck.com/RoadCams/cams/${encodeURIComponent(a.filename)}`,
    }));
  }
  return features;
}

// MDOT SHA CHART: { data: [{ id, cctvIp, commMode, opStatus, name, description, lat, lon }] }. HLS as CHART's own player builds it.
function parseChart(list) {
  const features = [];
  for (const c of list) {
    if (!c || c.commMode !== 'ONLINE' || !/^[a-z0-9.-]+$/i.test(c.cctvIp || '') || !/^[a-f0-9]+$/i.test(c.id || '')) continue;
    if (!located(+c.lat, +c.lon)) continue;
    features.push(point(+c.lon, +c.lat, {
      v: c.id, n: String(c.description || c.name || '').trim(), r: '', d: '',
      h: `https://${c.cctvIp}/rtplive/${c.id}/playlist.m3u8`,
      ...(c.cameraCategories && c.cameraCategories[0] ? { s: c.cameraCategories[0] } : {}),
    }));
  }
  return features;
}

// MiDrive camera list: HTML fragments — lat/lon/id inside the county "Go to" link, the still in the image's src.
function parseMidrive(list) {
  const features = [];
  for (const c of list) {
    const link = /lat=(-?[\d.]+)&lon=(-?[\d.]+)[^"]*?&id=(\d+)/.exec((c && c.county) || '');
    const src = /src="(https:\/\/[^"]+)"/.exec((c && c.image) || '');
    if (!link || !src || !located(+link[1], +link[2])) continue;
    const county = String(c.county).replace(/<[^>]*>.*$/s, '').trim();
    features.push(point(+link[2], +link[1], {
      v: +link[3],
      n: `${String(c.route || '').trim()}${String(c.location || '').trim() ? ' ' + String(c.location).trim() : ''}`.trim(),
      r: '', d: '', u: src[1].replace(/&amp;/g, '&'),
      ...(county ? { s: county } : {}),
    }));
  }
  return features;
}

// WSDOT (the feed its mobile app reads): { cameras: { items: [{ id, url, title, roadName, direction, milepost, lat, lon }] } }.
function parseWsdot(list) {
  const features = [];
  for (const c of list) {
    if (!c || !https(c.url) || !located(+c.lat, +c.lon)) continue;
    features.push(point(+c.lon, +c.lat, {
      v: c.id, n: String(c.title || '').trim(), r: c.roadName || '',
      // WSDOT direction is N/S/E/W or B (both ways), which says nothing on its own.
      d: [c.direction && c.direction !== 'B' ? c.direction : '', c.milepost ? `Mile ${c.milepost}` : ''].filter(Boolean).join(' · '), u: c.url,
    }));
  }
  return features;
}

/*
 * WV511 serves its cameras as a script (`var camera_data = {count, cams}`);
 * every camera streams from roadsummary.com under its md5 id — what WV511's
 * own player (flowplayeri.aspx) loads. Description holds "[BER]I-81 @ 0.5".
 */
async function loadWv511(cfg) {
  const r = await fetch(cfg.api, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${cfg.name} returned HTTP ${r.status}`);
  const s = await r.text();
  const at = s.indexOf('var camera_data');
  const open = at < 0 ? -1 : s.indexOf('{', at);
  if (open < 0) throw new Error(`${cfg.name} returned an unexpected response.`);
  let depth = 0, end = open, inStr = false;
  for (; end < s.length; end++) {
    const ch = s[end];
    if (inStr) { if (ch === '\\') end++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) break;
  }
  const cams = JSON.parse(s.slice(open, end + 1)).cams || [];
  // Most WV511 streams are switched off at any time (89 of 133 answered 204 on
  // 2026-10-18), and the feed lists them all. Keep only those whose playlist
  // answers now; if none do (roadsummary unreachable), keep the list as is.
  const live = new Set();
  const queue = cams.filter((c) => c && /^[A-Za-z0-9_-]+$/.test(c.md5 || ''));
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let c; (c = queue.shift());) {
      try {
        const r = await fetch(`https://vtc1.roadsummary.com/rtplive/${c.md5}/playlist.m3u8`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
        if (r.status === 200 && /#EXT-X-STREAM-INF|#EXTINF/.test(await r.text())) live.add(c.md5);
      } catch { /* offline or slow: leave it out */ }
    }
  }));
  return live.size ? cams.filter((c) => live.has(c.md5)) : cams;
}
function parseWv511(list) {
  const features = [];
  for (const c of list) {
    if (!c || !/^[A-Za-z0-9_-]+$/.test(c.md5 || '') || !located(+c.start_lat, +c.start_lng)) continue;
    const text = String(c.description || '').replace(/<span[\s\S]*?<\/span>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').trim();
    const m = /^\[([A-Z]+)\]\s*(.*)$/.exec(text);
    features.push(point(+c.start_lng, +c.start_lat, {
      v: c.md5, n: (m ? m[2] : text) || c.title || c.md5, r: c.title || '', d: '',
      h: `https://vtc1.roadsummary.com/rtplive/${c.md5}/playlist.m3u8`,
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

/*
 * A region's parsed list, indexed by camera id. Parsed once per cached body,
 * so the national layer and the camera lookups share the work.
 */
const parsed = {};      // region -> { body, features, byId }
function indexed(region, body) {
  const hit = parsed[region];
  if (hit && hit.body === body) return hit;
  const features = JSON.parse(body).features || [];
  const byId = new Map();
  for (const f of features) {
    const k = String(f.properties.v);
    const list = byId.get(k);
    if (list) list.push(f); else byId.set(k, [f]);
  }
  return (parsed[region] = { body, features, byId });
}

async function cameras(region) {
  const hit = cache[region];
  if (hit && Date.now() - hit.at < (REGIONS[region].ttl || TTL_MS)) return hit.body;
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

/*
 * NATIONAL: every usable region's cameras as one layer, about 50,000 points.
 * Each point carries only its region (`g`) and camera id (`v`); the popup
 * fetches the rest from /api/511cams/:region/cam/:id when a camera is opened.
 * Shipping every name, snapshot and stream URL for 50,000 cameras up front is
 * what made switching traffic cams on slow.
 *
 * Built from the per-region caches, gzipped once, and served stale while a
 * rebuild runs, so turning the layer on never waits on 45 DOT sites. A region
 * that fails is left out of that build rather than failing the whole layer.
 */
const national = { at: 0, body: null, gz: null };
let nationalInflight = null;

// Regions fetched at once while building: all 45 together (several paging
// through dozens of requests) exhausts connections and most fail.
const NATIONAL_CONCURRENCY = 6;

async function buildNational() {
  const queue = Object.keys(REGIONS).filter(usable);
  const features = [];
  await Promise.all(Array.from({ length: NATIONAL_CONCURRENCY }, async () => {
    for (let g; (g = queue.shift());) {
      try {
        for (const f of indexed(g, await cameras(g)).features) {
          features.push({ type: 'Feature', geometry: f.geometry, properties: { g, v: f.properties.v } });
        }
      } catch (e) {
        console.warn(`[511] ${g} left out of the national layer:`, e.message);
      }
    }
  }));
  if (!features.length) throw new Error('No traffic cameras are available right now.');
  const body = JSON.stringify({ type: 'FeatureCollection', fetchedAt: new Date().toISOString(), features });
  return { at: Date.now(), body, gz: zlib.gzipSync(body) };
}

function nationalCams() {
  const fresh = national.body && Date.now() - national.at < TTL_MS;
  if (!fresh && !nationalInflight) {
    nationalInflight = buildNational()
      .then((n) => Object.assign(national, n))
      .finally(() => { nationalInflight = null; });
    // With a list to serve meanwhile, a failed rebuild only gets logged.
    if (national.body) nationalInflight.catch((e) => console.warn('[511] national rebuild failed, serving cached list:', e.message));
  }
  return national.body ? Promise.resolve(national) : nationalInflight;
}

function attachGa511({ app, requireAuth }) {
  // Which regions have a key on this server — the menu hides the rest rather
  // than offering a switch that can only show "not set up".
  app.get('/api/511cams', requireAuth, (req, res) => {
    res.json(Object.fromEntries(Object.keys(REGIONS).map((r) => [r, usable(r)])));
  });

  // Regions whose cameras are looked up only when someone opens one (`x`).
  app.get('/api/511cams/:region/views/:id', requireAuth, async (req, res) => {
    const region = String(req.params.region || '').toLowerCase();
    const v = REGIONS[region] && REGIONS[region].views;
    if (!v) return res.status(404).json({ error: 'Unknown 511 region.' });
    const id = v.id(String(req.params.id || ''));
    if (id == null) return res.status(400).json({ error: 'Bad camera id.' });
    try {
      const views = await v.get(id);
      res.setHeader('Cache-Control', v.maxAge ? `private, max-age=${v.maxAge}` : 'no-store');
      res.json({ views });
    } catch (e) {
      console.warn(`[511] ${region} camera ${id} views unavailable:`, e.message);
      res.status(502).json({ error: e.message });
    }
  });

  // Before /:region, which would otherwise take "national" as a region name.
  app.get('/api/511cams/national', requireAuth, async (req, res) => {
    try {
      const n = await nationalCams();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Vary', 'Accept-Encoding');
      if (/gzip/i.test(req.headers['accept-encoding'] || '')) {
        res.setHeader('Content-Encoding', 'gzip');
        res.send(n.gz);
      } else {
        res.send(n.body);
      }
    } catch (e) {
      console.warn('[511] national cameras unavailable:', e.message);
      res.status(502).json({ error: e.message });
    }
  });

  // One camera's full properties. Ids are unique within almost every feed; where
  // two share one, ?ll=lon,lat (the clicked point) picks the right camera.
  app.get('/api/511cams/:region/cam/:id', requireAuth, async (req, res) => {
    const region = String(req.params.region || '').toLowerCase();
    if (!REGIONS[region] || !usable(region)) return res.status(404).json({ error: 'Unknown 511 region.' });
    try {
      const matches = indexed(region, await cameras(region)).byId.get(String(req.params.id)) || [];
      const [lon, lat] = String(req.query.ll || '').split(',').map(Number);
      const dist = (f) => (Number.isFinite(lon) && Number.isFinite(lat)
        ? (f.geometry.coordinates[0] - lon) ** 2 + (f.geometry.coordinates[1] - lat) ** 2 : 0);
      const f = matches.slice().sort((a, b) => dist(a) - dist(b))[0];
      if (!f) return res.status(404).json({ error: 'This camera is no longer listed.' });
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.json({ properties: f.properties });
    } catch (e) {
      console.warn(`[511] ${region} camera lookup failed:`, e.message);
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
  // Build the national layer once the server has settled, so the first person
  // to switch it on is not the one who waits for every DOT site.
  setTimeout(() => nationalCams().catch((e) => console.warn('[511] national warm-up failed:', e.message)), 20000).unref();
}

module.exports = { attachGa511 };
