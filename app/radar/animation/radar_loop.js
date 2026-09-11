/*
 * Radar loop / playback controller for the Vortex Radar bottom bar.
 *
 * Drives the play/pause button, the timeline slider, the speed dropdown and the
 * loop-length dropdown. It preloads the most recent Level 3 scans for the
 * currently displayed station + product, then animates through them.
 *
 * Wiring lives here (rather than in the page's inline script) so it has direct
 * access to the NEXRAD loaders that fetch and parse historical scans.
 */

const loaders = require('../libnexrad/loaders_nexrad');

/*
 * How many recent scans to hold.
 *
 * 10, 25, 50 or 75, on every device, starting at 75. Measured against live
 * N0B, a parsed frame is about 1 MB, so 75 frames is roughly 80 MB held.
 *
 * Phones used to be held to five. That cap assumed memory was what crashed
 * them, and at ~1 MB a frame it is not: the crash came from the frame timer
 * piling draws up faster than a phone could finish them, and from a load that
 * could not be cancelled — both fixed below. Drawing cost is per frame SHOWN,
 * one at a time, not per frame held, so a longer loop does not make a phone
 * draw any harder. What it does cost on a phone is data: about 21 MB a loop,
 * which is why the choice is offered there rather than fixed.
 *
 * At the usual 4-6 minute scan interval, 75 frames is five to seven hours of
 * history — which is why the listing below has to be able to reach back into
 * the previous UTC day.
 */
const FRAME_CHOICES = [10, 25, 50, 75];
const DEFAULT_FRAMES = 75;
const FRAMES_KEY = 'vortexLoopFrames';

/*
 * Downloads run this many at a time. The files come straight from the Unidata
 * S3 bucket, not through our server, so this is not load on the box — it is
 * only about not queueing 75 requests in the browser at once.
 */
const CONCURRENCY = 6;

function storedFrames() {
    try {
        const n = parseInt(localStorage.getItem(FRAMES_KEY), 10);
        if (FRAME_CHOICES.includes(n)) return n;
    } catch (e) { /* storage blocked: use the default */ }
    return DEFAULT_FRAMES;
}

let chosenFrames = storedFrames();
function frameBudget() { return chosenFrames; }

let frames = [];        // array of L3Factory instances, ordered oldest -> newest
let idx = 0;            // index of the currently shown frame
let playing = false;
let loading = false;
let timer = null;
let speed = 1;
let loadedKey = null;   // station+product+length the current frames belong to

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

/*
 * "23/75" beside the controls while a long loop downloads. Ten frames arrived
 * quickly enough that a spinner was all the feedback needed; seventy-five do
 * not, and a spinner with no end in sight reads as a hang.
 */
function setProgress(done, total) {
    const el = document.getElementById('vortexLoopProgress');
    if (!el) return;
    el.textContent = (done == null) ? '' : (done + '/' + total);
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

// The loop length is part of the key: switching 10 -> 75 must fetch, not
// replay the ten already held.
function targetKey() {
    const t = currentTarget();
    return (t.station && t.product) ? (t.station + ':' + t.product + ':' + frameBudget()) : null;
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
    // A load in flight has just been abandoned by stop(). Clear its spinner
    // too: the abandoned run returns without touching the UI, so otherwise the
    // button kept spinning and the next tap only cancelled a load that was
    // already dead.
    if (loading) { setLoading(false); setProgress(null); }
    // Drop the references explicitly: these are the largest objects the app
    // holds, and on a phone the difference between releasing them now and at
    // the next collection is the difference between playing and crashing.
    frames.length = 0;
    frames = [];
    idx = 0;
    loadedKey = null;
    setIcon(false);
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
 *
 * This used to ask for one frame at a time, and each ask re-downloaded the
 * whole day's bucket listing to find it — two requests per frame, strictly in
 * sequence. Fine at ten; at seventy-five that is 150 round trips back to back.
 * Now it lists ONCE (reaching into the previous day if it has to), then
 * downloads the scans several at a time, keeping them in time order.
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
    const want = frameBudget();

    setLoading(true);

    function finish(ok) {
        if (stale()) return;      // a newer run owns the UI now
        setProgress(null);
        setLoading(false);
        cb(ok);
    }

    (async () => {
        let urls;
        try {
            urls = await loaders.list_level_3_urls(station, product, want);
        } catch (e) {
            console.warn('[loop] could not list scans:', e && e.message);
            urls = [];
        }
        if (stale()) return;

        /*
         * null means this product has no history to loop through (VIL and the
         * legacy products come from tgftp's sn.last, which is only ever the
         * newest file). The old code fetched that same file N times and played
         * it as an "animation" of identical frames. One honest frame is better.
         */
        if (urls === null) {
            const one = await new Promise((res) => loaders.get_latest_level_3_url(station, product, 0, (u) => res(u)));
            if (stale()) return;
            urls = one ? [one] : [];
        }
        if (!urls.length) { finish(false); return; }

        const out = new Array(urls.length).fill(null);
        let nextIndex = 0;
        let done = 0;
        setProgress(0, urls.length);

        async function worker() {
            while (!stale() && nextIndex < urls.length) {
                const i = nextIndex++;
                // Resolves null on failure rather than hanging: one dropped
                // request costs one frame, not the whole load.
                out[i] = await loaders.level_3_factory_from_url_async(urls[i]);
                done++;
                if (!stale()) setProgress(done, urls.length);
            }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
        if (stale()) return;

        frames = out.filter(Boolean);
        if (frames.length < urls.length) {
            console.warn('[loop] ' + (urls.length - frames.length) + ' of ' + urls.length + ' scans failed to load and were skipped');
        }
        idx = Math.max(0, frames.length - 1); // start on the newest frame
        loadedKey = station + ':' + product + ':' + want;
        updateSlider();
        finish(frames.length > 0);
    })();
}

function onPlayClick() {
    /*
     * Tapping while it is still loading cancels, rather than doing nothing.
     * Sequential downloads on a phone connection took long enough that an
     * unresponsive button read as a frozen app — and there was no way to stop
     * the fetch once started.
     */
    if (loading) {
        generation++;
        setLoading(false);
        setProgress(null);
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

/*
 * Change the loop length. Whatever is held is for the old length, so it is
 * dropped; if the loop was playing (or loading), it reloads at the new length
 * and carries on, rather than making the user press play again.
 */
function onFramesChange() {
    const n = parseInt($('#vortexFrames').val(), 10);
    if (!FRAME_CHOICES.includes(n)) return;
    chosenFrames = n;
    try { localStorage.setItem(FRAMES_KEY, String(n)); } catch (e) { /* not remembered, still applied */ }
    const resume = playing || loading;
    reset();
    if (resume) onPlayClick();
}

function init() {
    $play().off('click.vortexLoop').on('click.vortexLoop', onPlayClick);
    $('#vortexTimeline').off('input.vortexLoop').on('input.vortexLoop', onSliderInput);
    $('#vortexSpeed').off('change.vortexLoop').on('change.vortexLoop', onSpeedChange);

    const $frames = $('#vortexFrames');
    $frames.val(String(chosenFrames));
    $frames.off('change.vortexLoop').on('change.vortexLoop', onFramesChange);
}

init();

/*
 * The real frame count and position, for readouts that want them. The slider
 * is a 0-100 percentage track, so anything reading its range to count frames
 * gets 101 whatever the loop holds.
 */
if (typeof window !== 'undefined') {
    window.vortexLoop = {
        get count() { return frames.length; },
        get index() { return idx; },
        get loading() { return loading; },
        get budget() { return frameBudget(); },
    };
}

module.exports = { reset, togglePlay: onPlayClick, step };
