/*
 * pds.js
 * Particularly Dangerous Situation warnings, and the emergencies above them:
 * finding them in the NWS feed, and making them flash on the map.
 *
 * WHAT COUNTS, and only what the NWS itself said — nothing is inferred:
 *
 *   emergency  A Tornado Emergency (tornadoDamageThreat CATASTROPHIC, the tag
 *              an office sets when it declares one, or the words in the
 *              text) or a Flash Flood Emergency (flashFloodDamageThreat
 *              CATASTROPHIC, or the words).
 *   pds        A tornado warning tagged CONSIDERABLE damage threat — the IBW
 *              tag that IS the PDS tornado warning — or any alert whose
 *              headline or text says "particularly dangerous situation".
 *              That second test is what catches PDS tornado and severe
 *              thunderstorm watches, and the odd PDS red flag warning.
 *
 * The broadcast's storm_director.js makes the same call for the 24/7 channel.
 */

const map = require('../core/map/map');

const PDS_COLOR = 'rgb(255, 0, 255)';           // magenta, the usual PDS colour
const EMERGENCY_COLOR = 'rgb(170, 60, 255)';    // violet, a step past it
const SWITCH = '#armrPdsBtnSwitchElem';

const LINE_LAYER = 'alertsPdsLayer';
const FILL_LAYER = 'alertsPdsFill';
const LAYERS = [FILL_LAYER, LINE_LAYER];

function first(v) { return Array.isArray(v) ? v[0] : v; }
function upper(v) { return String(first(v) || '').toUpperCase(); }

/** 'emergency', 'pds', or null, from an alert's properties. */
function classify(props) {
    const p = props || {};
    let params = p.parameters || {};
    // Properties that have been through the map come back with objects as strings.
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch (e) { params = {}; } }
    const event = String(p.event || '');
    const text = [first(params.NWSheadline), p.headline, p.description]
        .map((s) => String(s || '')).join(' ').toUpperCase();

    if (event === 'Tornado Warning') {
        if (upper(params.tornadoDamageThreat) === 'CATASTROPHIC' || text.includes('TORNADO EMERGENCY')) return 'emergency';
        if (upper(params.tornadoDamageThreat) === 'CONSIDERABLE') return 'pds';
    }
    if (/Flash Flood Warning|Flash Flood Statement/.test(event)) {
        if (upper(params.flashFloodDamageThreat) === 'CATASTROPHIC' || text.includes('FLASH FLOOD EMERGENCY')) return 'emergency';
    }
    if (text.includes('PARTICULARLY DANGEROUS SITUATION')) return 'pds';
    return null;
}

/* The label for a badge: what the office called it. */
function label(threat, event) {
    if (threat === 'emergency') return /Flood/.test(event || '') ? 'FLASH FLOOD EMERGENCY' : 'TORNADO EMERGENCY';
    if (threat === 'pds') return 'PARTICULARLY DANGEROUS SITUATION';
    return '';
}

function colorFor(threat) {
    return threat === 'emergency' ? EMERGENCY_COLOR : threat === 'pds' ? PDS_COLOR : null;
}

/* The switch in Settings › Alerts. Missing (a page without it) means on. */
function enabled() {
    const el = document.querySelector(SWITCH);
    return el ? el.checked : true;
}

/*
 * The two layers that carry the flash: a thick outline drawn over every other
 * alert line, and a wash of the same colour inside a warning. They read the
 * same source as the ordinary alert layers, filtered to PDS and emergencies,
 * so they need no data of their own.
 */
const IS_PDS = ['all',
    ['==', ['get', 'type'], 'outline'],
    ['match', ['coalesce', ['get', 'threat'], ''], ['pds', 'emergency'], true, false],
];

function addLayers() {
    if (!map.getSource('alertsSource')) return;
    if (!map.getLayer(FILL_LAYER)) {
        map.addLayer({
            id: FILL_LAYER, type: 'fill', source: 'alertsSource',
            // A watch already has its own shading; only warnings get the wash.
            filter: ['all', IS_PDS, ['!=', ['get', 'is_watch'], true]],
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0, 'fill-opacity-transition': { duration: 0 } },
        });
    }
    if (!map.getLayer(LINE_LAYER)) {
        map.addLayer({
            id: LINE_LAYER, type: 'line', source: 'alertsSource',
            filter: IS_PDS,
            layout: { 'line-join': 'round' },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': 4,
                'line-opacity': 1,
                'line-opacity-transition': { duration: 0 },
                'line-width-transition': { duration: 0 },
            },
        });
    }
}

