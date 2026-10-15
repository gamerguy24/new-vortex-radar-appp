/*
 * alert_actions.js — the buttons on a warning: "Radar" and "Track"
 * ────────────────────────────────────────────────────────────────────────────
 * Radar: loads the radar site nearest the warning and frames the polygon, so
 * the data behind the warning is one tap away instead of a hunt for which
 * site covers it.
 *
 * Track: hands the storm motion the forecast office wrote into the warning to
 * the Manual Storm Track tool, so nobody has to guess a speed. The motion
 * lives in the warning's eventMotionDescription parameter:
 *
 *     2026-10-15T20:22:00-00:00...storm...236DEG...38KT...35.35,-97.88
 *
 * — the time of the fix, the direction the storm is moving FROM (the
 * meteorological convention, so it is turned round to get where it is
 * heading), its speed in knots, and where it was (one point for a cell,
 * several along a line). The position is carried forward from the fix to now
 * at that speed, since a warning is often a few minutes old by the time
 * anybody taps it.
 */

const turf = require('@turf/turf');
const map = require('../core/map/map');

const KT_TO_MPH = 1.15078;
const MAX_PROJECT_MS = 2 * 60 * 60 * 1000;       // never carry a fix forward more than two hours

/**
 * The storm motion in a warning, or null if it has none (floods, watches…).
 * @returns {{ at: number|null, fromDeg: number, bearing: number, speedMph: number, points: number[][] }|null}
 */
function parseMotion(parameters) {
    let raw = parameters && parameters.eventMotionDescription;
    if (Array.isArray(raw)) raw = raw[0];
    if (!raw || typeof raw !== 'string') return null;
    const m = /^(.*?)\.\.\.[^.]*\.\.\.(\d{1,3})DEG\.\.\.(\d{1,3})KT\.\.\.(.+)$/.exec(raw.trim());
    if (!m) return null;
    const fromDeg = Number(m[2]);
    const kt = Number(m[3]);
    const points = m[4].trim().split(/\s+/).map((pair) => {
        const [lat, lon] = pair.split(',').map(Number);
        return [lon, lat];
    }).filter(([lon, lat]) => Number.isFinite(lat) && Number.isFinite(lon));
    if (!points.length || !Number.isFinite(fromDeg)) return null;
    const at = Date.parse(m[1]);
    return {
        at: Number.isFinite(at) ? at : null,
        fromDeg,
        bearing: ((fromDeg + 180) % 360 + 360) % 360,
        speedMph: kt * KT_TO_MPH,
        points,
    };
}

/** Where the storm is now: the middle of the fix, carried forward at its speed. */
function currentPosition(motion, now) {
    const mid = motion.points.length === 1
        ? motion.points[0]
        : turf.along(turf.lineString(motion.points),
            turf.length(turf.lineString(motion.points), { units: 'miles' }) / 2, { units: 'miles' }).geometry.coordinates;
    const elapsed = motion.at ? Math.min(Math.max(0, now - motion.at), MAX_PROJECT_MS) : 0;
    const miles = motion.speedMph * elapsed / 3600000;
    if (miles < 0.05) return { origin: mid, minutes: 0 };
    return {
        origin: turf.destination(turf.point(mid), miles, motion.bearing, { units: 'miles' }).geometry.coordinates,
        minutes: Math.round(elapsed / 60000),
    };
}

/** The point to measure "nearest radar" from: the storm if we know it, else the polygon's middle. */
function warningCenter(feature, fallbackLngLat) {
    try {
        if (feature && feature.geometry) return turf.centroid(feature).geometry.coordinates;
    } catch (e) { /* fall through */ }
    return fallbackLngLat ? [fallbackLngLat.lng, fallbackLngLat.lat] : null;
}

/** The nearest WSR-88D that is not reported down. */
function nearestRadar(lngLat) {
    const stations = require('../radar/station_markers/station_markers').stations_geojson();
    const status = (window.vortexData && window.vortexData.radar_station_status) || {};
    const pt = turf.point(lngLat);
    let best = null;
    for (const f of stations.features) {
        const p = f.properties;
        if (p.type !== 'WSR-88D') continue;                     // TDWRs only reach ~50 miles
        if (status[p.station_id] && status[p.station_id].status === 'down') continue;
        const d = turf.distance(pt, f, { units: 'miles' });
        if (!best || d < best.miles) best = { id: p.station_id, type: p.type, miles: d };
    }
    return best;
}

