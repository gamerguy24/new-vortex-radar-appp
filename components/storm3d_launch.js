/*
 * components/storm3d_launch.js
 * Wires the "3D Storm View" menu row. Lazily imports the (heavy) Storm3D module
 * + Three.js only when first opened, for the currently selected radar station.
 */

import { desktopOnly } from './platform.js?v=plat1';

let _viewer = null;

async function open3D() {
    const station = window.vortexData && window.vortexData.currentStation;
    if (!station) {
        alert('Open a radar site first (click a station on the map), then launch the 3D view.');
        return;
    }
    const menu = document.getElementById('vortexRadarMenu');
    if (menu) menu.style.display = 'none';
    try {
        const { default: Storm3D } = await import('./3d/storm3d.js');
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
    if (!desktopOnly(['#armrStorm3DBtn'], '3D Storm View')) return;

    const btn = document.getElementById('armrStorm3DBtn');
    if (btn) btn.addEventListener('click', open3D);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
