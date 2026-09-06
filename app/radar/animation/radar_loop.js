/*
 * Radar loop / playback controller for the Vortex Radar bottom bar.
 *
 * Drives the play/pause button, the timeline slider, and the speed dropdown.
 * It preloads the most recent Level 3 scans for the currently displayed
 * station + product, then animates through them.
 *
 * Wiring lives here (rather than in the page's inline script) so it has direct
 * access to the NEXRAD loaders that fetch and parse historical scans.
 */

const loaders = require('../libnexrad/loaders_nexrad');

/*
 * How many recent scans to hold.
 *
 * Every frame is a parsed Level 3 factory kept in memory at once, and on a
 * phone ten super-res sweeps is enough to exhaust the tab and take the browser
 * — sometimes the phone — down with it. Desktop keeps the full loop; phones get
 * a shorter one, which is also all that fits on a small timeline usefully.
 */
const NUM_FRAMES_DESKTOP = 10;
const NUM_FRAMES_MOBILE = 5;

// Read once: this decides a memory budget, not a layout, so it does not need to
// react to rotation.
const IS_MOBILE = (typeof window !== 'undefined')
    && (window.innerWidth <= 760
        || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));

function frameBudget() { return IS_MOBILE ? NUM_FRAMES_MOBILE : NUM_FRAMES_DESKTOP; }

let frames = [];        // array of L3Factory instances, ordered oldest -> newest
let idx = 0;            // index of the currently shown frame
let playing = false;
let loading = false;
let timer = null;
let speed = 1;
let loadedKey = null;   // station+product the current frames belong to

/*
 * Bumped whenever the loop is reset, stopped or retargeted. A preload in
 * flight compares its own token before doing anything, so a run the user has
 * moved on from cannot push stale frames in or keep fetching in the background.
 * Without this, tapping play, pausing, and changing product left the old
 * request chain running and racing the new one — a fast route to a frozen tab
 * on a phone, where the downloads are slow enough to overlap.
 */
let generation = 0;

function $play() { return $('#vortexPlayBtn'); }
function frameDelayMs() { return Math.round(750 / speed); }

function setIcon(isPlaying) {
    const icon = $play().find('i');
    icon.toggleClass('fa-play', !isPlaying).toggleClass('fa-pause', isPlaying);
    $play().toggleClass('vortexPlaying', isPlaying);
}

function setLoading(isLoading) {
    loading = isLoading;
    const icon = $play().find('i');
    $play().toggleClass('vortexLoading', isLoading);
    if (isLoading) {
        icon.removeClass('fa-play fa-pause').addClass('fa-spinner fa-spin');
    } else {
        icon.removeClass('fa-spinner fa-spin');
    }
}

function updateSlider() {
    if (frames.length <= 1) { return; }
    $('#vortexTimeline').val(Math.round((idx / (frames.length - 1)) * 100));
}

function showFrame(i) {
    if (!frames[i]) return;
    /*
     * A single frame that fails to plot should cost that frame, not the whole
     * loop. Before this, one bad sweep threw out of the timer callback and
     * playback stopped with the button still showing pause.
     */
    try {
        frames[i].plot();
    } catch (e) {
        console.warn('[loop] frame ' + i + ' failed to plot:', e);
    }
}

function currentTarget() {
    const a = window.vortexData || {};
    return { station: a.currentStation, product: a.current_loop_product };
}

function targetKey() {
    const t = currentTarget();
    return (t.station && t.product) ? (t.station + ':' + t.product) : null;
}

function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
    playing = false;
    generation++;              // abandon any preload still running
    setIcon(false);
}

/**
 * Reset the loop. Called when a new product / station is plotted so the loop
 * never animates stale frames.
 */
function reset() {
    stop();
    // Drop the references explicitly: these are the largest objects the app
    // holds, and on a phone the difference between releasing them now and at
    // the next collection is the difference between playing and crashing.
    frames.length = 0;
    frames = [];
    idx = 0;
    loadedKey = null;
    if (!loading) { setIcon(false); }
    $('#vortexTimeline').val(100);
}

/*
 * Advance one frame, then schedule the next AFTER this one has been drawn.
 *
 * This used to be a setInterval. Plotting a sweep on a phone can take longer
 * than the frame delay, and setInterval does not care — it keeps firing, the
 * callbacks pile up behind each other, and the tab locks solid. Chaining a
 * timeout means a slow device simply plays slower, which is the correct way to
 * degrade.
 */
