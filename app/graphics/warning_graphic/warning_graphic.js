/*
 * warning_graphic.js
 * Weather Warning Graphic Generator.
 *
 * Builds a broadcast-quality PNG from the CURRENT state of the app — it reuses
 * the existing Mapbox map (radar, warning polygons, labels, roads, shields,
 * zoom/bearing/pitch/center) by reading its already-rendered canvas. No second
 * map, no new tiles, no re-fetch. The map has preserveDrawingBuffer:true, so
 * map.getCanvas() is directly captureable.
 *
 * On top of that captured view we composite a TV-style layout: a warning banner,
 * a translucent info + safety panel, a US locator with the affected state
 * highlighted, a radar legend + timestamp, and the app branding. The finished
 * layout is rasterized with html2canvas (already loaded globally) at high DPI and
 * saved / copied as PNG.
 */

const map = require('../../core/map/map');
const turf = require('@turf/turf');
const US_STATES = require('./us_states');
const { getCities } = require('../../tools/manual_storm_track/mst_cities');

// ── static reference data ─────────────────────────────────────────────────────
const STATE_ABBR = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
    VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
    DC: 'District of Columbia', PR: 'Puerto Rico',
};

// Banner accent color per event (broadcast palette; defaults to warning red).
function eventColor(event) {
    const e = (event || '').toLowerCase();
    if (e.includes('tornado')) return '#c8102e';
    if (e.includes('severe thunderstorm')) return '#e03a1e';
    if (e.includes('flash flood') || e.includes('flood')) return '#1f8f3b';
    if (e.includes('snow squall') || e.includes('winter') || e.includes('blizzard')) return '#7b3fb3';
    if (e.includes('marine')) return '#0f7ea8';
    if (e.includes('dust')) return '#b5762a';
    if (e.includes('extreme wind')) return '#a01020';
    if (e.includes('special weather statement')) return '#c58a12';
    return '#c8102e';
}

const SAFETY = {
    tornado: ['Move to the lowest floor.', 'Stay away from windows.', 'Protect your head.', 'If outside, lie flat in a ditch.'],
    severe: ['Move indoors.', 'Stay away from windows.', 'Avoid unnecessary travel.'],
    flood: ["Turn Around Don't Drown.", 'Move to higher ground.', 'Never drive through flood water.'],
    snow: ['Slow down immediately.', 'Expect rapidly changing visibility.', 'Increase following distance.'],
    marine: ['Seek safe harbor immediately.', 'Secure loose objects on deck.'],
    dust: ['Pull off the road, stop, turn off lights.', 'Wait for visibility to improve.'],
    default: ['Stay weather-aware.', 'Have a way to receive warnings.', 'Be ready to act quickly.'],
};
function safetyFor(event) {
    const e = (event || '').toLowerCase();
    if (e.includes('tornado')) return { title: 'Tornado Safety', items: SAFETY.tornado };
    if (e.includes('severe thunderstorm') || e.includes('extreme wind')) return { title: 'Severe Storm Safety', items: SAFETY.severe };
    if (e.includes('flood')) return { title: 'Flood Safety', items: SAFETY.flood };
    if (e.includes('snow') || e.includes('winter') || e.includes('blizzard')) return { title: 'Winter Safety', items: SAFETY.snow };
    if (e.includes('marine')) return { title: 'Marine Safety', items: SAFETY.marine };
    if (e.includes('dust')) return { title: 'Dust Storm Safety', items: SAFETY.dust };
    return { title: 'Safety', items: SAFETY.default };
}

// Export presets: label -> pixel size + aspect group.
const PRESETS = [
    { id: 'l960', label: '1280×960', w: 1280, h: 960 },
    { id: 'l1080', label: '1920×1080', w: 1920, h: 1080 },
    { id: 'p45', label: '4:5', w: 1080, h: 1350 },
    { id: 'sq', label: '1:1', w: 1080, h: 1080 },
];

// ── alert selection + parsing ─────────────────────────────────────────────────
const DIR_ABBR = { north: 'N', south: 'S', east: 'E', west: 'W', northeast: 'NE', northwest: 'NW', southeast: 'SE', southwest: 'SW' };

function isWarningish(event) {
    const e = (event || '').toLowerCase();
    return e.includes('warning') || e.includes('statement') || e.includes('watch');
}

