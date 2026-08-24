/*
 * components/tornado_potential.js
 * Frontend for the experimental Tornado Potential system.
 *
 * Shows radar-derived circulations on the map with a 0-100 potential score, a
 * summary panel, a per-storm analysis panel, and optional alerts.
 *
 * TWO RULES THIS FILE MUST KEEP:
 *
 * 1. It never impersonates a warning. Everything is labelled VORTEX RADAR
 *    EXPERIMENTAL, the disclaimer is present on every surface that shows a
 *    score, and where an official NWS Tornado Warning exists it is shown ABOVE
 *    the experimental number and visually distinct from it. The experimental
 *    score never uses the visual language of an official warning.
 *
 * 2. It follows the design system. Severity uses the --vx-sev-* data tokens,
 *    never the amber --vx-accent, which means interface state only. Amber here
 *    marks the layer being on, nothing else.
 *
 * ES module, loaded from index.html. Polls only while the layer is enabled.
 */

const API = '/api';
const POLL_MS = 30000;
const PREFS_KEY = 'vortexTornadoPrefs';

let active = false;
let pollTimer = null;
let markers = [];
let lastData = null;
let selectedStormId = null;
let lastAlertCheck = new Date().toISOString();

const DISCLAIMER = 'Vortex Radar Tornado Potential is an experimental radar-derived '
    + 'analysis tool. It is not an official warning system and does not replace alerts '
    + 'or warnings issued by the National Weather Service.';

const DEFAULT_PREFS = {
    minScore: 60,
    minConfidence: 'MEDIUM',
    cooldownMinutes: 10,
    sound: false,
    browserNotifications: false,
    inAppNotifications: true,
};

function prefs() {
    try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) }; }
    catch { return { ...DEFAULT_PREFS }; }
}
function savePrefs(p) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

function mapObj() { return window.vortexMap && window.vortexMap.map; }
function GL() { return window.mapboxgl || window.maplibregl; }
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Severity colours come from the data-colour tokens, never the UI accent.
const CATEGORY_TOKEN = {
    'VERY LOW': '--vx-text-3',
    LOW: '--vx-sev-minor',
    ELEVATED: '--vx-sev-moderate',
    HIGH: '--vx-sev-severe',
    EXTREME: '--vx-sev-extreme',
};
function catColor(category) { return `var(${CATEGORY_TOKEN[category] || '--vx-text-3'})`; }

