/*
 * goes_bands.js
 * GOES-East infrared bands 7–16, made from NOAA's own data rather than a
 * third-party tile service.
 *
 * Why this exists: the bands used to come from SSEC RealEarth, which caps
 * anonymous use — 1024px per picture and 500 megapixels a day per connection
 * — and stamps "Size limit exceeded" / "Pixel volume exceeded" across
 * anything past that. A radar app loops two hours of frames on screens wider
 * than 1024px all day, so both limits were hit. NOAA publishes every band of
 * every scan to a public S3 bucket (noaa-goes19, ABI-L2-CMIPC: Cloud and
 * Moisture Imagery, CONUS, every five minutes) with no limits at all.
 *
 * Each scan is a ~4 MB netCDF4 file of brightness temperatures on the ABI
 * fixed grid (the view from the satellite). This fetches it once, puts it in
 * web mercator, draws it in the standard greyscale — colder is brighter —
 * and keeps the PNG, so every user after the first is served from memory.
 *
 *   GET /api/goes-bands/:band/scans    -> { band, bounds:[W,S,E,N], scans:[{ id, at }] }
 *   GET /api/goes-bands/:band/:id.png  -> the scan, in mercator over `bounds`
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');

const BUCKET = 'https://noaa-goes19.s3.amazonaws.com';
const PRODUCT = 'ABI-L2-CMIPC';
const BANDS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/*
 * The greyscale stretch for each band, in kelvin: Tmin is drawn white and
 * Tmax black. Chosen per band because their useful ranges differ a lot — the
 * water vapour channels never see the warm ground, so a longwave stretch
 * would leave them a flat grey.
 */
const STRETCH = {
    7: [200, 330], 8: [190, 260], 9: [190, 270], 10: [190, 280],
    11: [180, 320], 12: [210, 290], 13: [180, 320], 14: [180, 320],
    15: [180, 320], 16: [190, 290],
};

/*
 * The CONUS sector's 2 km fixed grid (all of bands 7–16), as the files
 * describe it. Used only to choose the output's bounds once; every file is
 * mapped through its OWN grid, so a change on NOAA's side would still draw
 * in the right place.
 */
const CONUS_GRID = {
    x0: -0.101332, dx: 0.000056, nx: 2500,
    y0: 0.128212, dy: -0.000056, ny: 1500,
    lon0: -75, H: 35786023 + 6378137, req: 6378137, rpol: 6356752.31414,
};

// 2400px across the sector is about 4 km a pixel, against ABI's 2 km: as
// sharp as is worth sending 24 times over for a loop.
const OUT_W = 2400;
const FRAMES_MAX = 36;
const LIST_TTL_MS = 60 * 1000;

const rad = Math.PI / 180;
const MERC_R = 6378137;
const mercX = (lon) => MERC_R * lon * rad;
const mercY = (lat) => MERC_R * Math.log(Math.tan(Math.PI / 4 + lat * rad / 2));
const latOfMercY = (y) => (2 * Math.atan(Math.exp(y / MERC_R)) - Math.PI / 2) / rad;

/* Fixed-grid scan angles (radians) -> lat/lon in degrees, or null off the Earth. GOES-R PUG 4.2.8. */
function gridToLatLon(g, x, y) {
    const r2 = (g.req * g.req) / (g.rpol * g.rpol);
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y);
    const a = sx * sx + cx * cx * (cy * cy + r2 * sy * sy);
    const b = -2 * g.H * cx * cy;
    const c = g.H * g.H - g.req * g.req;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const rs = (-b - Math.sqrt(disc)) / (2 * a);
    const px = rs * cx * cy, py = -rs * sx, pz = rs * cx * sy;
    return {
        lat: Math.atan(r2 * pz / Math.sqrt((g.H - px) ** 2 + py * py)) / rad,
        lon: g.lon0 - Math.atan(py / (g.H - px)) / rad,
    };
}

