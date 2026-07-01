/*
 * components/geolocate.js
 * "Go to my location" button on the bottom bar: uses the browser's GPS to fly
 * the map to the user's position and drop a marker. ES module, no bundling.
 */

function mapObj() { return window.vortexMap && window.vortexMap.map; }
function GL() { return window.mapboxgl || window.maplibregl; }

let _marker = null;
let _active = false;

function setActive(on) {
    _active = on;
    const icon = document.getElementById('vortexLocateBtn')?.querySelector('span');
    if (!icon) return;
    icon.classList.toggle('menu_item_selected', on);
    icon.classList.toggle('menu_item_not_selected', !on);
}

function turnOff() {
    if (_marker) { _marker.remove(); _marker = null; }
    setActive(false);
}

function toast(msg, kind) {
    const colors = { info: '#27beff', warn: '#facc15', error: '#f87171' };
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `
        position: fixed; bottom: 78px; left: 50%; transform: translateX(-50%);
        background: rgba(11,18,32,0.96); color: ${colors[kind] || colors.info};
        border: 1px solid ${colors[kind] || colors.info};
        padding: 9px 14px; border-radius: 10px; font-family: 'Onest', system-ui, sans-serif;
        font-size: 13px; z-index: 100050; box-shadow: 0 10px 30px rgba(0,0,0,0.5);`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

function setBusy(busy) {
    const icon = document.getElementById('vortexLocateIcon');
    if (!icon) return;
    if (busy) {
        icon.classList.remove('fa-location-crosshairs');
        icon.classList.add('fa-spinner', 'fa-spin');
    } else {
        icon.classList.remove('fa-spinner', 'fa-spin');
        icon.classList.add('fa-location-crosshairs');
    }
}

function locate() {
    const m = mapObj();
    if (!navigator.geolocation) { toast('Geolocation is not supported on this device.', 'warn'); return; }
    if (!m) { toast('Map is not ready yet.', 'warn'); return; }

    setBusy(true);
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            setBusy(false);
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const g = GL();
            if (g) {
                if (!_marker) {
                    const el = document.createElement('div');
                    el.className = 'vr-locate-dot';
                    _marker = new g.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
                } else {
                    _marker.setLngLat([lng, lat]);
                }
            }
            m.flyTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), 9), duration: 1200 });
            setActive(true);
        },
        (err) => {
            setBusy(false);
            setActive(false);
            toast(err.code === 1 ? 'Location permission denied.' : 'Could not get your location.', 'warn');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
}

function init() {
    const btn = document.getElementById('vortexLocateBtn');
    if (btn) btn.addEventListener('click', () => {
        // toggle: on -> off (remove marker), off -> locate
        if (_active) { turnOff(); } else { locate(); }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