function tick() {
    if (!playing) return;
    idx++;
    if (idx >= frames.length) { idx = 0; }
    showFrame(idx);
    updateSlider();
    if (playing) {
        timer = setTimeout(tick, frameDelayMs());
    }
}

function play() {
    if (frames.length === 0) { return; }
    // stop the live auto-updater so it doesn't fight the loop
    const a = window.vortexData;
    if (a && a.current_RadarUpdater) { try { a.current_RadarUpdater.disable(); } catch (e) {} }
    playing = true;
    setIcon(true);
    if (timer) { clearTimeout(timer); timer = null; }
    timer = setTimeout(tick, frameDelayMs());
}

/**
 * Fetch + parse the most recent frameBudget() scans, oldest first, then
 * call cb(ok). Cancellable: see `generation`.
 */
function preload(cb) {
    const { station, product } = currentTarget();
    if (!station || !product) { cb(false); return; }

    // Release the previous loop's frames BEFORE pulling a new set in, so the
    // two sets are never both resident. On a phone holding both is what
    // pushed the tab over the edge.
    frames.length = 0;
    frames = [];

    const myGeneration = ++generation;
    const stale = () => myGeneration !== generation;

    setLoading(true);
    const collected = [];
    let i = frameBudget() - 1; // oldest first

    function finish(ok) {
        if (stale()) return;      // a newer run owns the UI now
        setLoading(false);
        cb(ok);
    }

    function next() {
        if (stale()) { return; }  // abandoned: stop fetching, touch nothing
        if (i < 0) {
            frames = collected;
            idx = Math.max(0, frames.length - 1); // start on the newest frame
            loadedKey = station + ':' + product;
            updateSlider();
            finish(frames.length > 0);
            return;
        }
        loaders.get_latest_level_3_url(station, product, i, function (url) {
            if (stale()) { return; }
            if (!url) { i--; next(); return; }
            loaders.return_level_3_factory_from_url(url, function (factory) {
                if (stale()) { return; }
                if (factory) collected.push(factory);
                i--; next();
            });
        });
    }
    next();
}

function onPlayClick() {
    /*
     * Tapping while it is still loading cancels, rather than doing nothing.
     * Ten sequential downloads on a phone connection take long enough that an
     * unresponsive button reads as a frozen app — and the old code gave no way
     * to stop the fetch it had started.
     */
    if (loading) {
        generation++;
        setLoading(false);
        setIcon(false);
        return;
    }
    if (playing) { stop(); return; }

    const key = targetKey();
    if (!key) { return; } // nothing plotted yet

    if (frames.length > 0 && loadedKey === key) {
        play();
    } else {
        preload(function (ok) {
            if (ok) { play(); }
            else { setIcon(false); }
        });
    }
}

// Step one frame back/forward (pauses the loop). Returns true if it handled the
// step (a loop is loaded); false lets the caller fall back (e.g. map panning).
function step(dir) {
    if (frames.length === 0) { return false; }
    stop();
    idx = (idx + dir + frames.length) % frames.length;
    showFrame(idx);
    updateSlider();
    return true;
}

function onSliderInput() {
    if (frames.length === 0) { return; }
    stop();
    const v = parseInt($('#vortexTimeline').val(), 10) || 0;
    idx = Math.round((v / 100) * (frames.length - 1));
    showFrame(idx);
}

function onSpeedChange() {
    speed = parseFloat($('#vortexSpeed').val()) || 1;
    if (playing) {
        // Reschedule on the new delay. Changing speed mid-play used to leave an
        // interval running as well as start another, so the loop ran at both
        // speeds at once and drew twice per frame.
        clearTimeout(timer);
        timer = setTimeout(tick, frameDelayMs());
    }
}

function init() {
    $play().off('click.vortexLoop').on('click.vortexLoop', onPlayClick);
    $('#vortexTimeline').off('input.vortexLoop').on('input.vortexLoop', onSliderInput);
    $('#vortexSpeed').off('change.vortexLoop').on('change.vortexLoop', onSpeedChange);
}

init();

module.exports = { reset, togglePlay: onPlayClick, step };