/* lat/lon in degrees -> fixed-grid scan angles, or null where the satellite cannot see. */
function latLonToGrid(g, lat, lon) {
    const e2 = 1 - (g.rpol * g.rpol) / (g.req * g.req);
    const phi = lat * rad, dl = (lon - g.lon0) * rad;
    const phic = Math.atan((g.rpol * g.rpol) / (g.req * g.req) * Math.tan(phi));
    const rc = g.rpol / Math.sqrt(1 - e2 * Math.cos(phic) ** 2);
    const sx = g.H - rc * Math.cos(phic) * Math.cos(dl);
    const sy = -rc * Math.cos(phic) * Math.sin(dl);
    const sz = rc * Math.sin(phic);
    if (g.H * (g.H - sx) < sy * sy + (g.req * g.req) / (g.rpol * g.rpol) * sz * sz) return null;
    return { x: Math.asin(-sy / Math.sqrt(sx * sx + sy * sy + sz * sz)), y: Math.atan(sz / sx) };
}

/* The lat/lon box around the sector, found by walking its edge. [W, S, E, N]. */
function sectorBounds(g) {
    let W = 180, E = -180, S = 90, N = -90;
    const take = (i, j) => {
        const p = gridToLatLon(g, g.x0 + i * g.dx, g.y0 + j * g.dy);
        if (!p) return;
        W = Math.min(W, p.lon); E = Math.max(E, p.lon); S = Math.min(S, p.lat); N = Math.max(N, p.lat);
    };
    for (let i = 0; i < g.nx; i += 10) { take(i, 0); take(i, g.ny - 1); }
    for (let j = 0; j < g.ny; j += 10) { take(0, j); take(g.nx - 1, j); }
    const r = (v) => Math.round(v * 100) / 100;
    return [r(W), r(S), r(E), r(N)];
}

const BOUNDS = sectorBounds(CONUS_GRID);
const OUT_H = Math.round(OUT_W * (mercY(BOUNDS[3]) - mercY(BOUNDS[1])) / (mercX(BOUNDS[2]) - mercX(BOUNDS[0])));

/*
 * For each output pixel, the source pixel it shows (or -1). The same for
 * every scan on the same grid, so it is worked out once per grid and kept:
 * the trigonometry is most of the cost of a frame, and this does it once.
 */
const _luts = new Map();
function lutFor(g) {
    const key = [g.x0, g.dx, g.nx, g.y0, g.dy, g.ny, g.lon0].join();
    let lut = _luts.get(key);
    if (lut) return lut;
    lut = new Int32Array(OUT_W * OUT_H);
    const x0m = mercX(BOUNDS[0]), x1m = mercX(BOUNDS[2]);
    const y0m = mercY(BOUNDS[3]), y1m = mercY(BOUNDS[1]);
    for (let r = 0; r < OUT_H; r++) {
        const lat = latOfMercY(y0m + (y1m - y0m) * (r + 0.5) / OUT_H);
        for (let c = 0; c < OUT_W; c++) {
            const lon = (x0m + (x1m - x0m) * (c + 0.5) / OUT_W) / (MERC_R * rad);
            const s = latLonToGrid(g, lat, lon);
            let idx = -1;
            if (s) {
                const i = Math.round((s.x - g.x0) / g.dx);
                const j = Math.round((s.y - g.y0) / g.dy);
                if (i >= 0 && i < g.nx && j >= 0 && j < g.ny) idx = j * g.nx + i;
            }
            lut[r * OUT_W + c] = idx;
        }
    }
    _luts.set(key, lut);
    return lut;
}

// ── h5wasm (ESM-only, so loaded on first use) ────────────────────────────────
let _h5 = null;
async function h5() {
    if (!_h5) {
        _h5 = import('h5wasm/node').then(async (m) => {
            const h = m.default || m;
            await h.ready;
            return h;
        });
    }
    return _h5;
}
const attr = (ds, name) => {
    const a = ds.attrs[name];
    if (!a) return undefined;
    const v = a.value;
    return (v && typeof v === 'object' && 'length' in v) ? v[0] : v;
};

