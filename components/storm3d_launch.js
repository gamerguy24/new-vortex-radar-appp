/*
 * components/storm3d_launch.js
 * Wires the "3D Storm View" entry points — the main-menu row and the
 * "3D Storm View (Reflectivity)" row in the product menu's Super Resolution
 * section. Lazily imports the (heavy) Storm3D module + Three.js only when first
 * opened, for the currently selected radar station.
 *
 * Tier Three: components/pro_gates.js intercepts both rows for lower tiers,
 * and the server refuses the volume download (/api/level2/latest, 402).
 */

import { desktopOnly } from './platform.js?v=plat1';

const ROWS = ['#armrStorm3DBtn', '#psmStorm3DRow'];
let _viewer = null;

async function open3D() {
    const station = window.vortexData && window.vortexData.currentStation;
    for (const id of ['vortexRadarMenu', 'productSelectionMenu']) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }
    if (!station) {
        alert('Open a radar site first (click a station on the map), then launch the 3D view.');
        return;
    }
    try {
        const { default: Storm3D } = await import('./3d/storm3d.js?v=s3d2');
        if (_viewer) { try { _viewer.close(); } catch (e) {} }
        _viewer = new Storm3D(station);
    } catch (err) {
        alert('Could not open the 3D storm view: ' + (err?.message || err));
    }
}

function init() {
    /*
     * Desktop only, for the same reason as the Studio: this volume-renders a
     * whole sweep in WebGL, which a phone GPU will not survive.
     */
    if (!desktopOnly(ROWS, '3D Storm View')) return;

    for (const sel of ROWS) {
        const el = document.querySelector(sel);
        if (el) el.addEventListener('click', open3D);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