/* ── styles ───────────────────────────────────────────────────────────────── */
function injectStyles() {
    if (document.getElementById('vtp-styles')) return;
    const s = document.createElement('style');
    s.id = 'vtp-styles';
    s.textContent = `
    #vtpPanel{position:fixed;right:12px;top:64px;z-index:100062;width:min(300px,88vw);
      background:var(--vx-surface);border:1px solid var(--vx-line);border-radius:var(--vx-r-3);
      box-shadow:var(--vx-shadow);font-family:var(--vx-font);color:var(--vx-text);overflow:hidden}
    .vtp-head{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid var(--vx-line);
      background:var(--vx-surface-2)}
    .vtp-head b{flex:1;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
    .vtp-x{background:none;border:none;color:var(--vx-text-3);font-size:17px;line-height:1;cursor:pointer;padding:0 2px}
    .vtp-x:hover{color:var(--vx-text)}
    .vtp-exp{padding:5px 11px;font-size:8.5px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;
      color:var(--vx-text-3);border-bottom:1px solid var(--vx-line);background:var(--vx-surface-2)}
    .vtp-body{padding:10px 11px}
    .vtp-stat{margin-bottom:11px}
    .vtp-stat:last-child{margin-bottom:0}
    .vtp-lbl{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--vx-text-3);margin-bottom:3px}
    .vtp-big{font-size:22px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:7px}
    .vtp-big span{font-size:10.5px;font-weight:700;letter-spacing:.08em}
    .vtp-val{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
    .vtp-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--vx-line);cursor:pointer}
    .vtp-row:hover{background:var(--vx-surface-3)}
    .vtp-chip{font-size:9px;font-weight:700;letter-spacing:.08em;padding:2px 5px;border-radius:var(--vx-r-1);
      border:1px solid currentColor;white-space:nowrap}
    .vtp-none{color:var(--vx-text-3);font-size:12px;padding:6px 0}
    .vtp-foot{padding:8px 11px;border-top:1px solid var(--vx-line);color:var(--vx-text-3);font-size:9.5px;line-height:1.45}
    .vtp-gear{background:none;border:1px solid var(--vx-line-2);color:var(--vx-text-2);border-radius:var(--vx-r-1);
      font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 6px;cursor:pointer}
    .vtp-gear:hover{color:var(--vx-text);background:var(--vx-surface-3)}

    /* detail panel */
    #vtpDetail{position:fixed;right:12px;top:64px;z-index:100064;width:min(340px,92vw);max-height:82vh;overflow:auto;
      background:var(--vx-surface);border:1px solid var(--vx-line);border-radius:var(--vx-r-3);
      box-shadow:var(--vx-shadow-lg);font-family:var(--vx-font);color:var(--vx-text)}
    .vtp-official{margin:9px 11px 0;padding:8px 9px;border:1px solid var(--vx-sev-extreme);
      border-left:3px solid var(--vx-sev-extreme);border-radius:var(--vx-r-2);background:rgba(194,53,43,.10)}
    .vtp-official .t{font-size:10px;font-weight:800;letter-spacing:.09em;color:var(--vx-sev-extreme);text-transform:uppercase}
    .vtp-official .h{font-size:11.5px;color:var(--vx-text);margin-top:3px;line-height:1.4}
    .vtp-kv{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--vx-line);font-size:12px}
    .vtp-kv:last-child{border-bottom:none}
    .vtp-kv span:first-child{color:var(--vx-text-2)}
    .vtp-kv span:last-child{font-variant-numeric:tabular-nums;text-align:right}
    .vtp-sec{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--vx-text-3);
      margin:12px 0 5px;padding-bottom:4px;border-bottom:1px solid var(--vx-line-2)}
    .vtp-bar{height:4px;background:var(--vx-surface-3);border-radius:2px;overflow:hidden;margin-top:3px}
    .vtp-bar i{display:block;height:100%}

    /* map marker */
    .vtp-marker{position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer}
    .vtp-ring{width:26px;height:26px;border-radius:50%;border:2px solid currentColor;
      display:flex;align-items:center;justify-content:center;background:rgba(10,11,13,.55);
      font-size:10px;font-weight:800;font-family:var(--vx-font);font-variant-numeric:tabular-nums}
    .vtp-ring.vtp-pulse{animation:vtp-pulse 2s ease-out infinite}
    @keyframes vtp-pulse{0%{box-shadow:0 0 0 0 currentColor}70%{box-shadow:0 0 0 14px transparent}100%{box-shadow:0 0 0 0 transparent}}
    .vtp-tag{margin-top:3px;background:var(--vx-surface);border:1px solid var(--vx-line-2);color:var(--vx-text);
      font-size:8.5px;font-weight:700;letter-spacing:.07em;padding:1px 4px;border-radius:var(--vx-r-1);white-space:nowrap}
    .vtp-arrow{position:absolute;top:50%;left:50%;width:2px;background:currentColor;transform-origin:top center}

    /* alert toast */
    .vtp-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:100085;
      width:min(360px,92vw);background:var(--vx-surface);border:1px solid var(--vx-line-2);
      border-left:3px solid var(--vx-sev-severe);border-radius:var(--vx-r-3);box-shadow:var(--vx-shadow-lg);
      font-family:var(--vx-font);color:var(--vx-text);overflow:hidden}
    .vtp-toast .h{padding:8px 11px 0;font-size:8.5px;font-weight:700;letter-spacing:.11em;
      text-transform:uppercase;color:var(--vx-text-3)}
    .vtp-toast .t{padding:2px 11px 0;font-size:13px;font-weight:800}
    .vtp-toast .b{padding:5px 11px 9px;font-size:11.5px;color:var(--vx-text-2);line-height:1.5;font-variant-numeric:tabular-nums}
    .vtp-toast .a{display:flex;gap:8px;padding:0 11px 9px}
    .vtp-toast button{flex:1;background:transparent;border:1px solid var(--vx-line-2);color:var(--vx-text-2);
      border-radius:var(--vx-r-1);font:700 10px/1 var(--vx-font);letter-spacing:.07em;text-transform:uppercase;
      padding:6px;cursor:pointer}
    .vtp-toast button:hover{background:var(--vx-surface-3);color:var(--vx-text)}
    @media (max-width:640px){#vtpPanel,#vtpDetail{right:8px;left:8px;width:auto;top:58px}}
    `;
    document.head.appendChild(s);
}

