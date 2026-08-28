/*
 * backend/eoc/index.js
 * Server side of VORTEX EOC MODE — the emergency-operations dashboard at /eoc.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT
 * The EOC screen is an aggregator. Most of what it shows already has an
 * endpoint of its own — damage reports, spotters, power outages, storm tracks,
 * cameras, PTT — and it calls those directly rather than being proxied through
 * here. This module only adds what did not exist:
 *
 *   /api/eoc/overview    active NWS warnings, summarised, with POPULATION
 *                        AFFECTED resolved from county FIPS
 *   /api/eoc/facilities  hospitals, schools, shelters and other critical
 *                        infrastructure in a bounding box, from OpenStreetMap
 *
 * POPULATION IS COUNTED BY FIPS, NOT BY POLYGON.
 * Every active alert carries properties.geocode.SAME — a list of six-digit SAME
 * codes, which are county FIPS with a leading zero. Measured against the live
 * feed: 310 of 310 active alerts had SAME codes, while only 33 had polygon
 * geometry. Intersecting polygons would therefore have silently missed roughly
 * nine alerts in ten. County granularity is coarser than a storm-based polygon,
 * but it is the number that exists for every warning, and it is exact rather
 * than estimated.
 */

const fs = require('fs');
const path = require('path');

const UA = 'VortexRadar EOC (davidwallis17@twistcasterlivemedia.com)';

/* ── county population ──────────────────────────────────────────────────────
 * Generated from the Census Bureau's keyless bulk estimates file
 * (co-est2024-alldata.csv, POPESTIMATE2024). See data/county_population.json.
 *
 * 3,133 of the 3,231 counties in the app's own TopoJSON resolve; the rest are
 * Puerto Rico municipios, which that Census file does not carry. Those are
 * reported as UNKNOWN rather than zero — a hurricane warning over PR showing
 * "0 people affected" would be worse than showing "population unavailable",
 * because zero reads as a real, reassuring answer.
 */
let POP = null;
function population() {
  if (POP) return POP;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'county_population.json'), 'utf8'));
    POP = { pop: raw.population || {}, names: raw.names || {}, source: raw.source, generated: raw.generated };
  } catch (e) {
    console.warn('[EOC] county population table unavailable:', e.message);
    POP = { pop: {}, names: {}, source: null, generated: null };
  }
  return POP;
}

/** SAME code (6 digits, leading zero) -> county FIPS (5 digits). */
function sameToFips(same) {
  const s = String(same || '').replace(/[^0-9]/g, '');
  if (s.length === 6) return s.slice(1);
  if (s.length === 5) return s;
  return null;
}

/*
 * Is this code a land county, or an NWS marine zone?
 *
 * Marine warnings carry SAME codes that LOOK like county FIPS but are not:
 * observed live, prefixes 57, 58, 59 and 65 came back from Gale Warnings and
 * Small Craft Advisories, and none of those is a state. Without this check the
 * dashboard reported "103 counties without population data" when 102 of them
 * were stretches of open water — which reads as a broken population table
 * rather than as the ocean having no residents.
 *
 * A county is land iff its two-digit prefix is a real state or territory.
 */
const LAND_STATE_PREFIXES = new Set([
  '01', '02', '04', '05', '06', '08', '09', '10', '11', '12', '13', '15', '16',
  '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42',
  '44', '45', '46', '47', '48', '49', '50', '51', '53', '54', '55', '56',
  // Territories, which NWS does issue land warnings for.
  '60', '66', '69', '72', '78',
]);
function isLandCounty(fips) {
  return typeof fips === 'string' && LAND_STATE_PREFIXES.has(fips.slice(0, 2));
}

/* ── active alerts ───────────────────────────────────────────────────────── */

// One shared fetch for every EOC client. The national feed is a few megabytes
// and updates on the order of a minute; polling it per browser would be rude to
// weather.gov and pointless.
const ALERTS_TTL_MS = 45 * 1000;
let alertsCache = { at: 0, features: null, error: null };
let alertsInflight = null;

