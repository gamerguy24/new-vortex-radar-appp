/*
 * backend/fire/index.js
 * Live wildfire data from NIFC (the interagency WFIGS feeds).
 *
 * WHAT THIS ADDS THAT THE APP DID NOT ALREADY HAVE
 * components/fire_weather.js already draws fire danger, the SPC fire weather
 * outlooks, and InciWeb fire POINTS — all from placefilenation placefiles.
 * What none of those carry is the FOOTPRINT: how much has actually burned. That
 * is what these two feeds are for.
 *
 *   /api/fire/perimeters   burned-area polygons  (WFIGS Interagency Perimeters)
 *   /api/fire/incidents    incident points with acres, containment and cause
 *
 * WHY IT IS PROXIED RATHER THAN FETCHED IN THE BROWSER
 * The perimeter polygons are large — a couple of active fires is already tens of
 * kilobytes of detailed geometry — and every client would otherwise pull the
 * whole national set from ArcGIS independently. One shared, cached fetch here
 * costs NIFC a request every few minutes no matter how many people are looking,
 * and lets the payload be trimmed to the fields the map actually draws.
 */

const WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services';
const UA = 'VortexRadar (davidwallis17@twistcasterlivemedia.com)';

// Fires move on the scale of hours, not seconds. NIFC updates these feeds
// roughly every few minutes; polling harder buys nothing and is rude.
const TTL_MS = 5 * 60 * 1000;

const cache = new Map();          // key -> { at, data }
const inflight = new Map();       // key -> promise

async function cached(key, build) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    try {
      const data = await build();
      cache.set(key, { at: Date.now(), data });
      return data;
    } catch (e) {
      // Serve stale rather than nothing: a fire map that empties out because one
      // upstream poll failed is worse than one a few minutes behind, as long as
      // the age is reported (see `fetchedAt` in the payload).
      if (hit) return hit.data;
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

async function arcgis(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`NIFC returned HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'NIFC query failed');
  return j;
}

/** Burned-area polygons for fires currently being managed. */
async function perimeters() {
  /*
   * SIMPLIFY THE GEOMETRY UPSTREAM. Measured against the live feed, the same
   * 215 perimeters come back as:
   *
   *   full detail                    39.5 MB
   *   maxAllowableOffset 0.001, 5dp   1.2 MB
   *
   * A 34x reduction for roughly 100 m of tolerance, on shapes that are drawn a
   * few pixels wide over a radar map. Sending 39 MB of polygon detail to a
   * chaser on cellular to render an outline is not a trade worth making.
   * geometryPrecision caps the decimal places, which is most of the rest.
   */
  const url = `${WFIGS}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query`
    + '?where=1%3D1'
    + '&outFields=poly_IncidentName,poly_GISAcres,attr_PercentContained,attr_FireCause,attr_IncidentTypeCategory,poly_DateCurrent'
    + '&maxAllowableOffset=0.001&geometryPrecision=5'
    + '&outSR=4326&f=geojson';

  const j = await arcgis(url);
  const feats = (j.features || [])
    .filter((f) => f.geometry)
    .map((f) => {
      const p = f.properties || {};
      return {
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          name: p.poly_IncidentName || 'Unnamed fire',
          acres: Number.isFinite(p.poly_GISAcres) ? Math.round(p.poly_GISAcres) : null,
          contained: p.attr_PercentContained == null ? null : Math.round(p.attr_PercentContained),
          cause: p.attr_FireCause || null,
          updated: p.poly_DateCurrent || null,
        },
      };
    });

  return {
    fetchedAt: new Date().toISOString(),
    source: 'NIFC WFIGS Interagency Perimeters (current)',
    count: feats.length,
    geojson: { type: 'FeatureCollection', features: feats },
  };
}

/**
 * Incident points. Richer than the InciWeb placefile the app already draws —
 * these carry acreage, containment percentage and cause, which is what an
 * operator actually wants next to a fire symbol.
 */
async function incidents() {
  const url = `${WFIGS}/WFIGS_Incident_Locations_Current/FeatureServer/0/query`
    + '?where=1%3D1'
    + '&outFields=IncidentName,DiscoveryAcres,FinalAcres,PercentContained,FireCause,'
    + 'FireDiscoveryDateTime,IncidentTypeCategory,POOState,IncidentComplexityLevel'
    + '&outSR=4326&f=geojson';

  const j = await arcgis(url);
  const feats = (j.features || [])
    .filter((f) => f.geometry && f.geometry.type === 'Point')
    .map((f) => {
      const p = f.properties || {};
      // FinalAcres is only set once a fire is out; DiscoveryAcres is what it was
      // when first reported. Prefer the larger — it is the better description of
      // the fire as it stands.
      const acres = [p.FinalAcres, p.DiscoveryAcres]
        .filter((n) => Number.isFinite(n))
        .reduce((a, b) => Math.max(a, b), 0);
      return {
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          name: p.IncidentName || 'Unnamed incident',
          acres: acres || null,
          contained: p.PercentContained == null ? null : Math.round(p.PercentContained),
          cause: p.FireCause || null,
          state: p.POOState ? String(p.POOState).replace(/^US-/, '') : null,
          complexity: p.IncidentComplexityLevel || null,
          // ArcGIS hands these back as epoch milliseconds, not ISO strings.
          discovered: Number.isFinite(p.FireDiscoveryDateTime)
            ? new Date(p.FireDiscoveryDateTime).toISOString() : null,
          kind: p.IncidentTypeCategory || null,
        },
      };
    })
    // Prescribed burns share this feed with wildfires. Keep only actual
    // wildfires (WF); a controlled burn drawn as an active fire is alarming and
    // wrong.
    .filter((f) => !f.properties.kind || /^WF/i.test(f.properties.kind));

  return {
    fetchedAt: new Date().toISOString(),
    source: 'NIFC WFIGS Incident Locations (current)',
    count: feats.length,
    geojson: { type: 'FeatureCollection', features: feats },
  };
}

function attachFire({ app, requireAuth }) {
  app.get('/api/fire/perimeters', requireAuth, async (req, res) => {
    try {
      const data = await cached('perimeters', perimeters);
      res.setHeader('Cache-Control', 'no-store');
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'Fire perimeters unavailable: ' + (e.message || e) });
    }
  });

  app.get('/api/fire/incidents', requireAuth, async (req, res) => {
    try {
      const data = await cached('incidents', incidents);
      res.setHeader('Cache-Control', 'no-store');
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'Fire incidents unavailable: ' + (e.message || e) });
    }
  });

  console.log('[FIRE] attached: /api/fire/perimeters, /api/fire/incidents');
}

module.exports = { attachFire, perimeters, incidents };
