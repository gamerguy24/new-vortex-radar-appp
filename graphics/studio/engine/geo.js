// Geographic data layer. Loads bundled US TopoJSON once, decodes to GeoJSON,
// and builds fast lookups by FIPS code, name, and state. Uses the globally
// loaded `topojson` (topojson-client UMD) and `d3` (d3.geoCentroid etc.).

let cache = null;

// 2-digit state FIPS -> USPS abbreviation.
export const STATE_FIPS_ABBR = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};
export const ABBR_STATE_FIPS = Object.fromEntries(
  Object.entries(STATE_FIPS_ABBR).map(([k, v]) => [v, k]),
);

// USPS abbreviation -> full state name (for headers / pickers).
export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

export async function loadGeo() {
  if (cache) return cache;
  const [statesTopo, countiesTopo, nationTopo] = await Promise.all([
    loadJson('geo/states-10m.json'),
    loadJson('geo/counties-10m.json'),
    loadJson('geo/nation-10m.json'),
  ]);

  const states = topojson.feature(statesTopo, statesTopo.objects.states).features;
  const counties = topojson.feature(countiesTopo, countiesTopo.objects.counties).features;
  const nation = topojson.feature(nationTopo, nationTopo.objects.nation).features[0];
  // Mesh of state borders for clean internal lines.
  const stateBorders = topojson.mesh(statesTopo, statesTopo.objects.states, (a, b) => a !== b);
  // Mesh of county borders — interior shared edges only (a !== b), so every
  // border is a single clean line (no double-stroking) and the ragged coastline
  // is left to the state/nation outlines. Used for crisp county lines on the map.
  const countyBorders = topojson.mesh(countiesTopo, countiesTopo.objects.counties, (a, b) => a !== b);

  const countyByFips = new Map();
  const countiesByState = new Map();
  for (const f of counties) {
    const fips = String(f.id).padStart(5, '0');
    f.stateFips = fips.slice(0, 2);
    f.fips = fips;
    f.stateAbbr = STATE_FIPS_ABBR[f.stateFips] || '';
    countyByFips.set(fips, f);
    if (!countiesByState.has(f.stateFips)) countiesByState.set(f.stateFips, []);
    countiesByState.get(f.stateFips).push(f);
  }

  const stateByFips = new Map();
  const stateByAbbr = new Map();
  for (const f of states) {
    const fips = String(f.id).padStart(2, '0');
    f.fips = fips;
    f.abbr = STATE_FIPS_ABBR[fips] || '';
    stateByFips.set(fips, f);
    if (f.abbr) stateByAbbr.set(f.abbr, f);
  }

  cache = {
    states, counties, nation, stateBorders, countyBorders,
    countyByFips, countiesByState, stateByFips, stateByAbbr,
  };
  return cache;
}

// Collect county features for a list of state abbreviations.
export function countiesForStates(geo, abbrs) {
  const out = [];
  for (const abbr of abbrs) {
    const fips = ABBR_STATE_FIPS[abbr];
    if (fips && geo.countiesByState.has(fips)) out.push(...geo.countiesByState.get(fips));
  }
  return out;
}

// Resolve a county by "Name, ST" or by FIPS. Returns feature or null.
export function resolveCounty(geo, query) {
  if (/^\d{5}$/.test(query)) return geo.countyByFips.get(query) || null;
  const m = /^(.+?),\s*([A-Z]{2})$/.exec(query.trim());
  if (!m) return null;
  const [, name, abbr] = m;
  const fips = ABBR_STATE_FIPS[abbr];
  if (!fips) return null;
  const list = geo.countiesByState.get(fips) || [];
  return list.find((f) => f.properties.name.toLowerCase() === name.toLowerCase()) || null;
}

// Named region presets: lists of state abbreviations.
export const REGION_PRESETS = {
  conus: { label: 'Continental US', states: null }, // null => albersUsa nation
  'ne-indiana': { label: 'NE Indiana / NW Ohio', states: ['IN', 'OH'] },
  california: { label: 'California / Oregon', states: ['CA', 'OR', 'NV'] },
  oklahoma: { label: 'Oklahoma', states: ['OK'] },
  'southern-plains': { label: 'Southern Plains', states: ['OK', 'KS', 'TX', 'MO', 'AR'] },
  southeast: { label: 'Southeast', states: ['GA', 'AL', 'FL', 'SC', 'TN', 'NC'] },
  midwest: { label: 'Midwest', states: ['IL', 'IN', 'OH', 'MI', 'WI', 'IA', 'MO', 'KY'] },
  northeast: { label: 'Northeast', states: ['NY', 'PA', 'NJ', 'CT', 'MA', 'VT', 'NH', 'ME', 'RI', 'MD'] },
};