// Choose the featured alert: prefer a polygon under the map center, else the most
// prominent warning currently loaded.
function pickAlert() {
    const data = window.atticData && window.atticData.alerts_data;
    const feats = ((data && data.features) || []).filter((f) => f && f.geometry && isWarningish(f.properties && f.properties.event));
    if (!feats.length) return null;
    const c = map.getCenter();
    const pt = turf.point([c.lng, c.lat]);
    let containing = null;
    for (const f of feats) {
        try { if (turf.booleanPointInPolygon(pt, turf.feature(f.geometry))) { containing = f; break; } } catch (e) { /* skip */ }
    }
    if (containing) return containing;
    // else: prioritize by severity keyword
    const rank = (e) => (/tornado/i.test(e) ? 0 : /severe|extreme/i.test(e) ? 1 : /flood/i.test(e) ? 2 : 3);
    return feats.slice().sort((a, b) => rank(a.properties.event) - rank(b.properties.event))[0];
}

function fmtTime(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
const param = (p, k) => (p && p.parameters && p.parameters[k] && p.parameters[k][0]) || null;

function parseAlert(feature, centroid) {
    const p = feature.properties || {};
    const desc = p.description || '';

    // State (from centroid → US state polygon, fall back to areaDesc abbr).
    let stateName = stateAt(centroid);
    if (!stateName) {
        const m = (p.areaDesc || '').match(/,\s*([A-Z]{2})\b/);
        if (m && STATE_ABBR[m[1]]) stateName = STATE_ABBR[m[1]];
    }

    // Movement from the description ("...moving northeast at 45 mph").
    let movement = null;
    const mv = desc.match(/moving\s+(northeast|northwest|southeast|southwest|north|south|east|west)\w*\s+at\s+(\d+)\s*mph/i);
    if (mv) movement = `Moving ${DIR_ABBR[mv[1].toLowerCase()] || mv[1]} at ${mv[2]} MPH`;

    const hazardText = (desc.match(/HAZARD\.\.\.([^\n*]+)/) || [])[1];
    const sourceText = (desc.match(/SOURCE\.\.\.([^\n*]+)/) || [])[1];

    return {
        event: p.event || 'Weather Warning',
        stateName,
        expires: fmtTime(p.expires || p.ends),
        issued: fmtTime(p.effective || p.sent),
        source: (sourceText && sourceText.trim()) || p.senderName || null,
        hazard: (hazardText && hazardText.trim()) || null,
        wind: param(p, 'maxWindGust'),
        hail: param(p, 'maxHailSize') ? `${param(p, 'maxHailSize')}"` : null,
        tornado: param(p, 'tornadoDetection'),
        damage: param(p, 'thunderstormDamageThreat'),
        movement,
        areaDesc: p.areaDesc || '',
    };
}

// Which US state contains a [lng,lat] point.
function stateAt(lnglat) {
    if (!lnglat) return null;
    const pt = turf.point(lnglat);
    for (const f of US_STATES.features) {
        try { if (turf.booleanPointInPolygon(pt, f)) return f.properties.name; } catch (e) { /* skip */ }
    }
    return null;
}

// ── population estimate (cities inside the polygon) ───────────────────────────
function estimatePopulation(feature) {
    let pop = 0;
    try {
        const bb = turf.bbox(turf.feature(feature.geometry)); // [minX,minY,maxX,maxY]
        const poly = turf.feature(feature.geometry);
        for (const c of getCities()) {
            if (c.lon < bb[0] || c.lon > bb[2] || c.lat < bb[1] || c.lat > bb[3]) continue; // cheap bbox reject
            if (turf.booleanPointInPolygon(turf.point([c.lon, c.lat]), poly)) pop += c.population || 0;
        }
    } catch (e) { return null; }
    return pop > 0 ? pop : null;
}

// ── capture the live map, with the featured polygon outlined ──────────────────
function captureMap(feature) {
    const c = map.getCanvas();
    const cap = document.createElement('canvas');
    cap.width = c.width; cap.height = c.height; // full drawing-buffer resolution
    const ctx = cap.getContext('2d');
    ctx.drawImage(c, 0, 0);

    // Emphasize the featured warning: thick black outline + red border + red fill.
    if (feature && feature.geometry) {
        const dpr = c.width / (c.clientWidth || c.width);
        const proj = (lng, lat) => { const p = map.project([lng, lat]); return [p.x * dpr, p.y * dpr]; };
        const rings = feature.geometry.type === 'MultiPolygon'
            ? feature.geometry.coordinates.flat()
            : feature.geometry.coordinates;
        const trace = () => {
            ctx.beginPath();
            for (const ring of rings) {
                ring.forEach((pt, i) => { const [x, y] = proj(pt[0], pt[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
                ctx.closePath();
            }
        };
        trace(); ctx.fillStyle = 'rgba(220,20,40,0.18)'; ctx.fill('evenodd');
        trace(); ctx.lineJoin = 'round'; ctx.strokeStyle = '#000'; ctx.lineWidth = 8 * dpr; ctx.stroke();
        trace(); ctx.strokeStyle = '#ff2436'; ctx.lineWidth = 4 * dpr; ctx.stroke();
    }
    return cap.toDataURL('image/png');
}

// ── US locator (bottom-left) — highlight the state + drop a marker ────────────
function renderLocator(stateName, centroid, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    // CONUS equirectangular bounds.
    const W = -125, E = -66.5, S = 24, N = 49.7;
    const px = (lng) => (lng - W) / (E - W) * w;
    const py = (lat) => (N - lat) / (N - S) * h;
    ctx.fillStyle = 'rgba(255,255,255,0)';
    ctx.clearRect(0, 0, w, h);

    const drawState = (f, fill, stroke) => {
        const geom = f.geometry;
        const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
        ctx.beginPath();
        for (const poly of polys) for (const ring of poly) {
            ring.forEach((pt, i) => { const x = px(pt[0]), y = py(pt[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
            ctx.closePath();
        }
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
    };
    for (const f of US_STATES.features) {
        const hit = stateName && f.properties.name === stateName;
        drawState(f, hit ? 'rgba(220,30,45,0.9)' : 'rgba(120,130,145,0.35)', 'rgba(200,210,225,0.5)');
    }
    if (centroid) {
        const x = Math.max(4, Math.min(w - 4, px(centroid[0])));
        const y = Math.max(4, Math.min(h - 4, py(centroid[1])));
        ctx.beginPath(); ctx.arc(x, y, Math.max(4, w * 0.018), 0, Math.PI * 2);
        ctx.fillStyle = '#ff2436'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    return cv.toDataURL('image/png');
}

// ── DOM helpers for the layout ────────────────────────────────────────────────
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

// Shrink a banner element's font-size until its text fits one line.
function fitText(el, maxPx) {
    let size = maxPx;
    el.style.fontSize = size + 'px';
    let guard = 40;
    while (el.scrollWidth > el.clientWidth && size > 12 && guard-- > 0) { size -= Math.max(1, size * 0.06); el.style.fontSize = size + 'px'; }
}

// Build the full-size layout element (off-screen) for html2canvas.
function buildLayout(info, mapImg, locatorImg, pop, homes, size) {
    const accent = eventColor(info.event);
    const root = document.createElement('div');
    root.className = 'wg-root';
    root.style.width = size.w + 'px';
    root.style.height = size.h + 'px';

    const rows = [];
    const row = (label, val) => { if (val) rows.push(`<div class="wg-row"><span>${esc(label)}</span><b>${esc(val)}</b></div>`); };
    row('Expires', info.expires);
    row('Issued', info.issued);
    row('Source', info.source);
    row('Hazard', info.hazard);
    row('Wind', info.wind);
    row('Hail', info.hail);
    row('Tornado', info.tornado);
    row('Damage Threat', info.damage);
    row('Movement', info.movement);
    if (pop) row('Population', pop.toLocaleString());
    if (homes) row('Homes', homes.toLocaleString());

    const safety = safetyFor(info.event);
    const state = info.stateName ? `IN ${info.stateName.toUpperCase()}` : '';

    root.innerHTML = `
        <div class="wg-map" style="background-image:url('${mapImg}')"></div>
        <div class="wg-vignette"></div>

        <div class="wg-banner" style="--accent:${accent};">
            <div class="wg-banner-inner">
                <div class="wg-banner-title" id="wg-title">${esc(info.event.toUpperCase())}</div>
                ${state ? `<div class="wg-banner-sub">${esc(state)}</div>` : ''}
            </div>
            <div class="wg-brand">
                <img src="/logo.png" class="wg-logo" alt="" onerror="this.style.display='none'"/>
                <div class="wg-brand-name">VORTEX RADAR</div>
            </div>
        </div>

        <div class="wg-panel wg-info">
            <div class="wg-panel-title">Warning Details</div>
            ${rows.join('') || '<div class="wg-row"><span>No details available</span></div>'}
            <div class="wg-safety">
                <div class="wg-safety-title">${esc(safety.title)}</div>
                ${safety.items.map((i) => `<div class="wg-safety-item">• ${esc(i)}</div>`).join('')}
            </div>
        </div>

        <div class="wg-locator">
            <img src="${locatorImg}" alt="" />
        </div>

        <div class="wg-legend">
            <div class="wg-legend-title">Reflectivity (dBZ)</div>
            <div class="wg-legend-bar wg-ref"></div>
            <div class="wg-legend-scale"><span>5</span><span>30</span><span>50</span><span>75</span></div>
            <div class="wg-legend-title" style="margin-top:8px;">Velocity (kt)</div>
            <div class="wg-legend-bar wg-vel"></div>
            <div class="wg-legend-scale"><span>-60</span><span>0</span><span>+60</span></div>
            <div class="wg-timestamp" id="wg-ts">${esc(new Date().toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }))}</div>
        </div>`;
    return root;
}

// ── injected styles for the layout ───────────────────────────────────────────
function injectLayoutStyles() {
    if (document.getElementById('wg-layout-styles')) return;
    const s = document.createElement('style');
    s.id = 'wg-layout-styles';
    s.textContent = `
    .wg-root{position:relative;overflow:hidden;background:#05070c;font-family:'Onest',system-ui,-apple-system,'Segoe UI',sans-serif;color:#fff;}
    .wg-map{position:absolute;inset:0;width:100%;height:100%;background-size:cover;background-position:center;background-repeat:no-repeat;}
    .wg-vignette{position:absolute;inset:0;background:
        linear-gradient(180deg, rgba(0,0,0,.35) 0%, rgba(0,0,0,0) 18%),
        linear-gradient(90deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 34%),
        linear-gradient(0deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,0) 26%);}
    .wg-banner{position:absolute;top:0;left:0;right:0;height:12.5%;min-height:66px;
        background-color:var(--accent);
        background-image:linear-gradient(180deg, rgba(255,255,255,.10), rgba(0,0,0,.42));
        display:flex;align-items:center;justify-content:space-between;padding:0 3%;
        box-shadow:0 6px 22px rgba(0,0,0,.5);border-bottom:3px solid rgba(255,255,255,.85);}
    .wg-banner-inner{min-width:0;flex:1;}
    .wg-banner-title{font-weight:900;letter-spacing:.5px;line-height:1;white-space:nowrap;overflow:hidden;text-shadow:0 3px 10px rgba(0,0,0,.45);}
    .wg-banner-sub{font-weight:800;opacity:.95;letter-spacing:2px;margin-top:6px;font-size:24px;}
    .wg-brand{display:flex;align-items:center;gap:10px;flex-shrink:0;margin-left:16px;}
    .wg-logo{height:46px;width:auto;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5));}
    .wg-brand-name{font-weight:900;letter-spacing:1.5px;font-size:18px;opacity:.95;}
    .wg-panel{position:absolute;background:rgba(9,14,24,.82);border:1px solid rgba(255,255,255,.14);
        border-radius:16px;box-shadow:0 16px 40px rgba(0,0,0,.5);}
    .wg-info{left:2.4%;top:16.5%;width:30%;max-width:560px;padding:18px 20px;}
    .wg-panel-title{font-weight:800;font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:#8fd0ff;margin-bottom:10px;}
    .wg-row{display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:16px;line-height:1.35;}
    .wg-row span{opacity:.72;}.wg-row b{text-align:right;font-weight:700;}
    .wg-safety{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.14);}
    .wg-safety-title{font-weight:800;color:#ffd24a;font-size:14px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;}
    .wg-safety-item{font-size:14.5px;line-height:1.5;opacity:.95;}
    .wg-locator{position:absolute;left:2.4%;bottom:3.5%;width:19%;max-width:300px;
        background:rgba(9,14,24,.82);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:8px;box-shadow:0 14px 34px rgba(0,0,0,.5);}
    .wg-locator img{width:100%;display:block;border-radius:8px;}
    .wg-legend{position:absolute;right:2.4%;bottom:3.5%;width:22%;max-width:340px;
        background:rgba(9,14,24,.82);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px 14px;box-shadow:0 14px 34px rgba(0,0,0,.5);}
    .wg-legend-title{font-size:12px;font-weight:700;letter-spacing:.06em;opacity:.85;margin-bottom:4px;text-transform:uppercase;}
    .wg-legend-bar{height:12px;border-radius:6px;border:1px solid rgba(255,255,255,.18);}
    .wg-ref{background:linear-gradient(90deg,#00d200,#00a000,#ffff00,#ff9000,#ff0000,#c00000,#ff00ff,#a000a0);}
    .wg-vel{background:linear-gradient(90deg,#00c000,#00ff00,#8f8f8f,#ff0000,#900000);}
    .wg-legend-scale{display:flex;justify-content:space-between;font-size:11px;opacity:.7;margin-top:3px;}
    .wg-timestamp{margin-top:10px;font-size:13px;font-weight:700;opacity:.9;border-top:1px solid rgba(255,255,255,.12);padding-top:8px;}`;
    document.head.appendChild(s);
}

// ── generate ──────────────────────────────────────────────────────────────────
async function generate(size) {
    const html2canvas = window.html2canvas;
    if (typeof html2canvas !== 'function') throw new Error('Renderer (html2canvas) not available.');

    const feature = pickAlert();
    if (!feature) throw new Error('No active warning polygon is on the map. Turn on Alerts and zoom to a warning first.');

    const centroid = (() => { try { return turf.getCoord(turf.centroid(turf.feature(feature.geometry))); } catch (e) { return null; } })();
    const info = parseAlert(feature, centroid);
    const pop = estimatePopulation(feature);
    const homes = pop ? Math.round(pop / 2.53) : null; // ~US avg household size

    const mapImg = captureMap(feature);
    const locatorImg = renderLocator(info.stateName, centroid, 420, 300);

    injectLayoutStyles();
    const layout = buildLayout(info, mapImg, locatorImg, pop, homes, size);
    // Lay it out off-screen (rendered but not visible) for html2canvas.
    layout.style.position = 'fixed';
    layout.style.left = '-10000px';
    layout.style.top = '0';
    document.body.appendChild(layout);

    // Size the banner headline to the frame, then fit-to-width for long names.
    const title = layout.querySelector('#wg-title');
    title.style.fontSize = Math.round(size.h * 0.072) + 'px';
    fitText(title, Math.round(size.h * 0.072));
    const sub = layout.querySelector('.wg-banner-sub');
    if (sub) sub.style.fontSize = Math.round(size.h * 0.026) + 'px';

    // Wait a tick so the <img> map/locator decode before rasterizing.
    await new Promise((r) => setTimeout(r, 60));

    const scale = Math.min(2, Math.max(1, Math.floor(3840 / size.w))); // high-DPI, capped
    let canvas;
    try {
        canvas = await html2canvas(layout, {
            width: size.w, height: size.h, scale,
            backgroundColor: '#05070c', useCORS: true, logging: false,
        });
    } finally {
        layout.remove();
    }
    return canvas;
}

// ── modal UI ──────────────────────────────────────────────────────────────────
let _lastCanvas = null;

function injectUiStyles() {
    if (document.getElementById('wg-ui-styles')) return;
    const s = document.createElement('style');
    s.id = 'wg-ui-styles';
    s.textContent = `
    .wg-modal-bg{position:fixed;inset:0;z-index:100065;background:rgba(4,8,16,.72);backdrop-filter:blur(6px);
        display:flex;align-items:center;justify-content:center;padding:24px;font-family:'Onest',system-ui,sans-serif;}
    .wg-modal{width:min(880px,95vw);max-height:92vh;overflow:auto;background:rgba(11,18,32,.98);
        border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.6);color:#e7eef7;}
    .wg-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.1);}
    .wg-modal-head h2{margin:0;font-size:1.15em;display:flex;align-items:center;gap:9px;}
    .wg-x{cursor:pointer;opacity:.7;font-size:20px;line-height:1;}.wg-x:hover{opacity:1;}
    .wg-modal-body{padding:16px 18px;}
    .wg-sizes{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}
    .wg-size{padding:8px 14px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.3);
        color:#cdd9f0;cursor:pointer;font-weight:600;font-size:13px;font-family:inherit;}
    .wg-size.on{background:#27beff;color:#001022;border-color:transparent;}
    .wg-actions{display:flex;gap:8px;flex-wrap:wrap;}
    .wg-btn{padding:10px 16px;border-radius:10px;border:none;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;}
    .wg-btn.primary{background:#27beff;color:#001022;}.wg-btn.primary:hover{background:#4ad0ff;}
    .wg-btn.ghost{background:rgba(255,255,255,.08);color:#e7eef7;}.wg-btn.ghost:hover{background:rgba(255,255,255,.16);}
    .wg-btn:disabled{opacity:.45;cursor:default;}
    .wg-preview{margin-top:14px;border-radius:12px;overflow:hidden;background:#05070c;border:1px solid rgba(255,255,255,.1);
        min-height:180px;display:flex;align-items:center;justify-content:center;position:relative;}
    .wg-preview img{max-width:100%;display:block;}
    .wg-msg{padding:24px;color:#9fb0c8;text-align:center;font-size:14px;}
    .wg-spinner{width:38px;height:38px;border:4px solid rgba(255,255,255,.15);border-top-color:#27beff;border-radius:50%;animation:wg-spin .8s linear infinite;}
    @keyframes wg-spin{to{transform:rotate(360deg);}}`;
    document.head.appendChild(s);
}

function openWarningGraphic() {
    injectUiStyles();
    const existing = document.getElementById('wg-modal-bg');
    if (existing) existing.remove();

    const bg = document.createElement('div');
    bg.id = 'wg-modal-bg';
    bg.className = 'wg-modal-bg';
    bg.innerHTML = `
        <div class="wg-modal">
            <div class="wg-modal-head">
                <h2><i class="fa fa-image"></i> Warning Graphic</h2>
                <span class="wg-x" id="wg-close">&times;</span>
            </div>
            <div class="wg-modal-body">
                <div class="wg-sizes" id="wg-sizes"></div>
                <div class="wg-actions">
                    <button class="wg-btn primary" id="wg-generate">Generate Warning Graphic</button>
                    <button class="wg-btn ghost" id="wg-save" disabled>Save PNG</button>
                    <button class="wg-btn ghost" id="wg-copy" disabled>Copy Image</button>
                </div>
                <div class="wg-preview" id="wg-preview">
                    <div class="wg-msg">Pick a size, then Generate. The graphic uses your current map view and the active warning.</div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(bg);

    let size = PRESETS[1]; // default 1920×1080
    const sizesEl = bg.querySelector('#wg-sizes');
    PRESETS.forEach((p) => {
        const b = document.createElement('button');
        b.className = 'wg-size' + (p.id === size.id ? ' on' : '');
        b.textContent = p.label;
        b.onclick = () => { size = p; sizesEl.querySelectorAll('.wg-size').forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
        sizesEl.appendChild(b);
    });

    const preview = bg.querySelector('#wg-preview');
    const saveBtn = bg.querySelector('#wg-save');
    const copyBtn = bg.querySelector('#wg-copy');
    const genBtn = bg.querySelector('#wg-generate');

    const close = () => bg.remove();
    bg.querySelector('#wg-close').onclick = close;
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });

    genBtn.onclick = async () => {
        preview.innerHTML = '<div class="wg-spinner"></div>';
        saveBtn.disabled = copyBtn.disabled = genBtn.disabled = true;
        try {
            _lastCanvas = await generate(size);
            const img = new Image();
            img.src = _lastCanvas.toDataURL('image/png');
            preview.innerHTML = '';
            preview.appendChild(img);
            saveBtn.disabled = copyBtn.disabled = false;
        } catch (err) {
            preview.innerHTML = `<div class="wg-msg">${esc(err.message || 'Could not generate the graphic.')}</div>`;
        } finally {
            genBtn.disabled = false;
        }
    };

    saveBtn.onclick = () => {
        if (!_lastCanvas) return;
        _lastCanvas.toBlob((blob) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `vortex-warning-${Date.now()}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }, 'image/png');
    };

    copyBtn.onclick = async () => {
        if (!_lastCanvas) return;
        try {
            const blob = await new Promise((r) => _lastCanvas.toBlob(r, 'image/png'));
            await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => (copyBtn.textContent = 'Copy Image'), 1800);
        } catch (e) {
            copyBtn.textContent = 'Copy failed';
            setTimeout(() => (copyBtn.textContent = 'Copy Image'), 1800);
        }
    };
}

module.exports = { openWarningGraphic };
