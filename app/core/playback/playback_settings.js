/*
 * playback_settings.js
 * How a loop plays — how many frames it holds, how fast it runs, which way,
 * how long it rests at the end, and whether the map follows your GPS while it
 * plays — held in one place and shared.
 *
 * The radar loop and the satellite loop run on separate clocks, and both read
 * these, so a choice made in Settings › Playback applies to whichever of them
 * is playing. It is also put on window.vortexPlayback for the unbundled
 * components (geolocate.js) that cannot require() it.
 */

const KEY = 'vortexPlayback';
// Where the loop length was kept before there were other settings beside it.
const LEGACY_FRAMES_KEY = 'vortexLoopFrames';

const FRAME_CHOICES = [10, 25, 50, 75, 100];
/*
 * The speed slider's stops, as multiples of each loop's own base rate. Steps
 * rather than a continuous value so the bottom bar's dropdown can always show
 * exactly what the slider chose.
 */
const SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const DIRECTIONS = ['forward', 'backward', 'rock'];
const PAUSE_MAX_MS = 3000;

const DEFAULTS = { frames: 75, speed: 1, direction: 'forward', loopPause: 500, track: false };

function valid(key, v) {
    switch (key) {
        case 'frames': return FRAME_CHOICES.includes(v);
        case 'speed': return SPEED_STEPS.includes(v);
        case 'direction': return DIRECTIONS.includes(v);
        case 'loopPause': return Number.isFinite(v) && v >= 0 && v <= PAUSE_MAX_MS;
        case 'track': return typeof v === 'boolean';
        default: return false;
    }
}

function load() {
    const out = Object.assign({}, DEFAULTS);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* storage blocked or garbled */ }
    if (saved && typeof saved === 'object') {
        for (const k of Object.keys(DEFAULTS)) {
            if (valid(k, saved[k])) out[k] = saved[k];
        }
    } else {
        // First run with these settings: keep the loop length chosen before.
        try {
            const n = parseInt(localStorage.getItem(LEGACY_FRAMES_KEY), 10);
            if (valid('frames', n)) out.frames = n;
        } catch (e) { /* use the default */ }
    }
    return out;
}

const state = load();
const listeners = [];

function get() { return Object.assign({}, state); }

function set(key, value) {
    if (!valid(key, value) || state[key] === value) return;
    state[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* not remembered, still applied */ }
    for (const fn of listeners.slice()) {
        try { fn(key, value, get()); } catch (e) { console.warn('[playback] listener failed:', e); }
    }
}

function on(fn) { listeners.push(fn); }

/*
 * The frame after `i` of `n`, in the chosen direction, and whether it is the
 * end of a pass — the frame the loop rests on before going round again.
 *
 * `memo` carries the rock direction between calls; give each loop its own.
 * Forwards rests on the newest frame, backwards on the oldest, and rock on both.
 */
function advance(i, n, memo) {
    if (n < 2) return { index: 0, end: true };
    const dir = state.direction;
    if (dir === 'backward') {
        const next = i <= 0 ? n - 1 : Math.min(i, n) - 1;
        return { index: next, end: next === 0 };
    }
    if (dir === 'rock') {
        let sign = (memo && memo.sign) || 1;
        let next = i + sign;
        if (next >= n || next < 0) { sign = -sign; next = i + sign; }
        next = Math.max(0, Math.min(n - 1, next));
        if (memo) memo.sign = sign;
        return { index: next, end: next === 0 || next === n - 1 };
    }
    const next = (i + 1) % n;
    return { index: next, end: next === n - 1 };
}

/* How long to hold a frame: the loop's own base rate, scaled by the speed,
   plus the loop pause when the frame ends a pass. */
function holdMs(baseMs, end) {
    return Math.round(baseMs / state.speed) + (end ? state.loopPause : 0);
}

/*
 * Which loops are playing right now, by name, so things that care whether
 * anything is animating (following your GPS, for one) need not know about
 * each loop separately.
 */
const playing = new Set();
function setPlaying(name, on) {
    if (on) playing.add(name); else playing.delete(name);
}
function isPlaying() { return playing.size > 0; }

const api = {
    FRAME_CHOICES, SPEED_STEPS, DIRECTIONS, PAUSE_MAX_MS,
    get, set, on, advance, holdMs, setPlaying, isPlaying,
};

if (typeof window !== 'undefined') window.vortexPlayback = api;

module.exports = api;