/* Decode one CMIP file into { temps: Float32Array (K, NaN = none), grid }. */
async function decode(buf) {
    const h = await h5();
    // The Node build of h5wasm reads real files, so the bytes go through a
    // temporary one that is gone again before this returns.
    const tmp = path.join(os.tmpdir(), `goes-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.nc`);
    fs.writeFileSync(tmp, buf);
    let f;
    try {
        f = new h.File(tmp, 'r');
        const cmi = f.get('CMI');
        const [ny, nx] = cmi.shape;
        const raw = cmi.value;
        const scale = attr(cmi, 'scale_factor'), offset = attr(cmi, 'add_offset');
        const fill = attr(cmi, '_FillValue');
        // Stored unsigned in a signed type (_Unsigned = "true"); 14 bits are data.
        const fillU = fill == null ? -1 : (fill & 0xffff);
        const temps = new Float32Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            const v = raw[i] & 0xffff;
            temps[i] = (v === fillU || v > 16383) ? NaN : v * scale + offset;
        }
        const xs = f.get('x'), ys = f.get('y'), proj = f.get('goes_imager_projection');
        const req = attr(proj, 'semi_major_axis');
        const grid = {
            x0: attr(xs, 'add_offset'), dx: attr(xs, 'scale_factor'), nx,
            y0: attr(ys, 'add_offset'), dy: attr(ys, 'scale_factor'), ny,
            lon0: attr(proj, 'longitude_of_projection_origin'),
            H: attr(proj, 'perspective_point_height') + req, req, rpol: attr(proj, 'semi_minor_axis'),
        };
        return { temps, grid };
    } finally {
        try { if (f) f.close(); } catch (e) { /* closed */ }
        try { fs.unlinkSync(tmp); } catch (e) { /* gone */ }
    }
}

/* Brightness temperatures -> a mercator PNG of the sector. */
function render(band, temps, grid) {
    const lut = lutFor(grid);
    const [tmin, tmax] = STRETCH[band];
    const k = 255 / (tmax - tmin);
    const png = new PNG({ width: OUT_W, height: OUT_H, colorType: 4 });
    const d = png.data;
    for (let p = 0, o = 0; p < lut.length; p++, o += 4) {
        const idx = lut[p];
        const t = idx < 0 ? NaN : temps[idx];
        if (t !== t) { d[o + 3] = 0; continue; }
        let g = Math.round((tmax - t) * k);
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        d[o] = d[o + 1] = d[o + 2] = g;
        d[o + 3] = 255;
    }
    return PNG.sync.write(png, { colorType: 4, deflateLevel: 6 });
}

// ── listing ──────────────────────────────────────────────────────────────────
const _lists = new Map();   // band -> { at, scans:[{ id, at, key }] }

function hourPrefix(ms, band) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const doy = Math.floor((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 1)) / 86400000) + 1;
    const hh = String(d.getUTCHours()).padStart(2, '0');
    return `${PRODUCT}/${y}/${String(doy).padStart(3, '0')}/${hh}/OR_${PRODUCT}-M6C${String(band).padStart(2, '0')}_G19_`;
}

// "s20262860136170" = year 2026, day 286, 01:36:17.0 UTC.
function scanMs(id) {
    const y = +id.slice(0, 4), doy = +id.slice(4, 7);
    return Date.UTC(y, 0, 1) + (doy - 1) * 86400000
        + (+id.slice(7, 9)) * 3600000 + (+id.slice(9, 11)) * 60000 + (+id.slice(11, 13)) * 1000;
}

