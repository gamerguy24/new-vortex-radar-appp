/*
 * model_products.js
 * The Models & Forecast product menu, defined once on the SERVER.
 *
 * The server is the only place that can say whether a product is actually in
 * the run being viewed — it holds the `.idx`. Defining the menu here and
 * resolving it against that index means the client renders whatever came back
 * instead of guessing, and a model that lacks a field simply does not show it
 * rather than offering a card that errors when clicked.
 *
 * Two kinds of item:
 *   - a direct GRIB message: { v, lvl, fcst? }
 *   - a derived field computed from several messages: { derive: '<id>' },
 *     defined in grib2_derived.js
 *
 * Matching rules, chosen against the real indexes of HRRR / NAM / NAM-3km /
 * GFS: `v` is exact, `lvl` is a prefix (so 'entire atmosphere' matches both
 * that and GFS's 'entire atmosphere (considered as a single layer)'), and the
 * optional `fcst` regex disambiguates messages that differ ONLY by their
 * accumulation window — which is how QPF is stored.
 */

const { DERIVED } = require('./grib2_derived');

// Accumulated-since-run-start, e.g. "0-6 hour acc fcst" / "0-1 day acc fcst".
const ACC_TOTAL = /^0-\d+\s+(hour|day)\s+acc/i;
// The bucket ending at this forecast hour, e.g. "5-6 hour acc fcst".
const ACC_INTERVAL = /^(?!0-)\d+-\d+\s+hour\s+acc/i;

const CATEGORIES = [
    {
        id: 'surface', label: 'Surface',
        items: [
            { id: 'tmp_2m', label: '2 m Temperature', v: 'TMP', lvl: '2 m above ground' },
            { id: 'dpt_2m', label: '2 m Dew Point', v: 'DPT', lvl: '2 m above ground' },
            { id: 'rh_2m', label: '2 m Relative Humidity', v: 'RH', lvl: '2 m above ground', kind: 'percent' },
            { id: 'theta_e_2m', derive: 'theta_e_2m' },
            { id: 'wind_10m', derive: 'wind_10m' },
            { id: 'gust', label: '10 m Wind Gusts', v: 'GUST', lvl: 'surface', kind: 'wind' },
            { id: 'mslp', label: 'MSLP', v: 'PRMSL', lvl: 'mean sea level' },
            // HRRR publishes MSLP under MSLMA rather than PRMSL.
            { id: 'mslp_ma', label: 'MSLP', v: 'MSLMA', lvl: 'mean sea level' },
            { id: 'pres_sfc', label: 'Surface Pressure', v: 'PRES', lvl: 'surface', kind: 'mslp' },
            { id: 'hpbl', label: 'Boundary Layer Depth', v: 'HPBL', lvl: 'surface', kind: 'height' },
        ],
    },
    {
        id: 'ptype', label: 'Precipitation Type',
        items: [
            { id: 'ptype', derive: 'ptype' },
            { id: 'prate', label: 'Precipitation Rate', v: 'PRATE', lvl: 'surface' },
        ],
    },
    {
        id: 'qpf', label: 'Quantitative Precipitation',
        items: [
            { id: 'apcp_total', label: 'Total QPF (run to date)', v: 'APCP', lvl: 'surface', fcst: ACC_TOTAL, kind: 'precip' },
            { id: 'apcp_interval', label: 'QPF (this interval)', v: 'APCP', lvl: 'surface', fcst: ACC_INTERVAL, kind: 'precip' },
        ],
    },
    {
        id: 'moisture', label: 'Integrated Moisture and Satellite',
        items: [
            { id: 'tcdc', label: 'Cloud Cover', v: 'TCDC', lvl: 'entire atmosphere', kind: 'percent' },
            { id: 'tcdc_bl', label: 'Cloud Cover, Boundary Layer', v: 'TCDC', lvl: 'boundary layer cloud layer', kind: 'percent' },
            { id: 'pwat', label: 'Precipitable Water', v: 'PWAT', lvl: 'entire atmosphere' },
            { id: 'vis', label: 'Visibility', v: 'VIS', lvl: 'surface', kind: 'vis' },
        ],
    },
    {
        id: 'radar', label: 'Radar Products',
        items: [
            { id: 'refc', label: 'Composite Reflectivity', v: 'REFC', lvl: 'entire atmosphere' },
            { id: 'maxref', label: '1 km AGL Reflectivity', v: 'MAXREF', lvl: '1000 m above ground', kind: 'refl' },
            { id: 'retop', label: 'Echo Top', v: 'RETOP', lvl: 'cloud top', kind: 'height' },
        ],
    },
    {
        id: 'instability', label: 'Severe Weather: Instability',
        items: [
            { id: 'cape_sfc', label: 'Surface-Based CAPE', v: 'CAPE', lvl: 'surface' },
            { id: 'cape_ml', label: 'Mixed-Layer CAPE (180-0 mb)', v: 'CAPE', lvl: '180-0 mb above ground' },
            { id: 'cape_mu', label: 'Most Unstable CAPE (255-0 mb)', v: 'CAPE', lvl: '255-0 mb above ground' },
            { id: 'cape_03', label: '0-3 km CAPE', v: 'CAPE', lvl: '0-3000 m above ground' },
            { id: 'cin_sfc', label: 'Surface-Based CIN', v: 'CIN', lvl: 'surface', kind: 'cin' },
            { id: 'cin_ml', label: 'Mixed-Layer CIN', v: 'CIN', lvl: '180-0 mb above ground', kind: 'cin' },
            { id: 'lftx', label: 'Lifted Index', v: 'LFTX', lvl: '500-1000 mb', kind: 'li' },
            { id: 'lftx_sfc', label: 'Lifted Index', v: 'LFTX', lvl: 'surface', kind: 'li' },
            { id: 'lapse_700_500', derive: 'lapse_700_500' },
            { id: 'lapse_850_500', derive: 'lapse_850_500' },
            { id: 'lcl_height', derive: 'lcl_height' },
            { id: 'lfc_height', derive: 'lfc_height' },
        ],
    },
    {
        id: 'shear', label: 'Severe Weather: Wind Shear',
        items: [
            { id: 'bshr_06', derive: 'bshr_06' },
            { id: 'bshr_01', derive: 'bshr_01' },
            { id: 'bshr_sfc500', derive: 'bshr_sfc500' },
            { id: 'srh_03', label: 'Storm Relative Helicity: 0-3 km', v: 'HLCY', lvl: '3000-0 m above ground' },
            { id: 'srh_01', label: 'Storm Relative Helicity: 0-1 km', v: 'HLCY', lvl: '1000-0 m above ground' },
            { id: 'storm_motion', derive: 'storm_motion' },
        ],
    },
    {
        id: 'composite', label: 'Severe Weather: Composite Parameters',
        items: [
            { id: 'ehi_03', derive: 'ehi_03' },
            { id: 'ehi_01', derive: 'ehi_01' },
            { id: 'scp', derive: 'scp' },
        ],
    },
    {
        id: 'ua_moisture', label: 'Upper-Air: Moisture',
        items: [
            { id: 'rh_850', label: '850 mb Relative Humidity', v: 'RH', lvl: '850 mb', kind: 'percent' },
            { id: 'rh_700', label: '700 mb Relative Humidity', v: 'RH', lvl: '700 mb', kind: 'percent' },
            { id: 'rh_500', label: '500 mb Relative Humidity', v: 'RH', lvl: '500 mb', kind: 'percent' },
            { id: 'dpt_850', label: '850 mb Dew Point', v: 'DPT', lvl: '850 mb' },
            { id: 'dpt_700', label: '700 mb Dew Point', v: 'DPT', lvl: '700 mb' },
        ],
    },
    {
        id: 'ua_dynamics', label: 'Upper-Air: Dynamics',
        items: [
            { id: 'wind_250', derive: 'wind_250' },
            { id: 'wind_500', derive: 'wind_500' },
            { id: 'wind_850', derive: 'wind_850' },
            { id: 'tmp_850', label: '850 mb Temperature', v: 'TMP', lvl: '850 mb' },
            { id: 'tmp_700', label: '700 mb Temperature', v: 'TMP', lvl: '700 mb' },
            { id: 'tmp_500', label: '500 mb Temperature', v: 'TMP', lvl: '500 mb' },
        ],
    },
    {
        id: 'winter', label: 'Winter Weather',
        items: [
            { id: 'asnow', label: 'Snow Accumulation', v: 'ASNOW', lvl: 'surface', kind: 'precip' },
            { id: 'snod', label: 'Snow Depth', v: 'SNOD', lvl: 'surface', kind: 'precip' },
            { id: 'weasd', label: 'Snow Water Equivalent', v: 'WEASD', lvl: 'surface', fcst: ACC_TOTAL, kind: 'precip' },
        ],
    },
];

