/*
 * components/hurricane_tracks.js
 * NHC tropical cyclone forecast tracks from the PlaceFileNation placefiles
 * (fetched through the app's server proxy, since placefilenation.com is
 * allowlisted). Renders the forecast track lines plus category-colored markers
 * for each forecast point and the latest reported position, each with a popup.
 *
 * Two independent basins share this module:
 *   atlantic -> https://placefilenation.com/Placefiles/nhc.php
 *   epac     -> https://placefilenation.com/Placefiles/epnhc.php
 *
 * Placefile shape:
 *   Icon: lat, lon, 0, <cat>, 1, "hover", ""      forecast points
 *   Color:0 0 0 / Line:2,0,"" / c1 / c2 / End:     track segments
 *   Object: lat, lon / Text.../ Icon:0,0,000,<cat>,1,"hover" / End:   latest pos
 * where <cat> is 1=TD 2=TS 3=Cat1 4=Cat2 5=Cat3 6=Cat4 7=Cat5.
 */

const BASINS = {
  atlantic: { url: 'https://placefilenation.com/Placefiles/nhc.php', label: 'Atlantic' },
  epac:     { url: 'https://placefilenation.com/Placefiles/epnhc.php', label: 'E Pacific' },
};

const REFRESH_MS = 15 * 60 * 1000; // 15 minutes (NHC advisories update ~6h)

/*
 * Where the placefiles are read from.
 *
 * The app goes through /api/proxy, which takes a URL and needs a session.
 * The 24/7 broadcast page has no session — it sits above the auth gate on
 * purpose — and it would be wrong to make a URL-taking proxy public just to
 * serve it, so that page points this at its own basin-only endpoint instead.
 */
let _endpoint = (basin) => `/api/proxy?url=${BASINS[basin].url}`;
function endpointFor(basin) { return _endpoint(basin); }
export function setTrackEndpoint(fn) { if (typeof fn === 'function') _endpoint = fn; }

// Storm category (placefile icon number) -> color + short label.
const CATEGORY = {
  1: { color: '#5ba3cf', label: 'TD' },
  2: { color: '#34c759', label: 'TS' },
  3: { color: '#ffd60a', label: 'Cat 1' },
  4: { color: '#ff9f0a', label: 'Cat 2' },
  5: { color: '#ff6b35', label: 'Cat 3' },
  6: { color: 'var(--vx-live)', label: 'Cat 4' },
  7: { color: '#d838ff', label: 'Cat 5' },
};
function cat(n) { return CATEGORY[n] || { color: '#c7d0dc', label: '' }; }

// Per-basin state so the two toggles are fully independent.
const _state = {}; // basin -> { active, timer, wrapper, markers[], lineMaps:Set }

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/*
 * One system, pulled out of the summary NHC writes for it.
 *
 * Everything is optional: a depression has no name worth the word, a
 * post-tropical remnant may not be moving anywhere in particular, and a
 * field that is missing has to read as missing rather than as zero. Nothing
 * here is calculated or inferred — it is what the advisory says, or nothing.
 */
function parseSummary(headline, summary, lat, lon, catNum) {
  const text = String(summary || '').replace(/\\n/g, '\n');
  const grab = (re, n) => { const m = text.match(re); return m ? m[n || 1] : null; };
  const num = (v) => (v == null ? null : Number(v));

  // "Tropical Storm Isaias - 45 MPH" -> the part before the dash.
  const title = String(headline || '').split(' - ')[0].trim();
  // The last word is the name; everything before it is what it is.
  const bits = title.split(/\s+/);
  const name = bits.length > 1 ? bits[bits.length - 1] : title;
  const kind = bits.length > 1 ? bits.slice(0, -1).join(' ') : '';

  return {
    name,
    kind,
    title,
    cat: catNum,
    lat, lon,
    windMph: num(grab(/MAXIMUM SUSTAINED WINDS\.{3}(\d+)\s*MPH/i)),
    pressureMb: num(grab(/MINIMUM CENTRAL PRESSURE\.{3}(\d+)\s*MB/i)),
    moveDir: grab(/PRESENT MOVEMENT\.{3}([A-Z]{1,3})\s+OR\b/i),
    moveDeg: num(grab(/PRESENT MOVEMENT\.{3}[A-Z]{1,3}\s+OR\s+(\d+)\s*DEGREES/i)),
    moveMph: num(grab(/DEGREES AT\s+(\d+)\s*MPH/i)),
    // "ABOUT 260 MI...420 KM WNW OF PROGRESO MEXICO" — the line that tells a
    // viewer where this is without reading a latitude.
    near: (grab(/ABOUT\s+(.+?)(?:\n|$)/) || '').replace(/\.{3}/g, ' / ').trim() || null,
    advisoryUtc: grab(/\.{3}(\d{4})\s*UTC/),
  };
}

