/*
 * model_climatology.js
 * Long-term-mean grids, so a forecast field can be shown as an ANOMALY —
 * how far today departs from normal, rather than its absolute value.
 *
 * Source is the NCEP/NCAR reanalysis daily climatology (1981-2010) published by
 * NOAA PSL. Those files are NetCDF-4/HDF5, which is a heavy format to read, and
 * a whole year is ~18 MB per field. Both problems go away by asking THREDDS for
 * a single day over OPeNDAP as text: ~110 KB, no binary format to decode, and
 * the grid's own latitude and longitude arrays come back with it — which
 * matters because the temperature field is on a GAUSSIAN grid whose rows are
 * not evenly spaced and cannot be indexed arithmetically.
 *
 * One day of one field is fetched at most once per process and then cached, so
 * scrubbing forecast hours or panning the map costs nothing further.
 */

const THREDDS = 'https://psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis.derived';

const DATASETS = {
    pwat: {
        path: `${THREDDS}/surface/pr_wtr.eatm.day.1981-2010.ltm.nc`,
        varName: 'pr_wtr', nlat: 73, nlon: 144,
        // kg/m2, the same unit GRIB uses for PWAT, so no conversion.
        label: 'Precipitable Water',
    },
    t2m: {
        path: `${THREDDS}/surface_gauss/air.2m.day.1981-2010.ltm.nc`,
        varName: 'air', nlat: 94, nlon: 192,
        // Kelvin, matching GRIB TMP — so a difference is degrees C directly.
        label: '2 m Temperature',
    },
};

const cache = new Map();          // "id:doy" -> grid
const inflight = new Map();       // de-duplicates concurrent first requests

// Day of year, 1-365. Feb 29 folds onto Feb 28: the climatology has 365 days,
// and being one day out of a 30-year mean is not a meaningful error.
function dayOfYear(date) {
    const d = date instanceof Date ? date : new Date(date);
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    const doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000) + 1;
    return Math.min(365, Math.max(1, doy));
}

/*
 * Parse an OPeNDAP ASCII response.
 *
 * Layout after a dashed separator: a header naming the array and its shape,
 * one line per latitude row ("[0][j], v, v, ..."), then the MAPS — the time,
 * lat and lon coordinate arrays, each a header line followed by its values.
 */
function parseDodsAscii(text, varName, nlat, nlon) {
    const lines = text.split('\n');
    const values = new Float32Array(nlat * nlon);
    let lat = null, lon = null;
    let rows = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('[')) {
            // "[t][j], v1, v2, ..." — one full row of longitudes.
            const comma = line.indexOf(',');
            if (comma < 0) continue;
            const idx = line.slice(0, comma);
            const j = Number((idx.match(/\[(\d+)\]\s*$/) || [])[1]);
            if (!Number.isFinite(j) || j >= nlat) continue;
            const parts = line.slice(comma + 1).split(',');
            for (let k = 0; k < nlon && k < parts.length; k++) {
                values[j * nlon + k] = parseFloat(parts[k]);
            }
            rows++;
            continue;
        }

        const m = line.match(/^(\w+)\.(lat|lon)\[(\d+)\]$/);
        if (m) {
            const arr = (lines[i + 1] || '').split(',').map((x) => parseFloat(x));
            if (m[2] === 'lat') lat = arr; else lon = arr;
        }
    }

    if (rows !== nlat || !lat || !lon || lat.length !== nlat || lon.length !== nlon) {
        throw new Error(`climatology ${varName}: parsed ${rows}/${nlat} rows, lat ${lat && lat.length}, lon ${lon && lon.length}`);
    }
    return { values, lat, lon, nlat, nlon };
}

/*
 * Nearest index in a monotonic coordinate array.
 *
 * Written generically rather than as index arithmetic because the temperature
 * climatology is on a Gaussian grid: its rows cluster toward the equator, so
 * (target - first) / spacing would put values in the wrong place.
 */
function nearestIndex(arr, target) {
    const descending = arr[0] > arr[arr.length - 1];
    let lo = 0, hi = arr.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const goHigh = descending ? arr[mid] > target : arr[mid] < target;
        if (goHigh) lo = mid; else hi = mid;
    }
    return Math.abs(arr[lo] - target) <= Math.abs(arr[hi] - target) ? lo : hi;
}

async function loadDay(id, doy) {
    const ds = DATASETS[id];
    if (!ds) throw new Error(`Unknown climatology "${id}"`);
    const key = `${id}:${doy}`;
    if (cache.has(key)) return cache.get(key);
    if (inflight.has(key)) return inflight.get(key);

    const t = doy - 1;                                  // OPeNDAP indices are 0-based
    const url = `${ds.path}.ascii?${ds.varName}[${t}][0:${ds.nlat - 1}][0:${ds.nlon - 1}]`;
    const p = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`climatology fetch ${res.status}`);
        const grid = parseDodsAscii(await res.text(), ds.varName, ds.nlat, ds.nlon);
        cache.set(key, grid);
        inflight.delete(key);
        return grid;
    })();
    inflight.set(key, p);
    p.catch(() => inflight.delete(key));
    return p;
}

/*
 * A (lon, lat) -> climatological value function for one field and date.
 *
 * Longitudes are normalised into the grid's own 0-360 convention; a map
 * request in western hemisphere degrees would otherwise fall off the end of
 * the array and return nothing across the whole of the Americas.
 */
async function climoSampler(id, date) {
    const grid = await loadDay(id, dayOfYear(date));
    const { values, lat, lon, nlon } = grid;
    return (lonDeg, latDeg) => {
        let L = lonDeg % 360;
        if (L < 0) L += 360;
        const j = nearestIndex(lat, latDeg);
        const i = nearestIndex(lon, L);
        const v = values[j * nlon + i];
        return Number.isFinite(v) ? v : null;
    };
}

module.exports = { climoSampler, loadDay, dayOfYear, parseDodsAscii, nearestIndex, DATASETS };