/* ── data ─────────────────────────────────────────────────────────────────── */
async function fetchJson(path) {
    const r = await fetch(API + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
}

async function refresh() {
    if (!active) return;
    try {
        lastData = await fetchJson('/tornado-potential');
        renderPanel();
        renderMarkers();
    } catch (e) {
        console.warn('[tornado] refresh failed:', e.message);
        renderPanel(e);
    }
    checkAlerts();
}

/* ── map markers ──────────────────────────────────────────────────────────── */
function clearMarkers() {
    markers.forEach((m) => { try { m.remove(); } catch { /* already gone */ } });
    markers = [];
    const m = mapObj();
    if (m && m.getLayer && m.getLayer('vtp-projection')) {
        try { m.removeLayer('vtp-projection'); m.removeSource('vtp-projection'); } catch { /* ignore */ }
    }
}

function renderMarkers() {
    const m = mapObj(), g = GL();
    if (!m || !g || !lastData) return;
    clearMarkers();

    for (const s of lastData.storms || []) {
        if (!s.score && s.rotation === 'NONE') continue;
        const el = document.createElement('div');
        el.className = 'vtp-marker';
        el.style.color = catColor(s.category);
        const pulse = (s.category === 'HIGH' || s.category === 'EXTREME') ? ' vtp-pulse' : '';
        el.innerHTML = `<div class="vtp-ring${pulse}">${s.score}</div>`
            + `<div class="vtp-tag">${esc(s.stormId)}</div>`;
        el.title = `${s.stormId} — experimental tornado potential ${s.score}/100 (${s.category})`;

        // Storm-motion vector, drawn from the circulation centre.
        if (s.stormMotion && s.stormMotion.speedMph > 0) {
            const arrow = document.createElement('div');
            arrow.className = 'vtp-arrow';
            const len = Math.min(34, 12 + s.stormMotion.speedMph * 0.4);
            arrow.style.height = len + 'px';
            arrow.style.transform = `translate(-50%,0) rotate(${s.stormMotion.direction}deg)`;
            el.querySelector('.vtp-ring').appendChild(arrow);
        }

        el.addEventListener('click', (e) => { e.stopPropagation(); openDetail(s.stormId); });
        try {
            markers.push(new g.Marker({ element: el }).setLngLat([s.longitude, s.latitude]).addTo(m));
        } catch (err) { /* map not ready */ }
    }

    drawProjection();
}

// Projected Storm Motion for the selected storm — explicitly the CELL's path.
function drawProjection() {
    const m = mapObj();
    if (!m || !m.getSource || !lastData || !selectedStormId) return;
    const s = (lastData.storms || []).find((x) => x.stormId === selectedStormId);
    if (!s || !s.stormMotion) return;

    fetchJson('/tornado-potential/' + encodeURIComponent(selectedStormId)).then((d) => {
        const proj = d.storm && d.storm.projectedStormMotion;
        if (!proj || !proj.length || !mapObj()) return;
        const coords = [[s.longitude, s.latitude], ...proj.map((p) => [p.lon, p.lat])];
        const data = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
        try {
            if (m.getSource('vtp-projection')) {
                m.getSource('vtp-projection').setData(data);
            } else {
                m.addSource('vtp-projection', { type: 'geojson', data });
                m.addLayer({
                    id: 'vtp-projection',
                    type: 'line',
                    source: 'vtp-projection',
                    paint: {
                        'line-color': '#c2352b',
                        'line-width': 2,
                        'line-dasharray': [2, 1.5],
                        'line-opacity': 0.85,
                    },
                });
            }
        } catch (e) { /* style not loaded yet */ }
    }).catch(() => {});
}

/* ── summary panel ────────────────────────────────────────────────────────── */
function renderPanel(err) {
    const p = document.getElementById('vtpPanel');
    if (!p) return;
    const body = p.querySelector('.vtp-body');
    if (!body) return;

    if (err) {
        body.innerHTML = `<div class="vtp-none">Could not reach the analysis service.<br>${esc(err.message)}</div>`;
        return;
    }
    const storms = (lastData && lastData.storms) || [];
    const withRotation = storms.filter((s) => s.rotation && s.rotation !== 'NONE');
    const top = storms[0];
    const strongest = withRotation.slice().sort((a, b) => b.maxVelocityDifferentialMs - a.maxVelocityDifferentialMs)[0];

    if (!storms.length) {
        body.innerHTML = '<div class="vtp-none">No storms are being tracked right now.'
            + '<br><br>The engine analyses radar sites near active warnings and your saved locations. '
            + 'If it is disabled on the server, nothing will appear here.</div>';
        return;
    }

    const trendArrow = top && top.trend === 'INCREASING' ? '↑' : top && top.trend === 'DECREASING' ? '↓' : '→';
    body.innerHTML = `
      <div class="vtp-stat">
        <div class="vtp-lbl">Active circulations</div>
        <div class="vtp-val">${withRotation.length} of ${storms.length} tracked storms</div>
      </div>
      ${top ? `
      <div class="vtp-stat">
        <div class="vtp-lbl">Highest potential</div>
        <div class="vtp-big" style="color:${catColor(top.category)}">${top.score}<span>${esc(top.category)}</span></div>
        <div class="vtp-bar"><i style="width:${top.score}%;background:${catColor(top.category)}"></i></div>
      </div>` : ''}
      ${strongest ? `
      <div class="vtp-stat">
        <div class="vtp-lbl">Strongest rotation</div>
        <div class="vtp-val">${esc(strongest.stormId)} · ΔV ${strongest.maxVelocityDifferentialMs} m/s</div>
      </div>` : ''}
      ${top ? `
      <div class="vtp-stat">
        <div class="vtp-lbl">Trend</div>
        <div class="vtp-val">${trendArrow} ${esc((top.trend || 'NONE').toLowerCase().replace(/^./, (c) => c.toUpperCase()))}</div>
      </div>` : ''}
      <div class="vtp-lbl" style="margin-top:12px">Tracked storms</div>
      ${storms.slice(0, 8).map((s) => `
        <div class="vtp-row" data-storm="${esc(s.stormId)}">
          <span class="vtp-chip" style="color:${catColor(s.category)}">${s.score}</span>
          <span style="flex:1;font-size:12px">${esc(s.stormId)}
            ${s.official && s.official.hasOfficialWarning ? '<b style="color:var(--vx-sev-extreme);font-size:9px;letter-spacing:.06em"> NWS TOR</b>' : ''}
          </span>
          <span style="font-size:10.5px;color:var(--vx-text-3)">${esc(s.site)}</span>
        </div>`).join('')}
    `;
    body.querySelectorAll('[data-storm]').forEach((row) => {
        row.onclick = () => openDetail(row.getAttribute('data-storm'));
    });
}

function togglePanel() {
    const existing = document.getElementById('vtpPanel');
    if (existing) { existing.remove(); return; }
    injectStyles();
    const p = document.createElement('div');
    p.id = 'vtpPanel';
    p.innerHTML = `
      <div class="vtp-head">
        <b>Tornado Potential</b>
        <button class="vtp-gear" id="vtpPrefsBtn" title="Alert settings">Alerts</button>
        <button class="vtp-x" aria-label="Close">×</button>
      </div>
      <div class="vtp-exp">Vortex Radar Experimental</div>
      <div class="vtp-body"><div class="vtp-none">Loading…</div></div>
      <div class="vtp-foot">${esc(DISCLAIMER)}</div>`;
    document.body.appendChild(p);
    p.querySelector('.vtp-x').onclick = () => p.remove();
    p.querySelector('#vtpPrefsBtn').onclick = openPrefs;
    renderPanel();
    refresh();
}

/* ── detail panel ─────────────────────────────────────────────────────────── */
async function openDetail(stormId) {
    injectStyles();
    selectedStormId = stormId;
    const old = document.getElementById('vtpDetail');
    if (old) old.remove();

    const d = document.createElement('div');
    d.id = 'vtpDetail';
    d.innerHTML = `<div class="vtp-head"><b>${esc(stormId)}</b><button class="vtp-x" aria-label="Close">×</button></div>
      <div class="vtp-exp">Vortex Radar Experimental — Radar-Derived Rotation</div>
      <div class="vtp-body"><div class="vtp-none">Loading analysis…</div></div>`;
    document.body.appendChild(d);
    d.querySelector('.vtp-x').onclick = () => { d.remove(); selectedStormId = null; };

    let data;
    try { data = await fetchJson('/tornado-potential/' + encodeURIComponent(stormId)); }
    catch (e) {
        d.querySelector('.vtp-body').innerHTML = `<div class="vtp-none">Could not load: ${esc(e.message)}</div>`;
        return;
    }
    const s = data.storm;
    const c = s.circulation;
    const env = s.environment;
    const kv = (k, v) => `<div class="vtp-kv"><span>${esc(k)}</span><span>${v}</span></div>`;
    const m = mapObj();
    if (m && s.latitude) { try { m.easeTo({ center: [s.longitude, s.latitude], duration: 800 }); } catch { /* ignore */ } }

    d.querySelector('.vtp-body').innerHTML = `
      ${s.official && s.official.tornadoWarning ? `
      <div class="vtp-official" style="margin:0 0 11px">
        <div class="t">Official NWS Tornado Warning</div>
        <div class="h">${esc(s.official.tornadoWarning.headline || 'A tornado warning is in effect for this area.')}</div>
        <div class="h" style="color:var(--vx-text-2);font-size:10.5px">Follow official NWS guidance. Expires ${esc(s.official.tornadoWarning.expires || '')}</div>
      </div>` : ''}

      <div class="vtp-big" style="color:${catColor(s.category)}">${s.score}<span>${esc(s.category)} · CONFIDENCE ${esc(s.confidence)}</span></div>
      <div class="vtp-bar"><i style="width:${s.score}%;background:${catColor(s.category)}"></i></div>

      <div class="vtp-sec">Rotation</div>
      ${kv('Strength', esc(s.rotation))}
      ${kv('Trend', esc(s.trend))}
      ${kv('Persistence', s.persistenceMinutes + ' min')}
      ${kv('Velocity differential (ΔV)', s.maxVelocityDifferentialMs + ' m/s')}
      ${kv('Rotational velocity', s.rotationalVelocityMs + ' m/s')}
      ${kv('Azimuthal shear', s.azimuthalShear + ' s⁻¹')}
      ${c ? kv('Couplet diameter', s.coupletDiameterKm + ' km') : ''}
      ${c ? kv('Direction', c.cyclonic ? 'Cyclonic' : 'Anticyclonic') : ''}
      ${s.tightening != null ? kv('Tightening', (s.tightening * 100).toFixed(0) + '%') : ''}

      <div class="vtp-sec">Storm</div>
      ${kv('Max reflectivity', (s.maxReflectivityDbz != null ? s.maxReflectivityDbz : '—') + ' dBZ')}
      ${s.stormMotion ? kv('Projected storm motion', `${s.stormMotion.compass} ${s.stormMotion.direction}° at ${s.stormMotion.speedMph} mph`) : ''}
      ${kv('Radar site', esc(s.site))}
      ${c ? kv('Range from radar', c.rangeKm + ' km') : ''}
      ${s.beamHeightKm != null ? kv('Beam height', s.beamHeightKm + ' km AGL') : ''}
      ${kv('First seen', new Date(s.firstSeen).toLocaleTimeString())}
      ${kv('Last scan', new Date(s.lastSeen).toLocaleTimeString())}

      ${env ? `<div class="vtp-sec">Near-storm environment</div>
      ${env.cape != null ? kv('CAPE', Math.round(env.cape) + ' J/kg') : ''}
      ${env.cin != null ? kv('CIN', Math.round(env.cin) + ' J/kg') : ''}
      ${env.srh01 != null ? kv('0-1 km SRH', Math.round(env.srh01) + ' m²/s²') : ''}
      ${env.srh03 != null ? kv('0-3 km SRH', Math.round(env.srh03) + ' m²/s²') : ''}
      ${env.shear06Ms != null ? kv('0-6 km bulk shear', env.shear06Ms.toFixed(1) + ' m/s') : ''}
      ${env.lclHeightM != null ? kv('LCL height', Math.round(env.lclHeightM) + ' m') : ''}
      <div style="font-size:9.5px;color:var(--vx-text-3);margin-top:5px">Source: ${esc(env.source || 'n/a')}</div>` : ''}

      ${s.scoreBreakdown ? `<div class="vtp-sec">Score components</div>
      ${Object.entries(s.scoreBreakdown.components).map(([k, v]) => {
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase());
        if (v === null) return kv(label, '<span style="color:var(--vx-text-3)">unavailable</span>');
        const w = Math.round((s.scoreBreakdown.weights[k] || 0) * 100);
        return kv(`${label} (${w}%)`, (v * 100).toFixed(0));
    }).join('')}
      ${s.scoreBreakdown.partial ? `<div style="font-size:9.5px;color:var(--vx-text-3);margin-top:5px">Some inputs were unavailable; their weight was redistributed across the remaining components.</div>` : ''}` : ''}

      ${s.projectedStormMotion && s.projectedStormMotion.length ? `<div class="vtp-sec">Projected storm motion</div>
      ${s.projectedStormMotion.map((p) => kv('+' + p.minutes + ' min', p.lat.toFixed(3) + ', ' + p.lon.toFixed(3))).join('')}
      <div style="font-size:9.5px;color:var(--vx-text-3);margin-top:5px">Where the storm cell is projected to travel. This is not a predicted tornado path.</div>` : ''}

      <div class="vtp-foot" style="padding:10px 0 0;border-top:1px solid var(--vx-line);margin-top:12px">${esc(DISCLAIMER)}</div>
    `;
    drawProjection();
}

