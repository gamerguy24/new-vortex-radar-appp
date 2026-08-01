const warnings_whitelist = [
    'Tornado Warning',
    'Severe Thunderstorm Warning',
    'Flash Flood Warning',
    'Special Marine Warning',
    'Snow Squall Warning',
    'Extreme Wind Warning',
    // 'Hurricane Warning',
    // 'Tropical Storm Warning'
];
const watches_whitelist = [
    'Tornado Watch',
    'Severe Thunderstorm Watch',
    // 'Hurricane Watch',
    // 'Tropical Storm Watch'
];
const statements_whitelist = [
    'Special Weather Statement'
];

// Whether a single alert feature passes the current warnings/watches/statements
// filter (the same toggles that control the map). Shared so both the map and the
// Active Alerts list stay in sync.
function passes_filter(feature) {
    if (!feature || !feature.properties) return false;
    const name = feature.properties.event;
    const has_geometry = feature.geometry != null;
    const show_warnings = $('#armrWarningsBtnSwitchElem').is(':checked');
    const show_watches = $('#armrWatchesBtnSwitchElem').is(':checked');
    const show_statements = $('#armrStatementsBtnSwitchElem').is(':checked');

    if (show_warnings && warnings_whitelist.includes(name)) return true;
    // Watches intentionally left disabled (matches the map's existing behavior).
    // if (show_watches && watches_whitelist.includes(name)) return true;
    if (show_statements && statements_whitelist.includes(name) && has_geometry) return true;
    return false;
}

function filter_alerts(alerts_data) {
    window.atticData.show_warnings = $('#armrWarningsBtnSwitchElem').is(':checked');
    window.atticData.show_watches = $('#armrWatchesBtnSwitchElem').is(':checked');
    window.atticData.show_statements = $('#armrStatementsBtnSwitchElem').is(':checked');

    alerts_data.features = alerts_data.features.filter(passes_filter);
    return alerts_data;
}

// Expose the predicate so the (ES-module) Active Alerts list can apply the exact
// same filter without duplicating the whitelists.
if (typeof window !== 'undefined') {
    window.vortexAlertFilter = passes_filter;
}

module.exports = filter_alerts;
module.exports.passes_filter = passes_filter;