async function listScans(band) {
    const hit = _lists.get(band);
    if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.scans;
    const scans = [];
    // Newest hour first, back far enough to fill the longest loop.
    for (let h = 0; h < 4 && scans.length < FRAMES_MAX; h++) {
        const prefix = hourPrefix(Date.now() - h * 3600000, band);
        const r = await fetch(`${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}`);
        if (!r.ok) throw new Error('S3 list ' + r.status);
        const xml = await r.text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
            const s = /_s(\d{14})_/.exec(m[1]);
            if (s) scans.push({ id: s[1], at: scanMs(s[1]), key: m[1] });
        }
    }
    scans.sort((a, b) => a.at - b.at);
    const out = scans.slice(-FRAMES_MAX);
    _lists.set(band, { at: Date.now(), scans: out });
    return out;
}

// ── rendered frames (a scan never changes, so these are kept until evicted) ─
const CACHE = { max: 400 * 1024 * 1024, bytes: 0, map: new Map() };
function cget(k) { const v = CACHE.map.get(k); if (v) { CACHE.map.delete(k); CACHE.map.set(k, v); } return v; }
function cset(k, buf) {
    CACHE.map.set(k, buf); CACHE.bytes += buf.length;
    while (CACHE.bytes > CACHE.max && CACHE.map.size) {
        const fk = CACHE.map.keys().next().value;
        CACHE.bytes -= CACHE.map.get(fk).length; CACHE.map.delete(fk);
    }
}

/*
 * One frame at a time through the decoder. A loop asks for two dozen at
 * once, and each is a few hundred milliseconds of CPU; queuing them keeps the
 * rest of the server responsive while the first viewer's loop fills.
 */
const _inflight = new Map();
let _chain = Promise.resolve();
function frame(band, id) {
    const k = `${band}/${id}`;
    const hit = cget(k);
    if (hit) return Promise.resolve(hit);
    if (_inflight.has(k)) return _inflight.get(k);
    const job = (async () => {
        const scans = await listScans(band);
        let scan = scans.find((s) => s.id === id);
        if (!scan) {
            // Older than the listing reaches; look in its own hour.
            const prefix = hourPrefix(scanMs(id), band);
            const r = await fetch(`${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix + 's' + id)}`);
            const m = r.ok ? /<Key>([^<]+)<\/Key>/.exec(await r.text()) : null;
            if (!m) throw Object.assign(new Error('no such scan'), { status: 404 });
            scan = { id, key: m[1] };
        }
        const r = await fetch(`${BUCKET}/${scan.key}`);
        if (!r.ok) throw new Error('S3 ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        const png = await (_chain = _chain.catch(() => {}).then(async () => {
            const { temps, grid } = await decode(buf);
            return render(band, temps, grid);
        }));
        cset(k, png);
        return png;
    })();
    _inflight.set(k, job);
    job.finally(() => _inflight.delete(k)).catch(() => {});
    return job;
}

function attachGoesBands(app, guard) {
    const g = guard || ((req, res, next) => next());
    const bandOf = (req) => {
        const b = Number(req.params.band);
        return BANDS.includes(b) ? b : null;
    };

    app.get('/api/goes-bands/:band/scans', g, async (req, res) => {
        const band = bandOf(req);
        if (!band) return res.status(400).json({ error: 'band must be 7–16' });
        try {
            const scans = await listScans(band);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ band, bounds: BOUNDS, scans: scans.map((s) => ({ id: s.id, at: s.at })) });
        } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
    });

    app.get('/api/goes-bands/:band/:id.png', g, async (req, res) => {
        const band = bandOf(req);
        const id = String(req.params.id || '');
        if (!band || !/^\d{14}$/.test(id)) return res.status(400).json({ error: 'bad band or scan id' });
        try {
            const png = await frame(band, id);
            res.setHeader('Content-Type', 'image/png');
            // A scan is fixed once taken, so the browser may keep it.
            res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
            res.send(png);
        } catch (e) {
            res.status(e.status || 502).json({ error: String(e.message || e) });
        }
    });
}

module.exports = { attachGoesBands, BOUNDS, _test: { decode, render, listScans, frame } };
