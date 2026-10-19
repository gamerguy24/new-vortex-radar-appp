/*
 * components/spotters.js
 * Fetches and displays active Spotter Network positions on the map.
 * Positions auto-refresh every 2 minutes.
 *
 * Spotter Network blocks direct browser requests (CORS), so these calls go
 * through the Echo Radar server proxy (/api/spotters/*), which forwards to
 * spotternetwork.org server-side.
 *
 * Beacons with a stream (components/beacon_streams.js) get a "Watch live"
 * button and a ringed marker. When one of those beacons comes on, the mini
 * player opens by itself and follows it (unless something else is already
 * playing — then it just says so); when it goes off, following stops.
 */
import { beaconStreamFor, beaconTrack } from './beacon_streams.js?v=beacon2';
import { openMiniPlayer, isPlayerOpen, playerTrack, endTracking } from './stream_player.js?v=hls1';

const SPOTTER_APP_ID = '55f78b6ed31f5';
const SPOTTER_POSITIONS_URL = '/api/spotters/positions';
const SPOTTER_REPORTS_URL = '/api/spotters/reports';
const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

let _spotterMarkers = [];
let _refreshTimer = null;
let _popup = null;
// Beacon-stream spotters seen in the last refresh (by their configured name),
// so a beacon coming on or going off can be told from one that stayed on.
let _liveBeacons = null;

function _createMarkerEl(props) {
    const stream = beaconStreamFor(props);
    if (stream) return _createStreamMarkerEl(props, stream);
    const el = document.createElement('div');
    el.title = props.callsign || 'Spotter';
    el.style.cssText = `
        width: 14px;
        height: 14px;
        background: #ff9800;
        border: 2px solid #1f2937;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 0 6px 2px rgba(255,152,0,0.5);
    `;
    el.addEventListener('mouseenter', () => {
        el.style.boxShadow = '0 0 10px 4px rgba(255,152,0,0.8)';
    });
    el.addEventListener('mouseleave', () => {
        el.style.boxShadow = '0 0 6px 2px rgba(255,152,0,0.5)';
    });
    return el;
}

// A beacon with a stream: the usual dot with a red live ring and its name.
function _createStreamMarkerEl(props, stream) {
    const el = document.createElement('div');
    el.className = 'vx-beacon-live';
    el.title = `${stream.name} — streaming beacon`;
    el.innerHTML = '<span class="vx-beacon-dot"></span><span class="vx-beacon-tag"></span>';
    el.querySelector('.vx-beacon-tag').textContent = stream.name;
    return el;
}

function _watch(stream) {
    if (_popup) { _popup.remove(); _popup = null; }
    // onLayer: the beacon marker here already shows where they are, so the
    // player draws no second marker on top of it.
    openMiniPlayer({ url: stream.url, name: stream.name, platform: stream.platform, track: { ...beaconTrack(stream), onLayer: true } });
}

function _toast(html, actionLabel, onAction) {
    const t = document.createElement('div');
    t.className = 'vx-beacon-toast';
    t.innerHTML = '<span></span>';
    t.querySelector('span').textContent = html;
    if (actionLabel) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = actionLabel;
        b.onclick = () => { t.remove(); onAction(); };
        t.appendChild(b);
    }
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 9000);
}

/*
 * After each refresh: a streaming beacon that has just come on is followed
 * (the player opens on it), and one that has gone off stops being followed.
 * The first refresh after the layer is switched on counts as "just came on".
 */
function _checkBeacons(positions) {
    const now = new Map();
    for (const p of positions) { const b = beaconStreamFor(p); if (b) now.set(b.spotter, b); }
    const before = _liveBeacons || new Map();
    const following = playerTrack();
    for (const [key, b] of now) {
        if (before.has(key)) continue;
        if (!isPlayerOpen()) {
            _watch(b);
            _toast(`${b.name}'s beacon is on — following.`);
        } else if (!(following && following.kind === 'spotter' && following.callsign === b.spotter)) {
            _toast(`${b.name}'s beacon is on.`, 'Watch & follow', () => _watch(b));
        }
    }
    for (const [key, b] of before) {
        if (now.has(key)) continue;
        if (following && following.kind === 'spotter' && following.callsign === b.spotter) {
            endTracking(`${b.name}'s beacon is off — stopped following.`);
        }
        _toast(`${b.name}'s beacon went off.`);
    }
    _liveBeacons = now;
}