// Parse into { points:[{lat,lon,cat,raw}], segments:[...], storms:[...] }.
function parsePlacefile(text) {
  const points = [];
  const segments = [];
  const storms = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Forecast point: Icon with a real lat/lon (not the 0,0 Object children).
    const icon = line.match(/^\s*Icon:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*\d+\s*,\s*(\d+)\s*,\s*\d+\s*,\s*"([\s\S]*?)"\s*,/i);
    if (icon) {
      const lat = +icon[1], lon = +icon[2];
      if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
        points.push({ lat, lon, cat: +icon[3], raw: icon[4] });
      }
      continue;
    }

    // Object block: latest reported position -> descriptive Icon(0,0,..).
    const obj = line.match(/^\s*Object:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (obj) {
      const lat = +obj[1], lon = +obj[2];
      let raw = '', catNum = 0, headline = '';
      for (let j = i + 1; j < lines.length && !/^\s*End:/i.test(lines[j]); j++) {
        /*
         * Two lines inside the block matter. The second Text is the headline
         * ("Tropical Storm Isaias - 45 MPH") — the first is always the words
         * "Latest Reported Position" and says nothing about this storm.
         */
        const tx = lines[j].match(/^\s*Text:\s*[^,]+,\s*-?\d+\s*,\s*\d+\s*,\s*"([^"]*)"/i);
        if (tx && !/latest reported position/i.test(tx[1])) { headline = tx[1]; continue; }
        const ci = lines[j].match(/^\s*Icon:\s*0\s*,\s*0\s*,\s*\d+\s*,\s*(\d+)\s*,\s*\d+\s*,\s*"([\s\S]*?)"/i);
        if (ci) { catNum = +ci[1]; raw = ci[2]; }
      }
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        points.push({ lat, lon, cat: catNum, raw, latest: true });
        if (headline || raw) storms.push(parseSummary(headline, raw, lat, lon, catNum));
      }
      continue;
    }

    // Track segment: `Line:` header followed by two coordinate rows.
    if (/^\s*Line:/i.test(line)) {
      const coords = [];
      for (let j = i + 1; j < lines.length && !/^\s*End:/i.test(lines[j]); j++) {
        const c = lines[j].match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (c) coords.push([+c[2], +c[1]]); // [lon, lat]
      }
      if (coords.length >= 2) segments.push(coords);
    }
  }
  return { points, segments, storms };
}

function targetMaps(basin) {
  const w = _state[basin]?.wrapper || window.vortexMap || {};
  const out = [];
  if (w.map) out.push(w.map);
  const split = typeof w.isSplit === 'function' ? w.isSplit() : false;
  if (split && w.dualMap) out.push(w.dualMap);
  return out;
}

function lineIds(basin) { return { src: `hurr-track-src-${basin}`, layer: `hurr-track-line-${basin}` }; }

function removeLines(basin) {
  const st = _state[basin];
  if (!st) return;
  const { src, layer } = lineIds(basin);
  for (const map of st.lineMaps) {
    try {
      if (map.getLayer(layer)) map.removeLayer(layer);
      if (map.getSource(src)) map.removeSource(src);
    } catch (e) {}
  }
  st.lineMaps.clear();
}

function addLines(basin, segments) {
  const st = _state[basin];
  const { src, layer } = lineIds(basin);
  const data = {
    type: 'FeatureCollection',
    features: segments.map((coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} })),
  };
  for (const map of targetMaps(basin)) {
    try {
      if (map.getLayer(layer)) map.removeLayer(layer);
      if (map.getSource(src)) map.removeSource(src);
      map.addSource(src, { type: 'geojson', data });
      map.addLayer({
        id: layer,
        type: 'line',
        source: src,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 2,
          'line-opacity': 0.85,
          'line-dasharray': [2, 1.5],
        },
      });
      st.lineMaps.add(map);
    } catch (e) { console.warn('[Hurricanes] addLines failed', e); }
  }
}