// Exact variable, prefix level, optional forecast-window regex.
function findMessage(messages, v, lvl, fcst) {
    const V = String(v).toUpperCase();
    const L = String(lvl).toLowerCase();
    return messages.find((m) => m.variable.toUpperCase() === V
        && m.level.toLowerCase().startsWith(L)
        && (!fcst || fcst.test(m.forecast || ''))) || null;
}

/*
 * Resolve one derived field's inputs.
 *
 * `altInputs` covers the same quantity written a different way by a different
 * centre — the GFS labels Bunkers storm motion "6000-0 m above ground" where
 * the HRRR says "0-6000 m above ground". Returns null unless EVERY input is
 * present, so a half-resolvable parameter never reaches the menu.
 */
function resolveDerived(messages, def) {
    for (const set of [def.inputs, def.altInputs].filter(Boolean)) {
        const msgs = set.map(([v, lvl, fcst]) => findMessage(messages, v, lvl, fcst));
        if (msgs.every(Boolean)) return msgs;
    }
    return null;
}

/*
 * Build the menu for one run's index: every category, holding only the items
 * this model actually carries. Categories that end up empty are dropped.
 *
 * Some items are deliberate duplicates covering a naming difference between
 * centres (PRMSL vs MSLMA for MSLP, LFTX at '500-1000 mb' vs 'surface'). At
 * most one of each pair resolves for a given model, but if a model ever
 * carried both, only the first is kept so the menu never shows the same label
 * twice.
 */
function buildCatalog(messages) {
    const out = [];
    for (const cat of CATEGORIES) {
        const items = [];
        const seenLabels = new Set();
        for (const item of cat.items) {
            let entry = null;
            if (item.derive) {
                const def = DERIVED[item.derive];
                if (!def) continue;
                const msgs = resolveDerived(messages, def);
                if (!msgs) continue;
                entry = {
                    id: item.id, label: item.label || def.label, kind: def.kind,
                    derive: item.derive, msgs: msgs.map((m) => m.n),
                };
            } else {
                const msg = findMessage(messages, item.v, item.lvl, item.fcst);
                if (!msg) continue;
                entry = {
                    id: item.id, label: item.label, kind: item.kind || null,
                    msg: msg.n, variable: msg.variable, level: msg.level, forecast: msg.forecast,
                };
            }
            if (seenLabels.has(entry.label)) continue;
            seenLabels.add(entry.label);
            items.push(entry);
        }
        if (items.length) out.push({ id: cat.id, label: cat.label, items });
    }
    return out;
}

module.exports = { CATEGORIES, buildCatalog, findMessage, resolveDerived };