function _showSpotterPopup(map, lngLat, props) {
    if (_popup) { _popup.remove(); _popup = null; }

    const callsign = props.callsign || 'Unknown';
    const name = (props.first || props.last) ? `${props.first || ''} ${props.last || ''}`.trim() : '';
    const reportAt = props.report_at || '';
    const ham = props.ham || '';
    const dir = props.dir != null ? `${props.dir}°` : '';
    const note = props.note || '';
    const stream = beaconStreamFor(props);

    let timeStr = '';
    if (reportAt) {
        try {
            timeStr = new Date(reportAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch { timeStr = reportAt; }
    }

    const loadingHtml = `
        <div style="min-width:160px; font-family:var(--vx-font); color:#fff; font-size:13px;">
            <div style="font-weight:700; font-size:14px; margin-bottom:4px; color:#ff9800;">
                <i class="ti ti-user" style="margin-right:4px;"></i>${callsign}
            </div>
            ${name ? `<div style="margin-bottom:2px; color:#ccc;">${name}</div>` : ''}
            ${ham ? `<div style="margin-bottom:2px;">Ham: ${ham}</div>` : ''}
            ${dir ? `<div style="margin-bottom:2px;">Heading: ${dir}</div>` : ''}
            ${note ? `<div style="margin-bottom:2px; color:#aaa;">${note}</div>` : ''}
            ${timeStr ? `<div style="color:#aaa; font-size:11px; margin-bottom:6px;">Last report: ${timeStr}</div>` : ''}
            ${stream ? `<button type="button" class="vx-beacon-watch" id="spotter-watch">▶ Watch live · follow beacon</button>` : ''}
            <div id="spotter-reports-content" style="margin-top:6px; border-top:1px solid rgba(255,255,255,0.1); padding-top:6px;">
                <div style="color:#aaa; font-size:11px;">Loading reports...</div>
            </div>
        </div>
    `;

    _popup = new maplibregl.Popup({ closeButton: false, className: 'spotter-popup', maxWidth: '280px' })
        .setLngLat(lngLat)
        .setHTML(loadingHtml)
        .addTo(map);
    if (stream) {
        const btn = document.getElementById('spotter-watch');
        if (btn) btn.onclick = () => _watch(stream);
    }

    const spotterId = props.id || props.spotter_id || '';
    if (!spotterId) {
        const el = document.getElementById('spotter-reports-content');
        if (el) el.innerHTML = '<div style="color:#aaa; font-size:11px;">No reports available.</div>';
        return;
    }

    fetch(SPOTTER_REPORTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: spotterId }),
        cache: 'no-store'
    })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
        const el = document.getElementById('spotter-reports-content');
        if (!el) return;
        const reports = data?.reports ?? [];
        if (!reports.length) {
            el.innerHTML = '<div style="color:#aaa; font-size:11px;">No recent reports.</div>';
            return;
        }

        const typeLabel = t => ({ S: 'Severe', W: 'Winter', F: 'Flood', E: 'Other' }[t] || t || 'Report');
        const typeColor = t => ({ S: '#ff4444', W: '#60a5fa', F: '#34d399', E: '#aaa' }[t] || '#ff9800');

        const items = reports.slice(0, 3).map(r => {
            let details = [];
            if (+r.tornado) details.push('Tornado');
            if (+r.funnelcloud) details.push('Funnel Cloud');
            if (+r.wallcloud) details.push('Wall Cloud');
            if (+r.hail && +r.hailsize > 0) details.push(`Hail ${r.hailsize}"`);
            else if (+r.hail) details.push('Hail');
            if (+r.wind && +r.windspeed > 0) details.push(`Wind ${r.windspeed}mph`);
            else if (+r.wind) details.push('Wind');
            if (+r.flood || +r.flashflood) details.push('Flood');
            if (+r.snow && +r.newsnowfall_w > 0) details.push(`Snow ${r.newsnowfall_w}.${r.newsnowfall_f}"`);
            else if (+r.snow) details.push('Snow');
            if (!details.length && r.narrative) details.push(r.narrative.slice(0, 60) + (r.narrative.length > 60 ? '...' : ''));
            if (!details.length) details.push(typeLabel(r.report_type));

            let stampStr = '';
            if (r.stamp) {
                try { stampStr = new Date(r.stamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch {}
            }

            return `
                <div style="margin-bottom:6px;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
                        <span style="font-size:10px; font-weight:700; color:${typeColor(r.report_type)}; background:rgba(255,255,255,0.08); padding:1px 5px; border-radius:4px;">${typeLabel(r.report_type)}</span>
                        ${stampStr ? `<span style="font-size:10px; color:#aaa;">${stampStr}</span>` : ''}
                        <span style="font-size:10px; color:#777;">${r.city1 || r.state || ''}</span>
                    </div>
                    <div style="font-size:11px; color:#ddd;">${details.join(' · ')}</div>
                </div>
            `;
        }).join('');

        el.innerHTML = `
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:#ff9800; margin-bottom:5px;">Recent Reports</div>
            ${items}
        `;
    })
    .catch(() => {
        const el = document.getElementById('spotter-reports-content');
        if (el) el.innerHTML = '<div style="color:#aaa; font-size:11px;">Could not load reports.</div>';
    });
}

export async function addSpotterMarkers(mapInstance) {
    _clearMarkers();

    let data;
    try {
        const res = await fetch(SPOTTER_POSITIONS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: SPOTTER_APP_ID }),
            cache: 'no-store'
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (err) {
        console.warn('[Spotters] Failed to fetch spotter positions:', err);
        return;
    }

    const positions = data?.positions ?? [];

    positions.forEach(pos => {
        const lat = parseFloat(pos.lat);
        const lng = parseFloat(pos.lon);
        if (isNaN(lat) || isNaN(lng)) return;

        const maps = [mapInstance.map];
        if (mapInstance.dualMap) maps.push(mapInstance.dualMap);

        maps.forEach(m => {
            const el = _createMarkerEl(pos);
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                _showSpotterPopup(m, [lng, lat], pos);
            });

            const marker = new maplibregl.Marker({ element: el })
                .setLngLat([lng, lat])
                .addTo(m);

            _spotterMarkers.push(marker);
        });
    });

    console.log(`[Spotters] Loaded ${positions.length} spotter positions.`);
    _checkBeacons(positions);

    _refreshTimer = setTimeout(() => addSpotterMarkers(mapInstance), REFRESH_INTERVAL_MS);
}

function _clearMarkers() {
    if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
    if (_popup) { _popup.remove(); _popup = null; }
    _spotterMarkers.forEach(m => m.remove());
    _spotterMarkers = [];
}

export function removeSpotterMarkers() {
    _clearMarkers();
    _liveBeacons = null;
}
