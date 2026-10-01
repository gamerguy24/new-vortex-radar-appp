/*
 * broadcast/storm_director.js
 * Decides what the 24/7 stream is looking at, and what it says about it.
 *
 * WHY THIS IS A SEPARATE FILE
 * None of this touches the map or the DOM, so it runs in node and can be
 * tested against real NWS payloads without a browser. The thing most likely to
 * go wrong on an unattended stream is not the drawing — it is the judgement:
 * putting the wrong storm on air, flapping between two of them every poll, or
 * saying something about a tornado that the NWS did not say.
 *
 * EDITORIAL RULE, INHERITED FROM nws_bluesky.js
 * Never overstate. "Confirmed tornado" appears only when
 * properties.parameters.tornadoDetection says OBSERVED, and "tornado
 * emergency" only when the NWS headline says so. Everything else is
 * radar indicated, and is labelled that way.
 */

/* ── warning types we will break to ───────────────────────────────────────── */
export const WARN_TYPES = {
  'Tornado Warning': { key: 'tor', color: '#ff2f1f', tag: 'TOR', weight: 3.6, halo: 6.4 },
  'Severe Thunderstorm Warning': { key: 'svr', color: '#ffd000', tag: 'SVR', weight: 2.6, halo: 5.0 },
  'Flash Flood Warning': { key: 'ffw', color: '#19c45f', tag: 'FFW', weight: 2.6, halo: 5.0 },
  'Flood Warning': { key: 'ffw', color: '#2fa36b', tag: 'FLW', weight: 2.2, halo: 4.4 },
  // Watches are drawn thinner and dashed, and counted apart from warnings: a
  // watch means conditions are favourable, not that anything is happening.
  'Tornado Watch': { key: 'watch', color: '#ff8a7a', tag: 'TOR WATCH', weight: 2.0, halo: 3.6, watch: true },
  'Severe Thunderstorm Watch': { key: 'watch', color: '#ffe68a', tag: 'SVR WATCH', weight: 2.0, halo: 3.6, watch: true },
  'Flash Flood Watch': { key: 'watch', color: '#7ce8a8', tag: 'FF WATCH', weight: 2.0, halo: 3.6, watch: true },
  'Flood Watch': { key: 'watch', color: '#7ce8a8', tag: 'FLOOD WATCH', weight: 2.0, halo: 3.6, watch: true },
};

/*
 * What the stream will point a radar at.
 *
 * Flash floods were left out of this at first, on the grounds that flooding is
 * the rain that already fell and does not photograph like a supercell. That was
 * wrong in practice: on a night with nine flash flood warnings and no severe
 * ones the stream sat on a static national map, which tells a viewer less than
 * the rain that caused them would. Ranking still keeps a tornado ahead of a
 * flood; it no longer keeps a flood behind nothing at all.
 *
 * Watches are in for the same reason, far enough down that they are only ever
 * shown when nothing is warned.
 */
const BREAKABLE = new Set([
  'Tornado Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning', 'Flood Warning',
  'Tornado Watch', 'Severe Thunderstorm Watch', 'Flash Flood Watch', 'Flood Watch',
]);

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;
const upper = (v) => String(first(v) || '').toUpperCase();

/* ── storm specifications, straight from the warning ──────────────────────── */

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Compass point a bearing is pointing AT. */
export function compassOf(deg) {
  if (!Number.isFinite(deg)) return null;
  const d = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(d / 22.5) % 16];
}

/**
 * Storm motion out of parameters.eventMotionDescription, which looks like:
 *   "2026-10-01T18:03:00-00:00...storm...267DEG...39KT...4017 9512"
 *
 * THE DIRECTION IS WHERE THE STORM IS COMING FROM, not where it is going.
 * That is the NWS TIME...MOT...LOC convention, and getting it backwards would
 * put "moving west" on screen for a storm heading for the town east of it —
 * the single most dangerous thing this file could get wrong. The heading we
 * display is therefore fromDeg + 180, and tools/check_storm_motion.js checks
 * that against the plain-English "Movement was ..." line in live warnings.
 */
