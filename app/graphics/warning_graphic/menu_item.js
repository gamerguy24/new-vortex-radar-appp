/*
 * menu_item.js
 * Wires the footer "Warning Graphic" button to the generator.
 */

const { openWarningGraphic } = require('./warning_graphic');

$('#warnGraphicBtn').on('click', function () {
    openWarningGraphic();
});
