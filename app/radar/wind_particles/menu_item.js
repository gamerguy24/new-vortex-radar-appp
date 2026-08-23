/*
 * menu_item.js
 * Toggle for the Wind Particles velocity-flow overlay.
 */

const armFunctions = require('../../core/menu/vortexRadarMenu');
const wind_particles = require('./wind_particles');

armFunctions.toggleswitchFunctions(
    $('#armrWindParticlesBtnSwitchElem'),
    function () { wind_particles.enable(); },
    function () { wind_particles.disable(); }
);
