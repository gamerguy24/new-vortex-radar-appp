/*
 * model_ecmwf.js
 * Adapter for ECMWF IFS open data (bucket `ecmwf-forecasts`).
 *
 * ECMWF publishes the same thing NOAA does — GRIB2 with a byte-offset sidecar —
 * but describes it completely differently:
 *
 *   - the sidecar is `.index`, one JSON object per line, with `_offset` and
 *     `_length` rather than NOAA's colon-separated `.idx` with start offsets
 *   - parameters use ECMWF short names: `2t`, `10u`, `msl`, `mucape`, `gh`
 *   - levels are `levtype` + `levelist` instead of a printed level string
 *   - several fields are in different UNITS to their NOAA equivalents
 *
 * Rather than teach the whole pipeline a second dialect, this module translates
 * an ECMWF index into exactly the message shape the NOAA path already produces
 * ({ n, start, end, variable, level, forecast }). Everything downstream — the
 * product catalog, the derived fields, the renderer — then works unchanged.
 *
 * ONLY parameters whose unit conversion is known for certain are mapped. A
 * field plotted on the wrong scale is worse than a field that is missing, so
 * anything uncertain (ECMWF `sd` is snow water equivalent where NOAA `SNOD` is
 * snow depth; `q` exists only at pressure levels) is deliberately left out and
 * simply does not appear in the menu for this model.
 */

/*
 * ECMWF short name -> NOAA-style (variable, level) plus the factor that takes
 * ECMWF's units to the ones the NOAA renderer expects.
 *
 *   tp      metres of water   -> mm            (x1000)
 *   tprate  m/s               -> kg/m2/s       (x1000)
 *   tcc     0-1 fraction      -> percent       (x100)
 * everything else already matches (K, m/s, Pa, J/kg, m, %).
 */
const SFC_MAP = {
    '2t': ['TMP', '2 m above ground', 1],
    '2d': ['DPT', '2 m above ground', 1],
    'skt': ['TMP', 'surface', 1],
    '10u': ['UGRD', '10 m above ground', 1],
    '10v': ['VGRD', '10 m above ground', 1],
    '100u': ['UGRD', '100 m above ground', 1],
    '100v': ['VGRD', '100 m above ground', 1],
    '10fg': ['GUST', 'surface', 1],
    'msl': ['PRMSL', 'mean sea level', 1],
    'sp': ['PRES', 'surface', 1],
    'tp': ['APCP', 'surface', 1000],
    'tprate': ['PRATE', 'surface', 1000],
    'tcc': ['TCDC', 'entire atmosphere', 100],
    'tcwv': ['PWAT', 'entire atmosphere', 1],
    // ECMWF's CAPE is the most-unstable parcel; label it at the level the
    // product catalogue uses for MUCAPE so the existing entry finds it.
    'mucape': ['CAPE', '255-0 mb above ground', 1],
};

// Pressure-level parameters, same idea. `gh` is geopotential HEIGHT in metres
// (`z` is geopotential in m²/s² and is deliberately not mapped).
const PL_MAP = {
    't': ['TMP', 1],
    'r': ['RH', 1],
    'u': ['UGRD', 1],
    'v': ['VGRD', 1],
    'gh': ['HGT', 1],
};

/*
 * Turn an ECMWF `.index` body into NOAA-shaped messages.
 *
 * `n` is the record's position in the file, so it stays a stable handle for
 * /field?msg=. `scale` rides along and is applied at render time.
 */
function parseEcmwfIndex(text, fhr) {
    const out = [];
    let n = 0;
    for (const line of String(text).trim().split('\n')) {
        n++;
        let o;
        try { o = JSON.parse(line); } catch (e) { continue; }
        if (o._offset == null || o._length == null) continue;

        let variable = null, level = null, scale = 1;
        if (o.levtype === 'sfc' && SFC_MAP[o.param]) {
            [variable, level, scale] = SFC_MAP[o.param];
        } else if (o.levtype === 'pl' && PL_MAP[o.param] && o.levelist) {
            [variable, scale] = PL_MAP[o.param];
            level = `${o.levelist} mb`;
        } else {
            continue;                       // unmapped: not offered rather than guessed
        }

        out.push({
            n,
            start: Number(o._offset),
            end: Number(o._offset) + Number(o._length) - 1,
            runTag: `d=${o.date}${o.time}`,
            variable,
            level,
            // Total precipitation accumulates from run start, which is what the
            // catalogue's Total-QPF matcher (/^0-N hour acc/) looks for.
            forecast: (o.param === 'tp' || o.param === 'sf')
                ? `0-${fhr} hour acc fcst`
                : `${fhr} hour fcst`,
            scale,
            ecmwfParam: o.param,
        });
    }
    return out;
}

/*
 * ECMWF publishes one file per step, and the steps are not evenly spaced:
 * 3-hourly to +144, then 6-hourly to +360. Listing the run directory is both
 * cheaper and more truthful than assuming that schedule, since a run in
 * progress has only posted part of it.
 */
const ECMWF_STEP_RE = /-(\d+)h-oper-fc\.grib2$/;

const ECMWF_MODEL = {
    name: 'ECMWF IFS (0.25° global)', bucket: 'ecmwf-forecasts', region: 'eu-west-1',
    type: 'cycle', cycles: [0, 6, 12, 18], fhrMax: 360, fhrDigits: 0,
    products: { oper: 'oper' }, defaultProduct: 'oper',
    /*
     * ECMWF's sidecar REPLACES the .grib2 extension rather than being appended
     * to it: the index for "...-6h-oper-fc.grib2" is "...-6h-oper-fc.index",
     * not "...-6h-oper-fc.grib2.index". Appending, the way NOAA's .idx works,
     * produced a URL that 404s — which looked exactly like "no run posted".
     */
    idxKey: (key) => key.replace(/\.grib2$/, '.index'),
    indexType: 'ecmwf',
    dir: (d, c) => `${d}/${c}z/ifs/0p25/oper/`,
    hoursPrefix: (d, c) => `${d}/${c}z/ifs/0p25/oper/`,
    // No zero-padding: the step is written as-is ("6h", "144h").
    file: (d, c, f) => `${d}/${c}z/ifs/0p25/oper/${d}${c}0000-${Number(f)}h-oper-fc.grib2`,
    fhrRe: () => ECMWF_STEP_RE,
};

module.exports = { ECMWF_MODEL, parseEcmwfIndex, SFC_MAP, PL_MAP };
