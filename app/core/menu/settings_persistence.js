/*
 * app/core/menu/settings_persistence.js
 *
 * Persists every Settings-menu toggle to the signed-in user's account so their
 * configuration survives closing the app, refreshes and app updates — and
 * follows them across devices. Stored server-side via /api/settings, mirroring
 * the per-user logo / report / push-token storage in server.js.
 *
 *   - On startup:  fetch the saved switch states and replay them, so the map
 *                  comes up exactly how the user last left it.
 *   - On change:   debounce-save a full snapshot the moment any toggle flips.
 *   - On close:    a final synchronous save via sendBeacon, so a last-second
 *                  tweak is never lost when the tab/app is closed or hidden.
 *
 * Every settings toggle is an <input type="checkbox"> whose id starts with
 * "armr" and ends with "SwitchElem"; we discover them from the DOM so new
 * toggles are picked up automatically with no changes here.
 */

const ENDPOINT = '/api/settings';
const SWITCH_SELECTOR = 'input[type="checkbox"][id^="armr"][id$="SwitchElem"]';
const SWITCH_ID_RE = /^armr[A-Za-z0-9_-]*SwitchElem$/;
const SAVE_DEBOUNCE_MS = 600;

// True while we're programmatically replaying saved state, so the change
// listener doesn't echo those toggles straight back to the server.
let _restoring = false;
let _saveTimer = null;

// Read the current state of every settings toggle into { switches: { id: bool } }.
function collect() {
    const switches = {};
    document.querySelectorAll(SWITCH_SELECTOR).forEach(function(el) {
        if (el.id && !(el.id in switches)) { switches[el.id] = !!el.checked; }
    });
    return { switches };
}

// Replay saved state. Clicking a switch (rather than just setting .checked)
// runs the handler that applies the visual effect — exactly what the user did
// when they set it — so the map, layers and fetches all follow along.
function apply(saved) {
    if (!saved || !saved.switches) { return; }
    _restoring = true;
    try {
        Object.keys(saved.switches).forEach(function(id) {
            if (!SWITCH_ID_RE.test(id)) { return; }
            const el = document.getElementById(id);
            if (!el) { return; } // toggle not present yet (e.g. a dynamic SPC row)
            if (!!el.checked !== !!saved.switches[id]) { el.click(); }
        });
    } finally {
        _restoring = false;
    }
}

function saveNow() {
    // A normal (credentialed) POST. Fire-and-forget: if the user is offline or
    // signed out it simply fails, and the next change / the close beacon retries.
    fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(collect()),
    }).catch(function() {});
}

function scheduleSave() {
    if (_restoring) { return; }
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

// Synchronous, close-safe save. sendBeacon can only POST, which is why the
// server accepts settings on POST.
function saveOnExit() {
    try {
        const blob = new Blob([JSON.stringify(collect())], { type: 'application/json' });
        if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) { return; }
    } catch (e) {}
    // Fallback for environments without sendBeacon.
    saveNow();
}

async function init() {
    // 1) Restore saved state as soon as we can.
    try {
        const res = await fetch(ENDPOINT, {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
        });
        if (res.ok) {
            const data = await res.json();
            apply(data && data.settings);
        }
    } catch (e) { /* not signed in / offline — start from defaults */ }

    // 2) Save immediately whenever any settings toggle changes (capture phase so
    //    it runs regardless of other handlers). Debounced to coalesce bursts.
    document.addEventListener('change', function(e) {
        const t = e.target;
        if (t && t.id && SWITCH_ID_RE.test(t.id)) { scheduleSave(); }
    }, true);

    // 3) Final flush on close / background so nothing is lost.
    window.addEventListener('pagehide', saveOnExit);
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') { saveOnExit(); }
    });
}

module.exports = { init, collect, apply };
