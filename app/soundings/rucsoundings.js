/*
 * rucsoundings.js
 * Fetches BUFKIT-style forecast (and observed) soundings from
 * rucsoundings.noaa.gov for an arbitrary lat/lon, and parses the GSD/FSL text
 * format into a clean profile the Skew-T renderer can draw.
 *
 * Routed through Vortex Radar's server CORS proxy (/api/proxy; *.noaa.gov is on
 * the allowlist) so the browser never hits a CORS wall.
 *
 * GSD data lines are:  TYPE  PRESSURE  HEIGHT  TEMP  DEWPT  WINDDIR  WINDSPD
 *   TYPE  9=surface 4=mandatory 5=sig-temp 6=sig-wind 7=tropopause 8=max-wind
 *   PRESSURE tenths of mb · HEIGHT m · TEMP/DEWPT tenths of °C · DIR deg · SPD kt
 *   99999 = missing
 */

// data_source values rucsoundings accepts. Labels are what we show in the UI.
const MODELS = [
    { id: 'Op40', label: 'RAP (Op40)' },
    { id: 'Bak40', label: 'RAP (previous run)' },
    { id: 'GFS', label: 'GFS' },
    { id: 'NAM', label: 'NAM' },
    { id: 'RAOB', label: 'Observed (balloon)' },
];

function buildUrl(model, lat, lon, fcstLen) {
    const base = 'https://rucsoundings.noaa.gov/get_soundings.cgi';
    const params = [
        'data_source=' + model,
        'latest=latest',
        'start_year=2024', 'start_month_name=Jan', 'start_mday=1', 'start_hour=0', 'start_min=0',
        'n_hrs=1.0',
        'fcst_len=' + (fcstLen || 'shortest'),
        'airport=' + lat.toFixed(3) + ',' + lon.toFixed(3),
        'text=Ascii%20text%20(GSD%20format)',
        'hydrometeors=false',
        'start=latest',
    ].join('&');
    return base + '?' + params;
}

const miss = (v) => (v === 99999 || v === 99999.0 ? null : v);

function parseGSD(text) {
    const lines = String(text || '').split(/\r?\n/);
    let header = null, cape = null, cin = null, helic = null, pw = null;
    const levels = [];

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        // First descriptive line: "Op40   6   9   Z   09 Aug 2025"
        if (!header && /\bZ\b/.test(line) && /\b\d{4}\b/.test(line)) header = line.replace(/\s+/g, ' ');

        if (/CAPE/i.test(line)) {
            const grab = (re) => { const m = line.match(re); return m ? parseInt(m[1], 10) : null; };
            cape = miss(grab(/CAPE\s+(-?\d+)/i));
            cin = miss(grab(/CIN\s+(-?\d+)/i));
            helic = miss(grab(/Helic\s+(-?\d+)/i));
            pw = miss(grab(/PW\s+(-?\d+)/i));
            continue;
        }

        const parts = line.split(/\s+/);
        if (parts.length !== 7) continue;
        const n = parts.map(Number);
        const type = n[0];
        if (![9, 4, 5, 6, 7, 8].includes(type)) continue; // skip id/metadata lines
        if (n.some((v) => Number.isNaN(v))) continue;

        const p = miss(n[1]);
        const z = miss(n[2]);
        const t = miss(n[3]);
        const td = miss(n[4]);
        const wdir = miss(n[5]);
        const wspd = miss(n[6]);
        levels.push({
            type,
            p: p == null ? null : p / 10,     // mb
            z,                                // m MSL
            t: t == null ? null : t / 10,     // °C
            td: td == null ? null : td / 10,  // °C
            wdir,                             // deg
            wspd,                             // kt
        });
    }

    levels.sort((a, b) => (b.p || 0) - (a.p || 0)); // surface (highest p) first
    const surfaceZ = (levels.find((l) => l.type === 9) || levels[0] || {}).z || 0;
    return { header, cape, cin, helic, pw, levels, surfaceZ };
}

async function fetchSounding(model, lat, lon, fcstLen) {
    const url = buildUrl(model, lat, lon, fcstLen);
    const res = await fetch('/api/proxy?url=' + url);
    if (!res.ok) throw new Error('Sounding service returned ' + res.status);
    const text = await res.text();
    if (/error|not (available|found)/i.test(text.slice(0, 120)) && !/CAPE/i.test(text)) {
        throw new Error('No sounding available for this point/model.');
    }
    const snd = parseGSD(text);
    if (!snd.levels.some((l) => l.p != null && l.t != null)) {
        throw new Error('No usable profile returned for this point.');
    }
    return snd;
}

module.exports = { MODELS, fetchSounding, parseGSD, buildUrl };
