/*
 * app/core/map/county_borders.js
 * County boundaries for the main radar map.
 *
 * The Mapbox base style carries country (admin-0) and state (admin-1) borders
 * but no county lines, so vortex_basemap.js had nothing to recolour and the map
 * simply never showed counties. For severe-weather work that is a real gap:
 * warnings are issued by county, and spotters describe position by county.
 *
 * The data is the county TopoJSON the app already ships for the Graphics Studio
 * and the Power Outages layer, served at /geo/counties-10m.json. Converting it
 * to a boundary MESH (rather than 3,200 polygons) means every shared edge is
 * drawn exactly once — half the geometry, and no double-stroked seams where two
 * counties touch.
 *
 * Styling follows the basemap palette: a hairline that thickens slightly with
 * zoom, and light enough to read as reference rather than compete with radar.
 */

const map = require('./map');
const topojson = require('topojson-client');

const SRC = 'vortex-county-src';
const LINE = 'vortex-county-line';
const GEO_URL = '/geo/counties-10m.json';

let loading = null;
let enabled = false;

// Draw counties beneath the radar so echoes always sit on top.
function beforeId() {
    for (const id of ['radar-webgl', 'baseReflectivity']) {
        try { if (map.getLayer(id)) return id; } catch (e) { /* style not ready */ }
    }
    return undefined;
}

async function ensureSource() {
    if (map.getSource(SRC)) return true;
    if (!loading) {
        loading = fetch(GEO_URL)
            .then((r) => {
                if (!r.ok) throw new Error('counties ' + r.status);
                return r.json();
            })
            .then((topo) => {
                // Interior boundaries only: a !== b drops the outer coastline,
                // which the state/nation layers already draw.
                const mesh = topojson.mesh(topo, topo.objects.counties, (a, b) => a !== b);
                if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: mesh });
                return true;
            })
            .catch((e) => {
                console.warn('[counties] load failed:', e.message);
                loading = null;
                return false;
            });
    }
    return loading;
}

async function enable() {
    enabled = true;
    const ok = await ensureSource();
    if (!ok || !enabled) return;
    if (map.getLayer(LINE)) {
        map.setLayoutProperty(LINE, 'visibility', 'visible');
        return;
    }
    map.addLayer({
        id: LINE,
        type: 'line',
        source: SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            // Readable on the light-grey basemap without shouting over radar.
            'line-color': 'rgba(70, 76, 86, 0.85)',
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                4, 0.4,
                6, 0.7,
                8, 1.1,
                11, 1.8,
            ],
            // Fade out when zoomed way out, where 3,000 county lines would just
            // be noise.
            'line-opacity': [
                'interpolate', ['linear'], ['zoom'],
                3.5, 0,
                5, 0.75,
                8, 1,
            ],
        },
    }, beforeId());
}

function disable() {
    enabled = false;
    try { if (map.getLayer(LINE)) map.setLayoutProperty(LINE, 'visibility', 'none'); }
    catch (e) { /* layer not added yet */ }
}

function isEnabled() { return enabled; }

// Re-add after a basemap style swap (setStyle wipes user layers).
function reapply() {
    if (!enabled) return;
    if (map.getLayer(LINE)) return;
    enable();
}

if (typeof window !== 'undefined') {
    window.vortexCounties = { enable, disable, isEnabled, reapply };
}

module.exports = { enable, disable, isEnabled, reapply };