/* ── alerts ───────────────────────────────────────────────────────────────── */
const CONF_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 };
let lastToastAt = 0;

async function checkAlerts() {
    const p = prefs();
    if (!p.inAppNotifications && !p.browserNotifications && !p.sound) return;
    let feed;
    try { feed = await fetchJson('/tornado-potential/alerts/feed?since=' + encodeURIComponent(lastAlertCheck)); }
    catch { return; }
    lastAlertCheck = new Date().toISOString();
    for (const a of (feed.alerts || [])) {
        if (a.currentScore < p.minScore) continue;
        if ((CONF_RANK[a.confidence] || 0) < (CONF_RANK[p.minConfidence] || 2)) continue;
        if (Date.now() - lastToastAt < p.cooldownMinutes * 60000) continue;
        lastToastAt = Date.now();
        showAlert(a, p);
    }
}

function showAlert(a, p) {
    if (p.inAppNotifications) {
        injectStyles();
        const el = document.createElement('div');
        el.className = 'vtp-toast';
        el.style.borderLeftColor = catColor(a.category);
        el.innerHTML = `
          <div class="h">Vortex Radar Experimental${a.officialTornadoWarning ? ' · NWS Tornado Warning in effect' : ''}</div>
          <div class="t">${esc(a.title)}</div>
          <div class="b">
            Storm ${esc(a.stormId)} · ${esc(a.site)}<br>
            Score ${a.previousScore != null ? a.previousScore + ' → ' : ''}<b style="color:${catColor(a.category)}">${a.currentScore}</b> (${esc(a.category)})<br>
            Rotation ${esc(a.rotation)} · Trend ${esc(a.trend)} · Confidence ${esc(a.confidence)}
            ${a.stormMotion ? `<br>Moving ${esc(a.stormMotion.compass)} at ${a.stormMotion.speedMph} mph` : ''}
          </div>
          <div class="a"><button data-act="view">View storm</button><button data-act="close">Dismiss</button></div>`;
        el.querySelector('[data-act="view"]').onclick = () => { el.remove(); openDetail(a.stormId); };
        el.querySelector('[data-act="close"]').onclick = () => el.remove();
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 30000);
    }

    if (p.browserNotifications && 'Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification('Vortex Radar — Tornado Potential (experimental)', {
                body: `${a.stormId}: score ${a.currentScore} (${a.category}). Rotation ${a.rotation}, trend ${a.trend}.\n`
                    + 'Experimental radar analysis — not an official NWS warning.',
                tag: a.stormId,
            });
        } catch { /* blocked */ }
    }

    if (p.sound) beep();
}