/*
 * The flash.
 *
 * A pulse rather than an on/off blink: a hard blink at the rate needed to
 * catch the eye is the kind that can trigger seizures, so this breathes
 * between bright and dim about once a second — emergencies a little faster.
 * Ten paint updates a second is far below anything the map notices.
 *
 * It runs only while there is something to flash, the switch is on and the
 * page is visible, so a quiet day costs nothing. With reduced motion asked
 * for, the highlight is drawn steady instead.
 */
const TICK_MS = 100;
let _timer = null;
let _count = 0;
let _hasEmergency = false;
let _t0 = 0;

function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

function paint(level) {
    try {
        if (map.getLayer(LINE_LAYER)) {
            map.setPaintProperty(LINE_LAYER, 'line-opacity', 0.25 + 0.75 * level);
            map.setPaintProperty(LINE_LAYER, 'line-width', 3 + 3 * level);
        }
        // Light enough that the radar inside reads through it even at the peak.
        if (map.getLayer(FILL_LAYER)) map.setPaintProperty(FILL_LAYER, 'fill-opacity', 0.22 * level);
    } catch (e) { /* the style is mid-change */ }
}

function tick() {
    if (document.hidden) return;
    const period = _hasEmergency ? 700 : 1100;
    const phase = ((Date.now() - _t0) % period) / period;
    paint(0.5 - 0.5 * Math.cos(phase * 2 * Math.PI));
}

function stopFlash() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

function startFlash() {
    if (_timer) return;
    _t0 = Date.now();
    _timer = setInterval(tick, TICK_MS);
}

/* Bring the layers and the flash into line with what is on the map now. */
function refresh() {
    // The alerts button hides the alert layers; a refresh from the 15-second
    // updater must not bring the flash back over a map with no alerts on it.
    let alertsShown = false;
    try { alertsShown = !!map.getLayer('alertsLayer') && map.getLayoutProperty('alertsLayer', 'visibility') !== 'none'; }
    catch (e) { alertsShown = false; }
    const on = enabled() && _count > 0 && alertsShown;
    for (const id of LAYERS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
    if (!on) { stopFlash(); return; }
    if (reducedMotion()) { stopFlash(); paint(0.85); return; }
    startFlash();
}

/*
 * Called by plot_alerts on every plot, with the features it is about to draw.
 * Tags each with its threat and recolours PDS and emergencies — before the
 * map has them, so every layer reading `color` agrees.
 */
function tag(features) {
    let count = 0, emergency = false;
    const on = enabled();
    for (const f of features) {
        const threat = classify(f.properties);
        f.properties.threat = threat;
        if (!threat) continue;
        count++;
        if (threat === 'emergency') emergency = true;
        if (on) f.properties.color = colorFor(threat);
    }
    _count = count;
    _hasEmergency = emergency;
}

/* After the alert layers exist: add ours on top and set the flash going. */
function afterPlot() {
    addLayers();
    refresh();
}

/* The alerts button turns every alert layer off and on; these go with them. */
function hide() {
    stopFlash();
    for (const id of LAYERS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && _timer) tick(); });

/*
 * The switch is remembered. It starts on: a user who has never looked for it
 * should still see a PDS warning stand out. Flipping it re-plots the alerts
 * (it carries alert_options_btn), which recolours them and calls refresh().
 */
const STORE_KEY = 'vortexPdsFlash';
(function rememberSwitch() {
    const el = document.querySelector(SWITCH);
    if (!el) return;
    try { if (localStorage.getItem(STORE_KEY) === '0') el.checked = false; } catch (e) { /* default on */ }
    el.addEventListener('change', () => {
        try { localStorage.setItem(STORE_KEY, el.checked ? '1' : '0'); } catch (e) { /* not remembered */ }
    });
})();

if (typeof window !== 'undefined') {
    // For the unbundled Active Alerts list, which badges these too.
    window.vortexAlertThreat = (props) => {
        const threat = classify(props);
        return threat ? { threat, label: label(threat, props && props.event), color: colorFor(threat) } : null;
    };
}

module.exports = { classify, label, colorFor, tag, afterPlot, refresh, hide, LAYERS, PDS_COLOR, EMERGENCY_COLOR };
