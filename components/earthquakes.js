/*
 * earthquakes.js
 * Fetches and displays USGS earthquake data on the map.
 * Data: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson
 * Shows M2.5+ earthquakes from the past 7 days.
 * Auto-refreshes every 15 minutes.
 *
 * (c) 2026 Tyler G (@tgranz)
 * See LICENSE for more.
 */

const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let _markers = [];
let _popupEl = null;
let _active = false;
let _refreshTimer = null;
let _currentMap = null;

/**
 * Fetch and show earthquake markers on the map.
 */
export function addEarthquakes(mapInstance) {
    _active = true;
    _currentMap = mapInstance;
    _load(mapInstance.map);

    clearInterval(_refreshTimer);
    _refreshTimer = setInterval(() => {
        if (_active) _load(_currentMap.map);
    }, REFRESH_INTERVAL_MS);
}

/**
 * Remove all earthquake markers and stop refresh.
 */
export function removeEarthquakes() {
    _active = false;
    clearInterval(_refreshTimer);
    _refreshTimer = null;
    _currentMap = null;
    _clearMarkers();
    _closePopup();
}

// --- Internal helpers -------------------------------------------------------

function _clearMarkers() {
    _markers.forEach(m => m.remove());
    _markers = [];
}

function _closePopup() {
    if (_popupEl && _popupEl.parentNode) {
        _popupEl.parentNode.removeChild(_popupEl);
    }
    _popupEl = null;
}

function _magColor(mag) {
    if (mag >= 7)   return '#ff2020'; // major - bright red
    if (mag >= 5)   return '#ff6600'; // strong - orange
    if (mag >= 4)   return '#ffcc00'; // moderate - yellow
    if (mag >= 3)   return '#a3e635'; // minor - lime
    return                '#60d6ff';  // micro - sky blue
}

function _magSize(mag) {
    if (mag >= 6)  return 26;
    if (mag >= 5)  return 22;
    if (mag >= 4)  return 18;
    if (mag >= 3)  return 14;
    return                11;
}

function _timeAgo(epochMs) {
    const diff = Date.now() - epochMs;
    const mins = Math.floor(diff / 60000);
    if (mins < 60)   return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)    return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

async function _load(map) {
    try {
        const resp = await fetch(FEED_URL, {
            cache: 'no-store',
            signal: AbortSignal.timeout(10000)
        });
        if (!resp.ok || !_active) return;

        const data = await resp.json();
        if (!_active) return;

        _clearMarkers();
        _closePopup();

        for (const feature of data.features) {
            if (!_active) return;

            const { mag, place, time, tsunami } = feature.properties;
            const [lon, lat, depth] = feature.geometry.coordinates;
            if (mag == null || lon == null || lat == null) continue;

            const color = _magColor(mag);
            const size  = _magSize(mag);

            const el = document.createElement('div');
            el.className = 'eq-marker';
            el.style.width  = `${size}px`;
            el.style.height = `${size}px`;
            el.style.borderColor = color;
            el.style.boxShadow = `0 0 6px ${color}88`;
            if (mag >= 5) el.style.animation = 'eq-pulse 1.8s ease-in-out infinite';

            const label = document.createElement('span');
            label.className = 'eq-mag-label';
            label.textContent = mag.toFixed(1);
            label.style.color = color;
            el.appendChild(label);

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                _showPopup(lon, lat, mag, place, time, depth, tsunami, map);
            });

            const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat([lon, lat])
                .addTo(map);

            _markers.push(marker);
        }
    } catch (err) {
        console.error('[Earthquakes] Failed to load:', err);
    }
}

function _showPopup(lon, lat, mag, place, time, depth, tsunami, map) {
    _closePopup();

    const depthKm   = depth != null ? `${depth.toFixed(1)} km` : 'N/A';
    const timeStr   = time  ? _timeAgo(time) : '';
    const tsunamiStr = tsunami ? '<p class="eq-popup-tsunami">⚠️ Tsunami alert issued</p>' : '';

    const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '260px',
        className: 'eq-popup'
    })
        .setLngLat([lon, lat])
        .setHTML(`
            <div class="eq-popup-content">
                <div class="eq-popup-mag" style="color:${_magColor(mag)}">M${mag.toFixed(1)}</div>
                <div class="eq-popup-place">${place || 'Unknown location'}</div>
                <div class="eq-popup-meta">Depth: ${depthKm} &nbsp;&middot;&nbsp; ${timeStr}</div>
                ${tsunamiStr}
            </div>
        `)
        .addTo(map);

    // Keep reference so we can close it on layer removal
    _popupEl = popup.getElement();
    popup.on('close', () => { _popupEl = null; });
}