export function parseMotion(parameters) {
  const raw = first((parameters || {}).eventMotionDescription);
  if (!raw) return null;
  const m = String(raw).match(/(\d{1,3})\s*DEG\D{0,6}(\d{1,3})\s*KT/i);
  if (!m) return null;
  const fromDeg = parseInt(m[1], 10);
  const kt = parseInt(m[2], 10);
  if (!Number.isFinite(fromDeg) || !Number.isFinite(kt)) return null;
  const towardDeg = (fromDeg + 180) % 360;
  return {
    fromDeg,
    towardDeg,
    toward: compassOf(towardDeg),
    kt,
    mph: Math.round(kt * 1.15078),
  };
}

/** Hail size in inches, if the warning carries one. */
export function parseHail(parameters) {
  const v = parseFloat(first((parameters || {}).maxHailSize));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Peak wind gust in mph, if the warning carries one. */
export function parseWind(parameters) {
  const raw = first((parameters || {}).maxWindGust);
  if (!raw) return null;
  const m = String(raw).match(/(\d{2,3})\s*(MPH|KT)?/i);
  if (!m) return null;
  let v = parseInt(m[1], 10);
  if (/KT/i.test(m[2] || '')) v = Math.round(v * 1.15078);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** "Anderson, Oconee and Pickens" — the counties, trimmed to fit. */
export function countyLine(areaDesc, max = 4) {
  const parts = String(areaDesc || '').split(';').map((s) => s.trim()).filter(Boolean)
    .map((s) => s.replace(/,\s*[A-Z]{2}$/, ''));
  if (!parts.length) return '';
  const shown = parts.slice(0, max);
  const more = parts.length - shown.length;
  let s = shown.length > 1
    ? shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1]
    : shown[0];
  if (more > 0) s += ` +${more} more`;
  return s;
}

/** "NWS Greenville-Spartanburg SC" -> "Greenville-Spartanburg SC" */
export function officeOf(senderName) {
  return String(senderName || '').replace(/^NWS\s+/i, '').trim();
}

/**
 * Everything we are willing to say about one warning.
 *
 * Every field here comes from the warning itself. Nothing is inferred,
 * averaged or filled in from elsewhere — if the NWS did not say it, it is null
 * and the panel leaves the row out.
 */
export function stormSpecs(props) {
  const p = props || {};
  const params = p.parameters || {};
  const type = WARN_TYPES[p.event] || null;
  const detection = upper(params.tornadoDetection) || null;
  const tornadoThreat = upper(params.tornadoDamageThreat) || null;
  const stormThreat = upper(params.thunderstormDamageThreat) || null;
  const headline = String(first(params.NWSheadline) || '').toUpperCase();

  const isTornado = p.event === 'Tornado Warning';
  const isWatch = !!(type && type.watch);
  const isFlood = /Flood/.test(p.event || '');
  const floodDetection = upper(params.flashFloodDetection) || null;
  const floodThreat = upper(params.flashFloodDamageThreat) || null;
  const observed = (detection || '').includes('OBSERVED');
  // Only the NWS declares a tornado emergency, and it says so in the headline.
  const emergency = isTornado && headline.includes('TORNADO EMERGENCY');
  const pds = isTornado && !emergency
    && (headline.includes('PARTICULARLY DANGEROUS') || tornadoThreat === 'CONSIDERABLE');

  let threatLabel = null;
  if (isTornado) {
    if (emergency) threatLabel = 'TORNADO EMERGENCY';
    else if (tornadoThreat === 'CATASTROPHIC') threatLabel = 'CONFIRMED LARGE, DESTRUCTIVE TORNADO';
    else if (observed) threatLabel = 'CONFIRMED TORNADO';
    else threatLabel = 'RADAR INDICATED';
  } else if (isWatch) {
    threatLabel = null;                       // a watch says nothing has happened yet
  } else if (isFlood) {
    /*
     * A flash flood emergency is a real, declared thing — flashFloodDamageThreat
     * CATASTROPHIC is the tag the office sets for it, and the headline says so.
     * Anything short of that is reported as what it is and nothing more.
     */
    if (floodThreat === 'CATASTROPHIC' || headline.includes('FLASH FLOOD EMERGENCY')) {
      threatLabel = 'FLASH FLOOD EMERGENCY';
    } else if (floodThreat === 'CONSIDERABLE') threatLabel = 'CONSIDERABLE DAMAGE THREAT';
    else if (floodDetection) threatLabel = floodDetection;
  } else if (stormThreat === 'DESTRUCTIVE') threatLabel = 'DESTRUCTIVE DAMAGE THREAT';
  else if (stormThreat === 'CONSIDERABLE') threatLabel = 'CONSIDERABLE DAMAGE THREAT';

  const expires = Date.parse(p.expires || p.ends || '');

  return {
    id: p.id || null,
    event: p.event || 'Warning',
    tag: type ? type.tag : null,
    color: type ? type.color : '#ffffff',
    key: type ? type.key : null,
    isTornado,
    isWatch,
    isFlood,
    floodDetection,
    floodEmergency: threatLabel === 'FLASH FLOOD EMERGENCY',
    // Shown verbatim, so it has to be exactly what the office said.
    threatLabel,
    emergency,
    pds,
    observed,
    detection: detection || null,
    hailIn: parseHail(params),
    windMph: parseWind(params),
    motion: parseMotion(params),
    counties: countyLine(p.areaDesc),
    office: officeOf(p.senderName),
    expires: Number.isFinite(expires) ? expires : null,
    issued: Date.parse(p.sent || p.effective || '') || null,
  };
}

/* ── which storm goes on air ───────────────────────────────────────────────── */

/**
 * Urgency, as a number. Tiers are spaced so that "more urgent" is a real step
 * up and not a rounding difference: an escalation inside the current storm
 * (radar indicated -> confirmed) must outrank every other storm of its type,
 * and a tornado emergency must outrank everything.
 */
/*
 * Tiers, highest first:
 *   tornado warning        1000 (+ emergency / confirmed / PDS)
 *   flash flood emergency   900 — declared, life-threatening, and ongoing
 *   severe thunderstorm     500
 *   flash flood warning     400
 *   flood warning           300
 *   watches                 200-250
 * A watch therefore never displaces a warning, and nothing displaces a tornado.
 */
export function scoreWarning(specs) {
  if (!specs || !BREAKABLE.has(specs.event)) return 0;
  if (specs.isWatch) {
    return specs.event === 'Tornado Watch' ? 250
      : specs.event === 'Severe Thunderstorm Watch' ? 220 : 200;
  }
  if (specs.floodEmergency) return 900;
  if (specs.isFlood) {
    let fs = specs.event === 'Flash Flood Warning' ? 400 : 300;
    if (specs.threatLabel === 'CONSIDERABLE DAMAGE THREAT') fs += 60;
    if ((specs.floodDetection || '').includes('OBSERVED')) fs += 30;
    return fs;
  }
  let s = specs.isTornado ? 1000 : 500;
  if (specs.emergency) s += 400;
  if (specs.threatLabel === 'CONFIRMED LARGE, DESTRUCTIVE TORNADO') s += 300;
  else if (specs.observed) s += 200;
  if (specs.pds) s += 150;
  if (specs.threatLabel === 'DESTRUCTIVE DAMAGE THREAT') s += 120;
  else if (specs.threatLabel === 'CONSIDERABLE DAMAGE THREAT') s += 60;
  // Among equals, the bigger threat numbers. Small weights: these refine an
  // order, they never promote a severe storm above a tornado.
  if (specs.hailIn) s += Math.min(20, specs.hailIn * 8);
  if (specs.windMph) s += Math.min(20, (specs.windMph - 55) / 3);
  return Math.round(s);
}

/* ── geometry ──────────────────────────────────────────────────────────────── */

/** Every ring of a Polygon or MultiPolygon, flattened to coordinate pairs. */
function coordsOf(geometry) {
  if (!geometry) return [];
  const g = geometry;
  if (g.type === 'Polygon') return g.coordinates.flat(1);
  if (g.type === 'MultiPolygon') return g.coordinates.flat(2);
  return [];
}

/** [[w,s],[e,n]] of a warning polygon, or null. */
export function boundsOf(geometry) {
  const pts = coordsOf(geometry);
  if (!pts.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of pts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return Number.isFinite(w) && Number.isFinite(s) ? [[w, s], [e, n]] : null;
}

/** Centre of the polygon's extent — good enough to pick a radar and a camera. */
export function centroidOf(geometry) {
  const b = boundsOf(geometry);
  return b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] : null;
}

const R_EARTH_KM = 6371.0088;
export function kmBetween(lat1, lon1, lat2, lon2) {
  const R = Math.PI / 180;
  const dLat = (lat2 - lat1) * R;
  const dLon = (lon2 - lon1) * R;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Nearest WSR-88D to a point, as [{ id, lat, lon, name, km }], nearest first.
 *
 * Only WSR-88D: the TDWRs in the same list are Level 3 only, and asking the
 * Level 2 archive for one returns nothing at all.
 */
export function nearestSites(sites, lat, lon, limit = 4) {
  const out = [];
  for (const id of Object.keys(sites || {})) {
    const s = sites[id];
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    if (s.type && s.type !== 'WSR-88D') continue;
    out.push({ id, lat: s.lat, lon: s.lon, name: s.name || id, km: kmBetween(lat, lon, s.lat, s.lon) });
  }
  out.sort((a, b) => a.km - b.km);
  return out.slice(0, limit);
}

/* ── the director ──────────────────────────────────────────────────────────── */

/*
 * What a shot is worth, when it is not a warning.
 *
 * Both sit far below the lowest warning score (500), so no amount of pretty
 * weather ever outranks a severe thunderstorm. They are EQUAL to each other so
 * that the rotation treats them as peers: the country and the storms take
 * turns, which is what a weather channel does when nothing is warned.
 */
export const TOUR_SCORE = 100;
/*
 * The national mosaic is the FALLBACK, not a peer.
 *
 * It used to share the rotation with the storms, which meant a viewer tuning in
 * during weather had a good chance of finding a static 1 km national picture —
 * the exact thing single-site radar was added to replace. It now appears only
 * when there is nothing else at all to show.
 */
export const NATIONAL_SCORE = 50;

export const MIN_DWELL_MS = 90 * 1000;       // never cut away from a storm sooner
export const ROTATE_MS = 3 * 60 * 1000;      // share the air during an outbreak

/**
 * Turns a list of active warnings into a decision, poll after poll.
 *
 * The rules, in order:
 *   1. Nothing breakable active -> the national view.
 *   2. Something strictly MORE urgent than what is on air -> cut to it now.
 *      An escalation on the current storm counts, and is the reason the panel
 *      can change from "radar indicated" to "confirmed" without a camera move.
 *   3. The current storm's warning is gone (expired, cancelled) -> next one.
 *   4. Equally urgent storms and the current one has had its turn -> rotate,
 *      so a 40-warning outbreak is not one county for three hours.
 *   5. Otherwise stay put. Staying put is the common case, and a stream that
 *      jumps every minute is unwatchable.
 */
export class Director {
  constructor(opts = {}) {
    this.minDwell = opts.minDwell ?? MIN_DWELL_MS;
    this.rotate = opts.rotate ?? ROTATE_MS;
    this.mode = 'national';
    this.targetId = null;
    this.since = 0;
    this.shown = [];           // ids already given a turn, oldest first
  }

  /**
   * @param {Array} candidates [{ id, specs, score, geometry }]
   * @param {number} now
   * @returns {{mode, target, changed, reason}}
   */
  decide(candidates, now = Date.now()) {
    // A warning with no polygon cannot be framed, so it is not a candidate.
    // A missing kind is treated AS a warning: that is the default shape, and
    // letting an unlabelled candidate through without geometry would hand the
    // page a target it cannot point a camera at.
    const live = (candidates || []).filter((c) => c && c.score > 0
      && ((c.kind && c.kind !== 'warning') || c.geometry));
    if (!live.length) {
      const changed = this.mode !== 'national';
      if (changed) { this.mode = 'national'; this.targetId = null; this.since = now; }
      return { mode: 'national', target: null, changed, reason: 'nothing to show' };
    }

    const sorted = [...live].sort((a, b) => (b.score - a.score)
      || ((b.issued || 0) - (a.issued || 0)));
    const top = sorted[0];
    const current = live.find((c) => c.id === this.targetId) || null;

    const cut = (to, reason) => {
      const changed = to.id !== this.targetId;
      if (changed) {
        this.targetId = to.id;
        this.since = now;
        this.shown = this.shown.filter((id) => id !== to.id).concat(to.id).slice(-40);
      }
      const mode = to.kind === 'national' ? 'national' : to.kind === 'tour' ? 'tour' : 'storm';
      const modeChanged = this.mode !== mode;
      this.mode = mode;
      return { mode, target: to, changed: changed || modeChanged, reason };
    };

    if (!current) return cut(top, this.mode === 'national' ? 'something to show' : 'previous shot ended');
    if (top.score > current.score) return cut(top, 'something more urgent');

    const held = now - this.since;
    if (held >= Math.max(this.minDwell, this.rotate)) {
      // Everything within a hair of the top score deserves a turn; prefer the
      // one that has not been on air longest.
      const peers = sorted.filter((c) => c.score >= current.score - 1 && c.id !== current.id);
      if (peers.length) {
        peers.sort((a, b) => this.shown.indexOf(a.id) - this.shown.indexOf(b.id));
        return cut(peers[0], 'sharing the air');
      }
    }
    const mode = current.kind === 'national' ? 'national' : current.kind === 'tour' ? 'tour' : 'storm';
    return { mode, target: current, changed: false, reason: 'holding' };
  }
}

/** Build the director's input from raw NWS features. */
export function candidatesFrom(features) {
  const out = [];
  for (const f of features || []) {
    const p = (f && f.properties) || {};
    if (!WARN_TYPES[p.event]) continue;
    const specs = stormSpecs(p);
    out.push({
      kind: 'warning',
      id: p.id || `${p.event}:${p.areaDesc}:${p.sent}`,
      specs,
      score: scoreWarning(specs),
      issued: specs.issued,
      geometry: f.geometry || null,
      // Watches arrive with NO polygon — they are issued for lists of zones —
      // so the caller needs these to work out where one actually is.
      zones: Array.isArray(p.affectedZones) ? p.affectedZones : [],
    });
  }
  return out;
}

/**
 * The shots available when nothing is warned.
 *
 * One per patch of weather the mosaic found, on the nearest WSR-88D to it,
 * plus the national view itself — which is a shot like any other here, so the
 * rotation gives the country a turn between storms instead of never showing it
 * or never leaving it.
 *
 * @param {Array} hotspots [{ lat, lon, dbz }] from findMRMSHotspots()
 * @param {object} sites    the NEXRAD site table
 */
export function quietCandidates(hotspots, sites) {
  const out = [{ kind: 'national', id: 'national', score: NATIONAL_SCORE, issued: 0 }];
  const used = new Set();
  for (const h of hotspots || []) {
    if (!h || !Number.isFinite(h.lat) || !Number.isFinite(h.lon)) continue;
    const near = nearestSites(sites, h.lat, h.lon, 1)[0];
    // Beyond ~230 km the site cannot see it, so there is nothing to cut to.
    if (!near || near.km > 230) continue;
    if (used.has(near.id)) continue;      // one shot per radar, not per cell
    used.add(near.id);
    out.push({
      kind: 'tour',
      id: `tour:${near.id}`,
      score: TOUR_SCORE,
      issued: 0,
      site: near,
      centre: [h.lon, h.lat],
      dbz: Math.round(h.dbz),
    });
  }
  return out;
}
