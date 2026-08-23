/*
 * alert_types.js
 * The alert types users can show/hide in the Alert Filters picker. Each entry:
 *   { name, category: 'warning'|'watch'|'statement', def }
 * `def` is the default state. Defaults reproduce the app's previous behavior
 * (the original convective whitelist + Special Weather Statement are ON, all
 * else OFF), so nothing on the map changes until a user opts in.
 */
module.exports = [
    // ── Warnings ──────────────────────────────────────────────────────────────
    { name: 'Tornado Warning', category: 'warning', def: true },
    { name: 'Severe Thunderstorm Warning', category: 'warning', def: true },
    { name: 'Flash Flood Warning', category: 'warning', def: true },
    { name: 'Special Marine Warning', category: 'warning', def: true },
    { name: 'Snow Squall Warning', category: 'warning', def: true },
    { name: 'Extreme Wind Warning', category: 'warning', def: true },
    { name: 'Flood Warning', category: 'warning', def: false },
    { name: 'Dust Storm Warning', category: 'warning', def: false },
    { name: 'Hurricane Warning', category: 'warning', def: false },
    { name: 'Tropical Storm Warning', category: 'warning', def: false },
    { name: 'Storm Surge Warning', category: 'warning', def: false },
    { name: 'Blizzard Warning', category: 'warning', def: false },
    { name: 'Winter Storm Warning', category: 'warning', def: false },
    { name: 'Ice Storm Warning', category: 'warning', def: false },
    { name: 'High Wind Warning', category: 'warning', def: false },
    { name: 'Red Flag Warning', category: 'warning', def: false },
    { name: 'Excessive Heat Warning', category: 'warning', def: false },
    { name: 'Extreme Heat Warning', category: 'warning', def: false },
    { name: 'Freeze Warning', category: 'warning', def: false },
    { name: 'Hard Freeze Warning', category: 'warning', def: false },

    // ── Watches ───────────────────────────────────────────────────────────────
    { name: 'Tornado Watch', category: 'watch', def: true },
    { name: 'Severe Thunderstorm Watch', category: 'watch', def: true },
    { name: 'Flash Flood Watch', category: 'watch', def: true },
    { name: 'Flood Watch', category: 'watch', def: false },
    { name: 'Winter Storm Watch', category: 'watch', def: false },
    { name: 'Hurricane Watch', category: 'watch', def: false },
    { name: 'Tropical Storm Watch', category: 'watch', def: false },
    { name: 'Storm Surge Watch', category: 'watch', def: false },
    { name: 'Fire Weather Watch', category: 'watch', def: false },
    { name: 'Excessive Heat Watch', category: 'watch', def: false },

    // ── Statements & Advisories ───────────────────────────────────────────────
    { name: 'Special Weather Statement', category: 'statement', def: true },
    { name: 'Severe Weather Statement', category: 'statement', def: false },
    { name: 'Winter Weather Advisory', category: 'statement', def: false },
    { name: 'Wind Advisory', category: 'statement', def: false },
    { name: 'Heat Advisory', category: 'statement', def: false },
    { name: 'Flood Advisory', category: 'statement', def: false },
    { name: 'Dense Fog Advisory', category: 'statement', def: false },
    { name: 'Frost Advisory', category: 'statement', def: false },
    { name: 'Small Craft Advisory', category: 'statement', def: false },
    { name: 'Coastal Flood Advisory', category: 'statement', def: false },
];