async function activeAlerts() {
  const fresh = Date.now() - alertsCache.at < ALERTS_TTL_MS;
  if (fresh && alertsCache.features) return alertsCache.features;
  if (alertsInflight) return alertsInflight;

  alertsInflight = (async () => {
    try {
      const r = await fetch('https://api.weather.gov/alerts/active', {
        headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
      });
      if (!r.ok) throw new Error(`weather.gov returned HTTP ${r.status}`);
      const j = await r.json();
      const features = Array.isArray(j.features) ? j.features : [];
      alertsCache = { at: Date.now(), features, error: null };
      return features;
    } catch (e) {
      // Serve the last good copy if we have one: an EOC screen going blank
      // because one poll failed is worse than a slightly stale list, as long as
      // the staleness is reported (see `stale` in the payload).
      alertsCache.error = e.message;
      if (alertsCache.features) return alertsCache.features;
      throw e;
    } finally {
      alertsInflight = null;
    }
  })();
  return alertsInflight;
}

// Which events an operations centre treats as actionable, in priority order.
// Anything not listed still appears; this only decides what sorts to the top.
const PRIORITY = [
  'Tornado Warning', 'Flash Flood Emergency', 'Severe Thunderstorm Warning',
  'Flash Flood Warning', 'Hurricane Warning', 'Storm Surge Warning',
  'Ice Storm Warning', 'Blizzard Warning', 'Winter Storm Warning',
  'High Wind Warning', 'Fire Weather Warning', 'Extreme Heat Warning',
];
const SEVERITY_RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

function rankOf(p) {
  const byEvent = PRIORITY.indexOf(p.event);
  return [
    byEvent < 0 ? PRIORITY.length : byEvent,
    SEVERITY_RANK[p.severity] == null ? 9 : SEVERITY_RANK[p.severity],
    new Date(p.expires || 0).getTime() || Infinity,
  ];
}

/**
 * Trim an alert to what a dashboard row needs. The full feed carries long
 * description and instruction text for 300+ alerts; sending all of it would
 * make the payload tens of megabytes for information no row displays.
 */
function slimAlert(f, popTable) {
  const p = f.properties || {};
  const fipsList = (p.geocode && Array.isArray(p.geocode.SAME) ? p.geocode.SAME : [])
    .map(sameToFips)
    .filter(Boolean);

  let known = 0;
  let unknown = 0;
  let marine = 0;
  for (const fips of fipsList) {
    if (!isLandCounty(fips)) { marine++; continue; }
    if (popTable.pop[fips] != null) known += popTable.pop[fips];
    else unknown++;
  }

  return {
    id: p.id,
    event: p.event,
    severity: p.severity,
    urgency: p.urgency,
    certainty: p.certainty,
    headline: p.headline || null,
    areaDesc: p.areaDesc,
    sender: p.senderName,
    onset: p.onset || p.effective || p.sent,
    expires: p.expires || p.ends,
    counties: fipsList,
    // Per-alert population. Counties overlap between alerts, so these do NOT
    // sum to the total below — the total is de-duplicated separately.
    population: known,
    countiesWithoutPopulation: unknown,
    marineZones: marine,
    hasPolygon: !!f.geometry,
    // Tornado warnings carry tags an EOC cares about: whether it is radar
    // indicated or confirmed, and whether the damage threat is CONSIDERABLE or
    // CATASTROPHIC (which is what drives Wireless Emergency Alerts).
    tornadoDetection: (p.parameters && p.parameters.tornadoDetection || [])[0] || null,
    damageThreat: (p.parameters && p.parameters.tornadoDamageThreat || [])[0]
      || (p.parameters && p.parameters.thunderstormDamageThreat || [])[0] || null,
  };
}

/**
 * Build the dashboard payload.
 * @param {object} o  { state, events } optional filters
 */
