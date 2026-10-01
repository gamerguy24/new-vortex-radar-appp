/*
 * broadcast/site_markers.js
 * The app's radar site pills, on the broadcast map.
 *
 * Same look as the radar page: a rounded pill with the site id in it, blue for
 * a working WSR-88D, amber for a TDWR, red for one that has not posted Level 2
 * in 15 minutes. The shapes and colours are the app's own
 * (app/core/map/icons/icons.js), and the status comes from the same place the
 * app gets it (api.weather.gov/radar/stations), so a radar that is down looks
 * down on the stream too.
 *
 * WHY THE SVGs ARE COPIED HERE
 * The app's icons module starts by requiring app/core/map/map.js, which builds
 * the radar page's Mapbox map on import — it cannot be loaded by a page that
 * already has its own. These are four rectangles; the alternative was dragging
 * the whole radar page into the broadcast view to get them.
 *
 * Positions come from /broadcast/radar-sites.json, which the server builds from
 * the app's NEXRAD_LOCATIONS table. One list, so the stream cannot show a
 * different set of radars from the app.
 */

const SRC = 'radar-sites';
const LAYER = 'radar-sites-layer';

// From app/core/map/icons/icons.js — keep in step with it.
const PILL = {
  blue_station: '#009dff',
  orange_station: '#b0801a',
  red_station: '#ff4e4e',
};

const STATUS_URL = 'https://api.weather.gov/radar/stations';
const DOWN_AFTER_MS = 15 * 60 * 1000;     // the app's own threshold

function pillSvg(fill) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'
    + `<rect width="200" height="100" rx="20" fill="${fill}" /></svg>`;
}

function addPill(map, name, fill) {
  return new Promise((resolve) => {
    if (map.hasImage(name)) { resolve(); return; }
    const img = new Image();
    img.onload = () => { try { if (!map.hasImage(name)) map.addImage(name, img); } catch (e) {} resolve(); };
    img.onerror = () => resolve();        // a missing pill must not stop the map
    img.src = 'data:image/svg+xml,' + encodeURIComponent(pillSvg(fill));
  });
}

/**
 * Which radars are not currently producing Level 2.
 *
 * Failures are not fatal and not retried hard: every site simply shows as
 * working, which is what the app does before this request comes back.
 *
 * @returns {Promise<Object>} id -> 'up' | 'down'
 */
export async function fetchSiteStatus() {
  const out = {};
  try {
    const r = await fetch(STATUS_URL, { headers: { Accept: 'application/geo+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const now = Date.now();
    for (const f of j.features || []) {
      const p = f.properties || {};
      const id = p.id;
      const last = p.latency && p.latency.levelTwoLastReceivedTime;
      if (!id) continue;
      const t = last ? Date.parse(last) : NaN;
      out[id] = (Number.isFinite(t) && now - t < DOWN_AFTER_MS) ? 'up' : 'down';
    }
  } catch (e) {
    console.warn('[broadcast] radar status unavailable:', e.message);
  }
  return out;
}

function featuresFor(sites, status) {
  const feats = [];
  for (const id of Object.keys(sites || {})) {
    const s = sites[id];
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const down = status[id] === 'down';
    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        station_id: id,
        pill: down ? 'red_station' : (s.type === 'TDWR' ? 'orange_station' : 'blue_station'),
        // Down radars and the one on air sort above the rest, so a pill that
        // means something is not the one dropped when they collide.
        order: down ? 0 : 2,
      },
    });
  }
  return { type: 'FeatureCollection', features: feats };
}

/**
 * Put the site pills on the map. Safe to call once; use setSiteMarkerStatus()
 * afterwards to recolour them.
 */
export async function addSiteMarkers(map, sites, status = {}) {
  await Promise.all(Object.entries(PILL).map(([name, fill]) => addPill(map, name, fill)));
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: 'geojson', data: featuresFor(sites, status) });
  }
  if (map.getLayer(LAYER)) return;
  map.addLayer({
    id: LAYER,
    type: 'symbol',
    source: SRC,
    layout: {
      'symbol-sort-key': ['get', 'order'],
      'icon-image': ['get', 'pill'],
      /*
       * Sized for a 1920-wide stage read at a distance, and smaller when the
       * whole country is on screen — at continental zoom every NEXRAD in the
       * country draws a pill, and full size they cover the weather they are
       * there to annotate. These are the radar page's values nudged up, since
       * nobody can zoom this map in to read a small one.
       */
      'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.17, 6, 0.23, 9, 0.27],
      'text-field': ['get', 'station_id'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 6, 13, 9, 14.5],
      'text-font': ['Arial Unicode MS Bold'],
      /*
       * Always drawn, never dropped.
       *
       * With collision on, Mapbox weighs these against the basemap's own labels
       * — and zoomed into a storm, where the town names crowd together, it threw
       * the radar pills away. The stream then showed a single site in the whole
       * frame, including the site whose data was on air, which is the one label
       * a viewer most needs. They still suppress labels underneath them
       * (ignore-placement stays off), so a pill covers a town name rather than
       * printing through it.
       */
      'icon-allow-overlap': true,
      'text-allow-overlap': true,
      'icon-optional': false,
    },
    paint: { 'text-color': '#ffffff' },
  });
}

/** Recolour the pills from a fresh status fetch. */
export function setSiteMarkerStatus(map, sites, status) {
  const src = map.getSource(SRC);
  if (src) src.setData(featuresFor(sites, status));
}

/** Raise the pills above whatever radar was just (re)added. */
export function keepSiteMarkersOnTop(map) {
  try { if (map.getLayer(LAYER)) map.moveLayer(LAYER); } catch (e) { /* style reloading */ }
}

export function siteMarkersLayerId() { return LAYER; }
