/*
 * js/layer_utils.js
 * Small helpers shared by map overlay layers (e.g. metar.js). Written to be
 * safe on this app's Mapbox GL map wrapper (window.vortexMap = { map, dualMap }).
 * The base radar layer in this app is 'radar-webgl' (see components/mrms.js).
 */

const RADAR_LAYER_ID = 'radar-webgl';

// True once the map has a style we can add sources/layers to.
export function hasUsableMapStyle(map) {
    try {
        return !!(map && typeof map.isStyleLoaded === 'function' && map.isStyleLoaded());
    } catch {
        return false;
    }
}

// Resolves when the map style is ready (or immediately if it already is).
// Falls back on a timeout so callers never hang if no style event fires.
export function waitForMapStyleReady(map) {
    return new Promise((resolve) => {
        if (hasUsableMapStyle(map)) return resolve();
        if (!map || typeof map.once !== 'function') return resolve();
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        map.once('style.load', done);
        map.once('load', done);
        setTimeout(done, 8000);
    });
}

// Resolves once the base radar layer exists (so overlays draw above it), or
// after a bounded wait so we never block when radar isn't loaded.
export function waitForRadarLayer(map /* , target */) {
    return new Promise((resolve) => {
        let tries = 0;
        const check = () => {
            try { if (map && map.getLayer && map.getLayer(RADAR_LAYER_ID)) return resolve(); } catch {}
            if (++tries > 30) return resolve(); // ~3 s max
            setTimeout(check, 100);
        };
        check();
    });
}

// If a known overlay layer is present, return its id so a new layer is inserted
// beneath it; otherwise undefined (add on top). Keeps station markers from
// covering alert/outline overlays when those exist.
export function getWeatherOutlineBeforeLayerId(map /* , target */) {
    const CANDIDATES = ['weather-outline', 'alerts-outline', 'alert-outline'];
    try {
        for (const id of CANDIDATES) {
            if (map && map.getLayer && map.getLayer(id)) return id;
        }
    } catch {}
    return undefined;
}
