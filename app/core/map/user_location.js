/*
 * app/core/map/user_location.js
 * One shared source of the user's live GPS position for bundled (CommonJS)
 * code — e.g. the storm-cell impact calc. Caches the last fix on
 * window.vortexData.userLocation and keeps it fresh with a single watchPosition.
 */

let watching = false;

function get() {
    return (window.vortexData && window.vortexData.userLocation) || null;
}
function set(lng, lat) {
    window.vortexData = window.vortexData || {};
    window.vortexData.userLocation = { lng, lat, ts: Date.now() };
    return window.vortexData.userLocation;
}
function startWatch() {
    if (watching || !navigator.geolocation) return;
    watching = true;
    navigator.geolocation.watchPosition(
        (p) => set(p.coords.longitude, p.coords.latitude),
        () => {},
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
}

// Hand back a reasonably fresh location, prompting for one if we don't have it.
// cb(err, { lng, lat, ts }).
function ensure(cb) {
    const cur = get();
    if (cur && Date.now() - cur.ts < 120000) { startWatch(); cb(null, cur); return; }
    if (!navigator.geolocation) { cb(new Error('Geolocation unavailable')); return; }
    navigator.geolocation.getCurrentPosition(
        (p) => { const loc = set(p.coords.longitude, p.coords.latitude); startWatch(); cb(null, loc); },
        (err) => cb(err),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
}

module.exports = { get, set, ensure, startWatch };