// A short tone via WebAudio — no asset to ship, no autoplay policy problem
// beyond the usual user-gesture requirement.
function beep() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.18);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.42);
        setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 800);
    } catch { /* audio unavailable */ }
}

function openPrefs() {
    injectStyles();
    const old = document.getElementById('vtpPrefs');
    if (old) { old.remove(); return; }
    const p = prefs();
    const d = document.createElement('div');
    d.id = 'vtpPrefs';
    d.style.cssText = 'position:fixed;right:12px;top:64px;z-index:100066;width:min(300px,90vw);'
        + 'background:var(--vx-surface);border:1px solid var(--vx-line);border-radius:var(--vx-r-3);'
        + 'box-shadow:var(--vx-shadow-lg);font-family:var(--vx-font);color:var(--vx-text)';
    const row = (label, control) => `<div class="vtp-kv"><span>${label}</span><span>${control}</span></div>`;
    d.innerHTML = `<div class="vtp-head"><b>Alert settings</b><button class="vtp-x">×</button></div>
      <div class="vtp-body">
        ${row('Minimum score', `<input id="vtpMin" type="number" min="0" max="100" value="${p.minScore}" style="width:56px;background:var(--vx-surface-2);border:1px solid var(--vx-line-2);color:var(--vx-text);border-radius:var(--vx-r-1);padding:3px 5px;font-family:inherit">`)}
        ${row('Minimum confidence', `<select id="vtpConf" style="background:var(--vx-surface-2);border:1px solid var(--vx-line-2);color:var(--vx-text);border-radius:var(--vx-r-1);padding:3px 5px;font-family:inherit">
            ${['LOW', 'MEDIUM', 'HIGH'].map((c) => `<option${p.minConfidence === c ? ' selected' : ''}>${c}</option>`).join('')}</select>`)}
        ${row('Cooldown (minutes)', `<input id="vtpCool" type="number" min="1" max="120" value="${p.cooldownMinutes}" style="width:56px;background:var(--vx-surface-2);border:1px solid var(--vx-line-2);color:var(--vx-text);border-radius:var(--vx-r-1);padding:3px 5px;font-family:inherit">`)}
        ${row('In-app notifications', `<input id="vtpInApp" type="checkbox"${p.inAppNotifications ? ' checked' : ''}>`)}
        ${row('Browser notifications', `<input id="vtpBrowser" type="checkbox"${p.browserNotifications ? ' checked' : ''}>`)}
        ${row('Sound', `<input id="vtpSound" type="checkbox"${p.sound ? ' checked' : ''}>`)}
        <div style="font-size:9.5px;color:var(--vx-text-3);margin-top:9px;line-height:1.5">
          These control the experimental Tornado Potential alerts only. They do not affect
          official NWS warning notifications.</div>
      </div>`;
    document.body.appendChild(d);
    d.querySelector('.vtp-x').onclick = () => d.remove();
    const save = () => {
        const next = {
            minScore: Math.max(0, Math.min(100, parseInt(d.querySelector('#vtpMin').value, 10) || 60)),
            minConfidence: d.querySelector('#vtpConf').value,
            cooldownMinutes: Math.max(1, parseInt(d.querySelector('#vtpCool').value, 10) || 10),
            inAppNotifications: d.querySelector('#vtpInApp').checked,
            browserNotifications: d.querySelector('#vtpBrowser').checked,
            sound: d.querySelector('#vtpSound').checked,
        };
        if (next.browserNotifications && 'Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
        savePrefs(next);
    };
    d.querySelectorAll('input,select').forEach((i) => i.addEventListener('change', save));
}

/* ── layer on/off ─────────────────────────────────────────────────────────── */
function setActive(on) {
    active = on;
    if (on) {
        injectStyles();
        refresh();
        clearInterval(pollTimer);
        pollTimer = setInterval(refresh, POLL_MS);
        if (!document.getElementById('vtpPanel')) togglePanel();
    } else {
        clearInterval(pollTimer);
        pollTimer = null;
        clearMarkers();
        const p = document.getElementById('vtpPanel'); if (p) p.remove();
        const d = document.getElementById('vtpDetail'); if (d) d.remove();
        selectedStormId = null;
    }
}

function init() {
    const sw = document.getElementById('armrTornadoPotentialSwitchElem');
    if (sw) sw.addEventListener('change', () => setActive(sw.checked));
    const btn = document.getElementById('vortexTornadoBtn');
    if (btn) btn.addEventListener('click', () => {
        const s = document.getElementById('armrTornadoPotentialSwitchElem');
        if (s) { s.checked = !s.checked; setActive(s.checked); }
        else { setActive(!active); }
    });
    window.VortexTornado = { open: togglePanel, refresh, setActive, detail: openDetail, prefs: openPrefs };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
