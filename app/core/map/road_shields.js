/*
 * app/core/map/road_shields.js
 * Highway route shields (I-75, US-41, the white state-route circle) on the
 * radar map, so anyone can place themselves against a storm at a glance.
 *
 * The dark-v11 base style ships no shield layer at all. Its only road text is
 * street names from zoom 12, and its sprite has no shield images, so from
 * where most people watch radar (zoom 6-10) nothing said which road was which.
 *
 * The route data is already in the basemap's vector tiles (Mapbox Streets v8,
 * 'road' layer): `ref` is the number, `shield` the style, `reflen` its length.
 * Measured against live US tiles, `shield` is one of:
 *   us-interstate, us-interstate-duplex   blue shield, red crown
 *   us-highway,    us-highway-duplex      white US-route shield
 *   circle-white                          state routes
 *   default                               anything else: a plain white box
 * "duplex" is two routes sharing one road, with a ref like "75·85".
 *
 * The pictures are drawn here on a canvas and registered with map.addImage,
 * one per style and length, so there is no sprite to host or keep in step.
 *
 * Four layers, so each class can start at its own zoom: interstates from far
 * out, local routes only once there is room for them. They sit among the
 * basemap's labels, which are all above the radar, so a shield is never
 * hidden under echoes.
 */

const map = require('./map');

const PREFIX = 'vx-road-shields';
const SOURCE = 'composite';          // the basemap's Mapbox Streets tiles
const SOURCE_LAYER = 'road';
const FONT = ['DIN Pro Bold', 'Arial Unicode MS Bold'];
const PR = 2;                        // drawn at 2x: crisp on high-density screens
const MAX_LEN = 6;                   // longer refs ("US Historic 66") are names, not numbers
const STORE_KEY = 'vortexRoadShields';

const INTERSTATE = ['us-interstate', 'us-interstate-duplex'];
const KINDS = ['us-interstate', 'us-interstate-duplex', 'us-highway', 'us-highway-duplex', 'circle-white', 'default'];

/*
 * First in the list is placed first when labels collide, so interstates win
 * over US routes, and those over state routes. Mapbox places the TOPMOST layer
 * first, which is why install() adds these in reverse.
 */
const TIERS = [
    { name: 'interstate', shields: INTERSTATE, minzoom: 5 },
    { name: 'us', shields: ['us-highway', 'us-highway-duplex'], minzoom: 6.5 },
    { name: 'state', shields: ['circle-white'], minzoom: 8 },
    { name: 'other', shields: ['default'], minzoom: 9.5 },
];

function layerId(tier) { return PREFIX + '-' + tier.name; }
function imageId(kind, n) { return PREFIX + '-' + kind + '-' + n; }

/* ── the pictures ─────────────────────────────────────────────────────────── */

// Size in CSS px for a ref of n characters.
function sizeFor(kind, n) {
    const base = kind.replace('-duplex', '');
    if (base === 'circle-white') {
        if (n <= 2) return { w: 20, h: 20 };
        if (n === 3) return { w: 25, h: 25 };          // "528": still a circle
        return { w: Math.round(9 + 6.5 * n), h: 22 };  // longer: an oval
    }
    const w = Math.max(19, Math.round(9 + 6.5 * n));
    return { w, h: base === 'default' ? 18 : 21 };
}

function pathInterstate(ctx, w, h) {
    ctx.beginPath();
    ctx.moveTo(1, 2.5);
    ctx.quadraticCurveTo(w * 0.25, 0.2, w / 2, 2);     // the two-lobed crown
    ctx.quadraticCurveTo(w * 0.75, 0.2, w - 1, 2.5);
    ctx.lineTo(w - 1, h * 0.45);
    ctx.bezierCurveTo(w - 1, h * 0.8, w * 0.68, h - 1.5, w / 2, h - 0.6);
    ctx.bezierCurveTo(w * 0.32, h - 1.5, 1, h * 0.8, 1, h * 0.45);
    ctx.closePath();
}

function pathUsHighway(ctx, w, h) {
    const r = 2.5;
    ctx.beginPath();
    ctx.moveTo(1 + r, 1);
    ctx.lineTo(w - 1 - r, 1);
    ctx.quadraticCurveTo(w - 1, 1, w - 1, 1 + r);
    ctx.lineTo(w - 1, h * 0.5);
    ctx.bezierCurveTo(w - 1, h * 0.82, w * 0.66, h - 1.2, w / 2, h - 0.6);
    ctx.bezierCurveTo(w * 0.34, h - 1.2, 1, h * 0.82, 1, h * 0.5);
    ctx.lineTo(1, 1 + r);
    ctx.quadraticCurveTo(1, 1, 1 + r, 1);
    ctx.closePath();
}

function pathRoundRect(ctx, w, h) {
    const r = 3;
    ctx.beginPath();
    ctx.moveTo(1 + r, 1);
    ctx.arcTo(w - 1, 1, w - 1, h - 1, r);
    ctx.arcTo(w - 1, h - 1, 1, h - 1, r);
    ctx.arcTo(1, h - 1, 1, 1, r);
    ctx.arcTo(1, 1, w - 1, 1, r);
    ctx.closePath();
}

const DRAW = {
    'us-interstate'(ctx, w, h) {
        pathInterstate(ctx, w, h);
        ctx.fillStyle = '#1f4e9e';
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = '#c8102e';                      // red crown
        ctx.fillRect(0, 0, w, h * 0.3);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, h * 0.3, w, 0.9);
        ctx.restore();
        pathInterstate(ctx, w, h);
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
    },
    'us-highway'(ctx, w, h) {
        pathUsHighway(ctx, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = '#15181c';
        ctx.stroke();
    },
    'circle-white'(ctx, w, h) {
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = '#15181c';
        ctx.stroke();
    },
    'default'(ctx, w, h) {
        pathRoundRect(ctx, w, h);
        ctx.fillStyle = '#f4f5f7';
        ctx.fill();
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = '#3a3f46';
        ctx.stroke();
    },
};

