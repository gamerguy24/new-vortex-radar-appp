/*
 * soundings_grib.js
 * Assembles a point forecast sounding from raw NOAA model GRIB2 on public S3.
 *
 * For a clicked lat/lon it selects the pressure-level + near-surface messages it
 * needs from the run's parsed .idx, HTTP-Range-fetches each single message
 * (a few hundred KB, not the whole file), decodes it (grib2_decode.js), and
 * samples the grid point (grib2_render.sampleAt). Wind/dewpoint/PW/SRH are then
 * derived (sounding_math.js). Output matches what app/soundings/skewt.js draws.
 *
 * Fetched raw message bytes are cached in a byte-capped LRU keyed by the file
 * URL + message number, so repeat clicks in the same run skip S3. Decoded fields
 * are NOT cached (too large for Render's RAM).
 */

const { decodeGrib2Message } = require('./grib2_decode');
const { sampleAt } = require('./grib2_render');
const { dewpoint, windFromUV, precipWater, srh03 } = require('./sounding_math');

// Standard pressure levels to pull (those a model lacks are simply skipped).
const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100];
const PER_LEVEL = ['TMP', 'RH', 'UGRD', 'VGRD', 'HGT'];
const FETCH_CONCURRENCY = 8;

// ── byte-capped LRU of raw GRIB message buffers ───────────────────────────────
class ByteLRU {
    constructor(maxBytes) { this.max = maxBytes; this.bytes = 0; this.map = new Map(); }
    get(k) { const v = this.map.get(k); if (v) { this.map.delete(k); this.map.set(k, v); } return v; }
    set(k, buf) {
        if (this.map.has(k)) { this.bytes -= this.map.get(k).length; this.map.delete(k); }
        this.map.set(k, buf); this.bytes += buf.length;
        while (this.bytes > this.max && this.map.size) {
            const fk = this.map.keys().next().value;
            this.bytes -= this.map.get(fk).length; this.map.delete(fk);
        }
    }
}
const CACHE = new ByteLRU(300 * 1024 * 1024); // ~300 MB of raw message bytes

// Fetch (or cache-hit) one message's bytes, decode, and sample the point.
async function pointValue(msg, fileUrl, lat, lon) {
    const key = fileUrl + ':' + msg.n;
    let bytes = CACHE.get(key);
    if (!bytes) {
        const range = `bytes=${msg.start}-${msg.end == null ? '' : msg.end}`;
        const r = await fetch(fileUrl, { headers: { Range: range } });
        if (!(r.ok || r.status === 206)) throw new Error('S3 ' + r.status);
        bytes = Buffer.from(await r.arrayBuffer());
        CACHE.set(key, bytes);
    }
    const { values, grid } = decodeGrib2Message(bytes); // may throw on unsupported packing
    return sampleAt(grid, values, lon, lat);
}

// messages: parsed .idx rows (from model_data.fetchIdx)
async function buildSounding({ fileUrl, messages, lat, lon, header }) {
    const find = (V, lvlMatch) => messages.find(
        (x) => x.variable.toUpperCase() === V
            && (typeof lvlMatch === 'string' ? x.level.toLowerCase() === lvlMatch.toLowerCase() : lvlMatch.test(x.level)),
    );

    // Collect the messages we need (deduped by message number).
    const need = new Map(); // msg.n -> msg
    const want = (V, lvlMatch) => { const mm = find(V, lvlMatch); if (mm) need.set(mm.n, mm); return mm; };

    for (const L of LEVELS) for (const V of PER_LEVEL) want(V, `${L} mb`);
    want('PRES', 'surface'); want('HGT', 'surface');
    want('TMP', '2 m above ground'); want('DPT', '2 m above ground'); want('RH', '2 m above ground');
    want('UGRD', '10 m above ground'); want('VGRD', '10 m above ground');
    const capeMsg = find('CAPE', /surface/i) || find('CAPE', /.*/);
    const cinMsg = find('CIN', /surface/i) || find('CIN', /.*/);
    if (capeMsg) need.set(capeMsg.n, capeMsg);
    if (cinMsg) need.set(cinMsg.n, cinMsg);

    if (!need.size) throw new Error('This run has no pressure-level fields in its index.');

    // Fetch + sample all needed messages (bounded concurrency).
    const valueByN = new Map();
    const entries = [...need.values()];
    for (let i = 0; i < entries.length; i += FETCH_CONCURRENCY) {
        const batch = entries.slice(i, i + FETCH_CONCURRENCY);
        await Promise.all(batch.map(async (mm) => {
            try { valueByN.set(mm.n, await pointValue(mm, fileUrl, lat, lon)); }
            catch (e) { valueByN.set(mm.n, null); }
        }));
    }
    const getV = (V, lvlMatch) => { const mm = find(V, lvlMatch); return mm ? valueByN.get(mm.n) : null; };

    // Assemble the profile.
    const levels = [];

    // surface / near-surface level
    const sp = getV('PRES', 'surface'); // Pa
    if (sp != null) {
        const t2 = getV('TMP', '2 m above ground');      // K
        let td2C = null;
        const dpt2 = getV('DPT', '2 m above ground');    // K
        if (dpt2 != null) td2C = dpt2 - 273.15;
        else { const rh2 = getV('RH', '2 m above ground'); if (t2 != null && rh2 != null) td2C = dewpoint(t2 - 273.15, rh2); }
        const w = windFromUV(getV('UGRD', '10 m above ground'), getV('VGRD', '10 m above ground'));
        levels.push({ type: 9, p: sp / 100, z: getV('HGT', 'surface'), t: t2 != null ? t2 - 273.15 : null, td: td2C, wdir: w.wdir, wspd: w.wspd });
    }

    for (const L of LEVELS) {
        const lvl = `${L} mb`;
        const t = getV('TMP', lvl); // K
        if (t == null) continue;
        const rh = getV('RH', lvl);
        const tC = t - 273.15;
        const w = windFromUV(getV('UGRD', lvl), getV('VGRD', lvl));
        levels.push({ type: 4, p: L, z: getV('HGT', lvl), t: tC, td: dewpoint(tC, rh), wdir: w.wdir, wspd: w.wspd });
    }

    // Drop below-ground pressure levels (p greater than the surface pressure).
    const surfaceP = sp != null ? sp / 100 : null;
    let profile = surfaceP != null ? levels.filter((l) => l.type === 9 || l.p <= surfaceP + 1) : levels;

    profile.sort((a, b) => (b.p || 0) - (a.p || 0));
    const levelsOut = profile;
    if (levelsOut.filter((l) => l.p != null && l.t != null).length < 3) {
        throw new Error('No usable profile decoded (unsupported packing for this model?).');
    }

    const surfaceZ = getV('HGT', 'surface') ?? (levelsOut.find((l) => l.type === 9) || {}).z ?? 0;
    const cape = capeMsg ? valueByN.get(capeMsg.n) : null;
    const cin = cinMsg ? valueByN.get(cinMsg.n) : null;
    const pw = precipWater(levelsOut);
    const srh = srh03(levelsOut, surfaceZ);

    return {
        header: header || null,
        cape: cape == null ? null : Math.round(cape),
        cin: cin == null ? null : Math.round(cin),
        helic: srh == null ? null : Math.round(srh),
        pw: pw == null ? null : Math.round(pw * 10), // tenths of mm (skewt divides by 10)
        levels: levelsOut,
        surfaceZ,
    };
}

module.exports = { buildSounding };