async function buildOverview(o = {}) {
  const popTable = population();
  const features = await activeAlerts();

  const stateFilter = o.state ? String(o.state).toUpperCase().slice(0, 2) : null;
  let list = features.map((f) => slimAlert(f, popTable));

  if (stateFilter) {
    // UGC/SAME are county codes; the state is the first two FIPS digits. Match
    // on that rather than on areaDesc text, which is free-form.
    const wantedPrefixes = STATE_FIPS[stateFilter];
    if (wantedPrefixes) list = list.filter((a) => a.counties.some((c) => c.startsWith(wantedPrefixes)));
  }

  list.sort((a, b) => {
    const ra = rankOf(a), rb = rankOf(b);
    return (ra[0] - rb[0]) || (ra[1] - rb[1]) || (ra[2] - rb[2]);
  });

  // De-duplicated population: a county under three warnings is one county.
  const affectedCounties = new Set();
  const unknownCounties = new Set();
  const marineZones = new Set();
  for (const a of list) {
    for (const fips of a.counties) {
      if (!isLandCounty(fips)) { marineZones.add(fips); continue; }
      if (popTable.pop[fips] != null) affectedCounties.add(fips);
      else unknownCounties.add(fips);
    }
  }
  let totalPopulation = 0;
  for (const fips of affectedCounties) totalPopulation += popTable.pop[fips];

  const byEvent = {};
  const bySeverity = {};
  for (const a of list) {
    byEvent[a.event] = (byEvent[a.event] || 0) + 1;
    bySeverity[a.severity || 'Unknown'] = (bySeverity[a.severity || 'Unknown'] || 0) + 1;
  }

  return {
    generated: new Date().toISOString(),
    // True when weather.gov failed and this is the last good copy.
    stale: !!alertsCache.error,
    staleReason: alertsCache.error || null,
    fetchedAt: new Date(alertsCache.at).toISOString(),
    counts: {
      total: list.length,
      bySeverity,
      byEvent,
    },
    populationAffected: {
      total: totalPopulation,
      counties: affectedCounties.size,
      // Land counties genuinely missing from the population table (Puerto Rico
      // municipios). Reported so the total is never mistaken for complete.
      countiesWithoutData: unknownCounties.size,
      // Open water under a marine warning. Not a gap — there is nobody to count.
      marineZones: marineZones.size,
      source: popTable.source,
      asOf: popTable.generated,
    },
    warnings: list,
  };
}

// First two FIPS digits per state, for the state filter.
const STATE_FIPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
  DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
  KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
  MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35',
  NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
  SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
  WV: '54', WI: '55', WY: '56', PR: '72',
};

/* ── critical facilities (OpenStreetMap) ─────────────────────────────────────
 * Hospitals, schools, shelters, fire and police stations and power substations
 * come from Overpass. There is no free nationwide government feed for these —
 * HIFLD's hosted layers move and rate-limit — and OSM is the one source that is
 * keyless, worldwide and queryable by bounding box.
 *
 * Treat it as reference, not gospel: OSM completeness varies by area, and a
 * facility missing from the map is missing from this panel. The UI says so.
 */
const OVERPASS = 'https://overpass-api.de/api/interpreter';

const FACILITY_KINDS = {
  hospital: 'node["amenity"="hospital"](BBOX);way["amenity"="hospital"](BBOX);',
  school: 'node["amenity"~"^(school|college|university)$"](BBOX);way["amenity"~"^(school|college|university)$"](BBOX);',
  shelter: 'node["emergency"="shelter"](BBOX);way["emergency"="shelter"](BBOX);node["amenity"="social_facility"]["social_facility"="shelter"](BBOX);',
  fire: 'node["amenity"="fire_station"](BBOX);way["amenity"="fire_station"](BBOX);',
  police: 'node["amenity"="police"](BBOX);way["amenity"="police"](BBOX);',
  power: 'node["power"="substation"](BBOX);way["power"="substation"](BBOX);',
  eoc: 'node["office"="government"]["government"="emergency"](BBOX);way["office"="government"]["government"="emergency"](BBOX);',
};

// Overpass is a shared free service. Cache generously and keep the box small.
const FACILITY_TTL_MS = 30 * 60 * 1000;
const facilityCache = new Map();   // key -> { at, data }
const MAX_FACILITY_CACHE = 40;

