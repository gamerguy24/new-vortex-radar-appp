/*
 * filter_alerts.js
 * Decides which alerts are shown. Two layers of control:
 *   1. The category master toggles in the menu (Warnings / Watches / Statements)
 *      — quick on/off for a whole category.
 *   2. Per-alert-type preferences from the Alert Filters picker (alert_prefs) —
 *      fine control over exactly which types appear.
 * The shared passes_filter predicate is used by both the map plot and the Active
 * Alerts list, so they always match.
 */
const prefs = require('./alert_prefs');

const masterOn = (category) => {
    if (category === 'warning') return $('#armrWarningsBtnSwitchElem').is(':checked');
    if (category === 'watch') return $('#armrWatchesBtnSwitchElem').is(':checked');
    if (category === 'statement') return $('#armrStatementsBtnSwitchElem').is(':checked');
    return true;
};

// Whether a single alert feature passes the current filter.
function passes_filter(feature) {
    if (!feature || !feature.properties) return false;
    const name = feature.properties.event;
    const info = prefs.TYPE_INDEX[name];
    const category = info ? info.category : prefs.categoryFromName(name);

    // Category master toggle off → hide the whole category.
    if (!masterOn(category)) return false;
    // Per-type preference (defaults reproduce the old behavior).
    if (!prefs.isEnabled(name)) return false;
    // Statements/advisories must have a polygon to render on the map.
    if (category === 'statement' && feature.geometry == null) return false;
    return true;
}

function filter_alerts(alerts_data) {
    window.atticData.show_warnings = $('#armrWarningsBtnSwitchElem').is(':checked');
    window.atticData.show_watches = $('#armrWatchesBtnSwitchElem').is(':checked');
    window.atticData.show_statements = $('#armrStatementsBtnSwitchElem').is(':checked');

    alerts_data.features = alerts_data.features.filter(passes_filter);
    return alerts_data;
}

// Expose the predicate so the (ES-module) Active Alerts list applies the exact
// same filter without duplicating logic.
if (typeof window !== 'undefined') {
    window.vortexAlertFilter = passes_filter;
}

module.exports = filter_alerts;
module.exports.passes_filter = passes_filter;