function drawShield(kind, n) {
    const { w, h } = sizeFor(kind, n);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * PR);
    canvas.height = Math.ceil(h * PR);
    const ctx = canvas.getContext('2d');
    ctx.scale(PR, PR);
    DRAW[kind.replace('-duplex', '')](ctx, w, h);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/* ── the layers ───────────────────────────────────────────────────────────── */

// Characters in the ref. reflen when the tiles give it, else counted.
const LEN = ['to-number', ['coalesce', ['get', 'reflen'], ['length', ['to-string', ['get', 'ref']]]]];

function layerSpec(tier, visible) {
    return {
        id: layerId(tier),
        type: 'symbol',
        source: SOURCE,
        'source-layer': SOURCE_LAYER,
        minzoom: tier.minzoom,
        filter: ['all',
            ['has', 'ref'],
            ['match', ['get', 'shield'], tier.shields, true, false],
            // Ramps carry the number of the road they join; showing it again
            // on every on-ramp only buries the real shield.
            ['match', ['get', 'class'],
                ['motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'], false, true],
            ['>=', LEN, 1],
            ['<=', LEN, MAX_LEN],
        ],
        layout: {
            visibility: visible ? 'visible' : 'none',
            // Point, not line. Line placement only places a label where one
            // road piece is long enough to hold it, and at radar zooms the
            // tiles cut roads into short pieces: measured in Chrome, line
            // placement drew NO shields at zoom 10 and only a few at 13, while
            // point drew them at both. (Mapbox's own styles do the same below
            // zoom 11.) The padding keeps them from bunching at interchanges.
            'symbol-placement': 'point',
            'icon-padding': 12,
            'icon-image': ['concat', PREFIX + '-', ['get', 'shield'], '-', ['to-string', LEN]],
            'icon-rotation-alignment': 'viewport',
            'text-field': ['to-string', ['get', 'ref']],
            'text-font': FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 9.5, 10, 11],
            'text-rotation-alignment': 'viewport',
            'text-letter-spacing': 0,
            // Interstates: sit the number in the blue, below the red crown.
            'text-offset': ['match', ['get', 'shield'], INTERSTATE, ['literal', [0, 0.25]], ['literal', [0, 0]]],
            'text-padding': 2,
        },
        paint: {
            'text-color': ['match', ['get', 'shield'], INTERSTATE, '#ffffff', '#15181c'],
        },
    };
}

/*
 * Just under the place names: shields win over water, park and POI labels
 * when they collide, and city names still win over shields. Every one of
 * these is above the radar, which is inserted far below the labels.
 */
function beforeId(m) {
    for (const id of ['settlement-subdivision-label', 'settlement-minor-label', 'settlement-major-label', 'state-label', 'country-label']) {
        try { if (m.getLayer(id)) return id; } catch (e) { /* style not ready */ }
    }
    return undefined;
}

/* ── state ────────────────────────────────────────────────────────────────── */

function storedChoice() {
    try { return localStorage.getItem(STORE_KEY) !== '0'; } catch (e) { return true; }
}

let enabled = storedChoice();        // on unless the user turned it off
const maps = new Set();

function build(m) {
    if (!m.getSource(SOURCE)) return;             // a style without Streets tiles
    for (const kind of KINDS) {
        for (let n = 1; n <= MAX_LEN; n++) {
            const id = imageId(kind, n);
            if (!m.hasImage(id)) m.addImage(id, drawShield(kind, n), { pixelRatio: PR });
        }
    }
    const before = beforeId(m);
    for (const tier of [...TIERS].reverse()) {
        if (!m.getLayer(layerId(tier))) m.addLayer(layerSpec(tier, enabled), before);
    }
}

/*
 * style._loaded is exactly what addLayer checks ("Style is not done
 * loading"). isStyleLoaded() also waits for every tile in view, which on a
 * busy radar map can stay false for a long while, so it is only the fallback.
 */
function styleReady(m) {
    try {
        if (m.style && m.style._loaded) return true;
        return !!(m.isStyleLoaded && m.isStyleLoaded());
    } catch (e) { return false; }
}

// Add the shields to a map: the main one by default, or the split-screen pane.
function install(targetMap, attempt = 0) {
    const m = targetMap || map;
    if (!m || typeof m.addLayer !== 'function') return;
    if (!styleReady(m)) {
        if (attempt >= 300) { console.warn('[road shields] map style never became ready'); return; }
        setTimeout(() => install(m, attempt + 1), 100);
        return;
    }
    maps.add(m);
    try { build(m); } catch (e) { console.warn('[road shields] could not add shields:', e); }
}

function setVisible(on) {
    enabled = on;
    try { localStorage.setItem(STORE_KEY, on ? '1' : '0'); } catch (e) { /* applied, not remembered */ }
    for (const m of maps) {
        for (const tier of TIERS) {
            // A split-screen map that has since been removed throws here.
            try { if (m.getLayer(layerId(tier))) m.setLayoutProperty(layerId(tier), 'visibility', on ? 'visible' : 'none'); }
            catch (e) { maps.delete(m); break; }
        }
    }
}

function enable() { setVisible(true); }
function disable() { setVisible(false); }
function isEnabled() { return enabled; }

if (typeof window !== 'undefined') {
    window.vortexRoadShields = { install, enable, disable, isEnabled };
}

module.exports = { install, enable, disable, isEnabled, PREFIX, TIERS, KINDS, MAX_LEN, layerSpec, sizeFor, imageId };