/** Load the nearest radar site and frame the warning. */
function goToRadar(feature, fallbackLngLat) {
    const motion = parseMotion(feature && feature.parameters);
    const center = motion ? currentPosition(motion, Date.now()).origin : warningCenter(feature, fallbackLngLat);
    if (!center) return;
    const site = nearestRadar(center);
    if (!site) return;

    const markers = require('../radar/station_markers/station_markers');
    require('../core/map/radar_panes').set_active_pane('main');
    markers.select_station(site.id, site.type, 'main');
    // Highlight the site's pill the way clicking it would.
    const src = map.getSource('stationSymbolLayer');
    if (src && src._data && src._data.features) {
        src._data.features.forEach((f) => { f.properties.clicked = f.properties.station_id === site.id ? 'yes' : 'no'; });
        src.setData(src._data);
    }
    try {
        const box = turf.bbox(feature.geometry ? feature : turf.point(center));
        map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 80, maxZoom: 9, duration: 900 });
    } catch (e) {
        map.flyTo({ center, zoom: 8 });
    }
}

/** Arm the storm track tool with the warning's own motion and draw it. */
function trackStorm(feature) {
    const motion = parseMotion(feature && feature.parameters);
    if (!motion) return false;
    const { origin, minutes } = currentPosition(motion, Date.now());
    const mst = require('../tools/manual_storm_track/manual_storm_track');
    // Through the toolbar icon, so it shows as on and the draw tool stands down.
    if (!mst.isActive()) $('#mstMenuItemIcon').trigger('click');
    if (!mst.isActive()) mst.enable();
    mst.trackFrom({
        origin,
        bearing: motion.bearing,
        speedMph: motion.speedMph,
        mode: motion.points.length > 1 ? 'linear' : 'cellular',
        source: (feature.event || 'warning') + (minutes ? `, position carried forward ${minutes} min` : ''),
    });
    map.flyTo({ center: origin, zoom: Math.max(map.getZoom(), 8), duration: 900 });
    return true;
}

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function motionLabel(motion) {
    return `${DIRS[Math.round(motion.bearing / 22.5) % 16]} ${Math.round(motion.speedMph)} mph`;
}

/*
 * The buttons, as HTML, for the map popup and the full-text dialog. Each
 * carries a key into `registry`; one delegated listener handles them all, so
 * the dialog — whose body is replaced wholesale — needs no rebinding.
 */
const registry = new Map();
let seq = 0;

function buttonsHtml(feature, fallbackLngLat) {
    const key = 'aa' + (++seq);
    registry.set(key, { feature, fallbackLngLat });
    if (registry.size > 50) registry.delete(registry.keys().next().value);
    const motion = parseMotion(feature.parameters);
    return `<div class="alert_popup_actions">`
        + `<button type="button" class="alert_action_btn" data-alert-act="radar" data-alert-key="${key}"`
        + ` title="Load the nearest radar site and zoom to this warning"><i class="fa-solid fa-satellite-dish"></i> Radar</button>`
        + (motion
            ? `<button type="button" class="alert_action_btn" data-alert-act="track" data-alert-key="${key}"`
              + ` title="Track this storm with the motion from the warning"><i class="fa-solid fa-route"></i> Track ${motionLabel(motion)}</button>`
            : '')
        + `</div>`;
}

$(document).on('click', '.alert_action_btn', function (e) {
    e.preventDefault();
    e.stopPropagation();
    const entry = registry.get($(this).attr('data-alert-key'));
    if (!entry) return;
    $('.vortex_popup').remove();
    $('#atcDlg').hide();
    if ($(this).attr('data-alert-act') === 'track') trackStorm(entry.feature);
    else goToRadar(entry.feature, entry.fallbackLngLat);
});

module.exports = { parseMotion, currentPosition, nearestRadar, goToRadar, trackStorm, buttonsHtml };