function bboxKey(b, kinds) {
  return kinds.join(',') + '|' + b.map((n) => n.toFixed(2)).join(',');
}

async function fetchFacilities(bbox, kinds) {
  const key = bboxKey(bbox, kinds);
  const hit = facilityCache.get(key);
  if (hit && Date.now() - hit.at < FACILITY_TTL_MS) return hit.data;

  // Overpass wants south,west,north,east.
  const bb = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
  const body = kinds.map((k) => FACILITY_KINDS[k].split('BBOX').join(bb)).join('');
  const query = `[out:json][timeout:25];(${body});out center tags;`;

  const r = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!r.ok) throw new Error(`OpenStreetMap returned HTTP ${r.status}`);
  const j = await r.json();

  const kindOf = (tags) => {
    if (!tags) return null;
    if (tags.amenity === 'hospital') return 'hospital';
    if (/^(school|college|university)$/.test(tags.amenity || '')) return 'school';
    if (tags.emergency === 'shelter' || tags.social_facility === 'shelter') return 'shelter';
    if (tags.amenity === 'fire_station') return 'fire';
    if (tags.amenity === 'police') return 'police';
    if (tags.power === 'substation') return 'power';
    if (tags.government === 'emergency') return 'eoc';
    return null;
  };

  const seen = new Set();
  const items = [];
  for (const el of (j.elements || [])) {
    const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
    const lon = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const kind = kindOf(el.tags);
    if (!kind) continue;
    const name = (el.tags && (el.tags.name || el.tags.operator)) || null;
    // The same facility is often mapped as both a node and a way.
    const dedupe = `${kind}|${name || ''}|${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    items.push({
      id: `${el.type}/${el.id}`,
      kind,
      name,
      lat,
      lon,
      beds: el.tags && el.tags.beds ? parseInt(el.tags.beds, 10) : null,
      emergency: el.tags && el.tags.emergency === 'yes' ? true : null,
      phone: (el.tags && (el.tags.phone || el.tags['contact:phone'])) || null,
    });
  }

  const data = { generated: new Date().toISOString(), source: 'OpenStreetMap contributors', count: items.length, facilities: items };
  facilityCache.set(key, { at: Date.now(), data });
  while (facilityCache.size > MAX_FACILITY_CACHE) facilityCache.delete(facilityCache.keys().next().value);
  return data;
}

/* ── routes ──────────────────────────────────────────────────────────────── */

function attachEoc({ app, requireAuth, requirePage }) {
  // The dashboard itself. Gated the same way the Graphics Studio is.
  if (requirePage) app.use('/eoc', requirePage);

  app.get('/api/eoc/overview', requireAuth, async (req, res) => {
    try {
      const data = await buildOverview({ state: req.query.state });
      res.setHeader('Cache-Control', 'no-store');
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'Warning feed unavailable: ' + (e.message || e) });
    }
  });

  app.get('/api/eoc/facilities', requireAuth, async (req, res) => {
    const bbox = String(req.query.bbox || '').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n)) || bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) {
      return res.status(400).json({ error: 'bbox=W,S,E,N is required' });
    }
    // A continent-sized query would time out on a shared public service and
    // return nothing useful anyway.
    const spanLon = bbox[2] - bbox[0];
    const spanLat = bbox[3] - bbox[1];
    if (spanLon > 8 || spanLat > 8) {
      return res.status(400).json({ error: 'Zoom in to load facilities — the area requested is too large.' });
    }

    const kinds = String(req.query.kinds || 'hospital,school,shelter')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => FACILITY_KINDS[k]);
    if (!kinds.length) return res.status(400).json({ error: 'no valid facility kinds requested' });

    try {
      const data = await fetchFacilities(bbox, kinds);
      res.setHeader('Cache-Control', 'no-store');
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'Facility data unavailable: ' + (e.message || e) });
    }
  });

  console.log('[EOC] attached: /eoc, /api/eoc/overview, /api/eoc/facilities');
}

module.exports = { attachEoc, buildOverview, sameToFips, fetchFacilities, isLandCounty };
