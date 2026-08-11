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

// How many recent scans to load into the loop.
const NUM_FRAMES = 10;

let frames = [];        // array of L3Factory instances, ordered oldest -> newest
let idx = 0;            // index of the currently shown frame
let playing = false;
let loading = false;
let timer = null;
let speed = 1;
let loadedKey = null;   // station+product the current frames belong to

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
    if (frames[i]) { frames[i].plot(); }
}

function currentTarget() {
    const a = window.atticData || {};
    return { station: a.currentStation, product: a.current_loop_product };
}

function targetKey() {
    const t = currentTarget();
    return (t.station && t.product) ? (t.station + ':' + t.product) : null;
}

function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    playing = false;
    setIcon(false);
}

/**
 * Reset the loop. Called when a new product / station is plotted so the loop
 * never animates stale frames.
 */
function reset() {
    stop();
    frames = [];
    idx = 0;
    loadedKey = null;
    if (!loading) { setIcon(false); }
    $('#vortexTimeline').val(100);
}

function tick() {
    idx++;
    if (idx >= frames.length) { idx = 0; }
    showFrame(idx);
    updateSlider();
}

function play() {
    if (frames.length === 0) { return; }
    // stop the live auto-updater so it doesn't fight the loop
    const a = window.atticData;
    if (a && a.current_RadarUpdater) { try { a.current_RadarUpdater.disable(); } catch (e) {} }
    playing = true;
    setIcon(true);
    if (timer) { clearInterval(timer); }
    timer = setInterval(tick, frameDelayMs());
}

/**
 * Fetch + parse the most recent NUM_FRAMES scans, oldest first, then call cb(ok).
 */
function preload(cb) {
    const { station, product } = currentTarget();
    if (!station || !product) { cb(false); return; }

    setLoading(true);
    const collected = [];
    let i = NUM_FRAMES - 1; // oldest first

    function next() {
        if (i < 0) {
            frames = collected;
            idx = Math.max(0, frames.length - 1); // start on the newest frame
            loadedKey = station + ':' + product;
            setLoading(false);
            updateSlider();
            cb(frames.length > 0);
            return;
        }
        loaders.get_latest_level_3_url(station, product, i, function (url) {
            if (url) {
                loaders.return_level_3_factory_from_url(url, function (factory) {
                    collected.push(factory);
                    i--; next();
                });
            } else {
                i--; next();
            }
        });
    }
    next();
}

function onPlayClick() {
    if (loading) { return; }
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
        clearInterval(timer);
        timer = setInterval(tick, frameDelayMs());
    }
}

function init() {
    $play().off('click.vortexLoop').on('click.vortexLoop', onPlayClick);
    $('#vortexTimeline').off('input.vortexLoop').on('input.vortexLoop', onSliderInput);
    $('#vortexSpeed').off('change.vortexLoop').on('change.vortexLoop', onSpeedChange);
}

init();

module.exports = { reset, togglePlay: onPlayClick, step };
