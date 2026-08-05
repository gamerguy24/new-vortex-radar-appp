/*
 * alert_prefs.js
 * Per-alert-type show/hide preferences, saved to localStorage so each user
 * controls which alert types appear (both on the map and in the Active Alerts
 * list). Read by filter_alerts.passes_filter and edited by the Alert Filters
 * picker.
 */
const TYPES = require('./alert_types');

const KEY = 'vortexAlertPrefs';
const TYPE_INDEX = {};
TYPES.forEach((t) => { TYPE_INDEX[t.name] = t; });

let _prefs = load();
function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(_prefs)); } catch (e) { /* ignore */ } }

// Enabled = explicit user choice, else the type's default, else off (unknown types).
function isEnabled(name) {
    if (Object.prototype.hasOwnProperty.call(_prefs, name)) return !!_prefs[name];
    const t = TYPE_INDEX[name];
    return t ? !!t.def : false;
}
function setEnabled(name, val) { _prefs[name] = !!val; save(); }

// Best-effort category for a type not in the curated list.
function categoryFromName(name) {
    const n = (name || '').toLowerCase();
    if (n.endsWith('warning')) return 'warning';
    if (n.endsWith('watch')) return 'watch';
    return 'statement';
}

module.exports = { TYPES, TYPE_INDEX, isEnabled, setEnabled, categoryFromName, KEY };
