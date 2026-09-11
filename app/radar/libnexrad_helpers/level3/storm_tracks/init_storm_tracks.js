/*
 * Storm tracks (NST) and tornado vortex signatures (NTV) for the main radar.
 *
 * WHY THIS WAS FLASHING FOR EVERYONE
 * plot_to_map calls fetch_data() on every main-map radar plot — every live
 * refresh, and every frame of a loop. Each call fetched both products and ran:
 *
 *     window.vortexData.current_storm_track_id == file_id;   // compares, discards
 *     deal_with_storm_track_layers();                        // removes every layer
 *     _plot();                                               // adds them all back
 *
 * `==` where `=` was meant. The "already drawn this file" guard never recorded
 * anything, so it always passed, and every plot tore every storm-track and TVS
 * layer down and rebuilt it. Mapbox has to re-parse a rebuilt GeoJSON source
 * before it can draw it, so for a frame or two the tracks were simply gone: a
 * blink on every radar update, and several a second while a loop played.
 *
 * Three changes, each of which would have helped on its own:
 *   1. the file id is actually recorded, so an unchanged file is not redrawn
 *   2. the products are fetched at most once a minute per station, not on
 *      every plot — they change once a volume scan, not once a loop frame
 *   3. the plotters update their sources in place (setData) instead of deleting
 *      and re-adding layers, so even a genuine update does not blink
 */

const REFRESH_MS = 60 * 1000;      // NST/NTV change once a volume scan, ~4-6 min
/*
 * How long an unanswered request blocks another. Shorter than the refresh on
 * purpose: in normal running the minute's throttle is what spaces requests,
 * and a request that hangs is simply retried at the next refresh — a minute
 * after it started, never stalling refreshes for good. This only bites when
 * something resets the throttle mid-flight (a clear from upload mode), where
 * it stops a second request piling onto one that is still pending.
 */
const IN_FLIGHT_MS = 30 * 1000;

const EMPTY = { type: 'FeatureCollection', features: [] };

let lastStation = null;
let lastFetchAt = 0;
let inFlightSince = 0;

/* Blank a set of layers' data without removing them — no rebuild, no blink. */
function _empty_layers(ids) {
    const map = require('../../../../core/map/map');
    for (const id of ids || []) {
        const src = map.getSource(id);
        if (src && src.setData) src.setData(EMPTY);
    }
}

function _clear_storm_tracks() {
    _empty_layers(window.vortexData.storm_track_layers);
    window.vortexData.current_storm_track_id = null;   // so the next real file draws
}

function _clear_tvs() {
    _empty_layers(window.vortexData.tvs_layers);
    window.vortexData.current_tvs_id = null;
}

/*
 * Fetch one product and draw it if it is a file we have not drawn yet.
 * `done` is called exactly once on every path — including "nothing new" — so
 * the caller can chain the next product and clear its in-flight marker.
 */
function _load_storm_track_product(product, station, done) {
    // imports have to be inside function for some reason
    const loaders_nexrad = require('../../../libnexrad/loaders_nexrad');

    let finished = false;
    const finish = () => { if (!finished) { finished = true; done(); } };
    const clear = product === 'NST' ? _clear_storm_tracks : _clear_tvs;
    const idKey = product === 'NST' ? 'current_storm_track_id' : 'current_tvs_id';

    loaders_nexrad.get_latest_level_3_url(station, product, 0, (url) => {
        // The user may have moved to another radar while this was in flight;
        // the old site's tracks must not be drawn over the new one.
        if (window.vortexData.currentStation !== station) { finish(); return; }
        if (url == null) { clear(); finish(); return; }   // nothing here yet

        loaders_nexrad.return_level_3_factory_from_url(url, (L3Factory) => {
            if (window.vortexData.currentStation !== station) { finish(); return; }
            if (!L3Factory || L3Factory.get_file_age_in_minutes() > 30) {
                clear();
                finish();
                return;
            }

            const file_id = L3Factory.generate_unique_id();
            if (window.vortexData[idKey] !== file_id) {
                window.vortexData[idKey] = file_id;
                console.log(product === 'NTV' ? 'Tornado Vortex Signature:' : 'Storm Tracks:', L3Factory);
                L3Factory.plot();   // the plotters update in place; see them
            }
            finish();
        });
    });
}

/*
 * Exported clears, for callers outside this module (file upload mode). They
 * also forget the last fetch, so coming back to live data refetches at once
 * rather than showing no tracks for up to a minute.
 *
 * The internal "no data" clears above deliberately do NOT do that: a station
 * with no storms is the normal case in quiet weather, and resetting the timer
 * there would put back a fetch on every radar plot.
 */
function deal_with_storm_track_layers() {
    _clear_storm_tracks();
    lastFetchAt = 0;
}

function deal_with_tvs_layers() {
    _clear_tvs();
    lastFetchAt = 0;
}

function fetch_data() {
    const station = window.vortexData && window.vortexData.currentStation;
    if (!station) return;
    const now = Date.now();

    if (station !== lastStation) {
        // A different radar: what is drawn belongs to the old one. Clear it now
        // rather than leave it until the new site's files arrive.
        _clear_storm_tracks();
        _clear_tvs();
        lastStation = station;
        lastFetchAt = 0;
        inFlightSince = 0;
    }

    if (inFlightSince && now - inFlightSince < IN_FLIGHT_MS) return;
    if (now - lastFetchAt < REFRESH_MS) return;

    lastFetchAt = now;
    inFlightSince = now;
    _load_storm_track_product('NST', station, () => {
        /*
         * TVS is fetched whether or not the storm tracks changed. It used to
         * run only after NST had just been redrawn — harmless while the broken
         * guard redrew NST every time, but with the guard working it would have
         * left TVS stuck on the first file it ever saw.
         */
        _load_storm_track_product('NTV', station, () => { inFlightSince = 0; });
    });
}

module.exports = {
    fetch_data,
    deal_with_storm_track_layers,
    deal_with_tvs_layers
};