function clearMarkers(basin) {
  const st = _state[basin];
  if (!st) return;
  st.markers.forEach((m) => { try { m.remove(); } catch (e) {} });
  st.markers = [];
}

function popupHtml(p) {
  const c = cat(p.cat);
  const detail = String(p.raw || '').split('\\n').map((s) => s.trim())
    .filter((s) => s && !/^-+$/.test(s));
  // First line is usually the name/summary header; keep it emphasized.
  const head = detail.length ? detail[0] : (c.label || 'Tropical cyclone');
  const rest = detail.slice(1).map((d) => `<div class="hurr-pop-line">${escapeHtml(d)}</div>`).join('');
  const badge = c.label ? `<span class="hurr-pop-badge" style="background:${c.color}">${escapeHtml(c.label)}</span>` : '';
  return `<div class="hurr-pop">${badge}<div class="hurr-pop-head">${escapeHtml(head)}</div>${rest}</div>`;
}

function render(basin, parsed) {
  clearMarkers(basin);
  removeLines(basin);
  const gl = window.maplibregl || window.mapboxgl;
  if (!gl) return;
  const st = _state[basin];

  addLines(basin, parsed.segments);

  for (const p of parsed.points) {
    const c = cat(p.cat);
    const html = popupHtml(p);
    for (const map of targetMaps(basin)) {
      const el = document.createElement('div');
      el.className = p.latest ? 'hurr-marker hurr-marker-latest' : 'hurr-marker';
      el.style.background = c.color;
      el.title = c.label || 'Forecast point';
      // A popup is for somebody with a mouse. A broadcast has neither a
      // pointer nor anyone to close one, and an accidental click would leave
      // a panel sitting over the storm until the page reloaded.
      if (!st.noPopups) {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          new gl.Popup({ closeButton: true, closeOnClick: true, className: 'hurr-popup', maxWidth: '300px' })
            .setLngLat([p.lon, p.lat])
            .setHTML(html)
            .addTo(map);
        });
      }
      const marker = new gl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map);
      st.markers.push(marker);
    }
  }
}

async function load(basin) {
  const st = _state[basin];
  if (!st || !st.active) return;
  try {
    const res = await fetch(endpointFor(basin), { cache: 'no-store' });
    if (!res.ok || !st.active) return;
    const text = await res.text();
    if (!st.active) return;
    // placefilenation occasionally returns an HTML 404 page with a 200 status;
    // ignore it so a transient hiccup doesn't clear the existing tracks.
    if (/^\s*</.test(text)) return;
    const parsed = parsePlacefile(text);
    // Kept so a page can show the storms as well as draw them. The broadcast
    // builds its card from this rather than parsing the file a second time.
    st.storms = parsed.storms;
    st.at = Date.now();
    render(basin, parsed);
    if (typeof st.onUpdate === 'function') {
      try { st.onUpdate(parsed.storms); } catch (e) { /* a reader must not stop the drawing */ }
    }
  } catch (err) {
    console.error(`[Hurricanes:${basin}] load failed:`, err);
  }
}

export function addHurricaneTracks(basin, mapWrapper, opts = {}) {
  if (!BASINS[basin]) return;
  const st = _state[basin] || (_state[basin] = { markers: [], lineMaps: new Set() });
  st.wrapper = mapWrapper || window.vortexMap;
  st.onUpdate = opts.onUpdate || null;
  // Markers carry popups, which are for a person with a mouse. A broadcast
  // has neither, and they draw on top of the storm.
  st.noPopups = !!opts.noPopups;
  st.active = true;
  load(basin);
  clearInterval(st.timer);
  st.timer = setInterval(() => { if (st.active) load(basin); }, REFRESH_MS);
}

/** The systems from the last fetch: name, strength, movement, position. */
export function getStorms(basin) {
  const st = _state[basin];
  return st && st.storms ? st.storms.slice() : [];
}

export function removeHurricaneTracks(basin) {
  const st = _state[basin];
  if (!st) return;
  st.active = false;
  clearInterval(st.timer);
  st.timer = null;
  clearMarkers(basin);
  removeLines(basin);
}

// Repaint onto/off the dual pane when split screen toggles.
window.addEventListener('vortexsplitchange', () => {
  for (const basin of Object.keys(_state)) {
    if (_state[basin].active) load(basin);
  }
});
