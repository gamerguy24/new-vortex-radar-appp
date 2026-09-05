/*
 * NATIONAL RADAR — the MRMS (Multi-Radar Multi-Sensor) mosaic.
 *
 * This is the app's national radar view: one seamless picture of the whole
 * CONUS built by NOAA from every WSR-88D, as opposed to the single-site radar
 * the rest of the app plots. It is not a model and not a forecast — every
 * frame is observed data, updated about every two minutes.
 *
 * Renders any of the curated MRMS grids from the NOAA MRMS Public Data Set on
 * AWS S3 (noaa-mrms-pds). Files are fetched as .grib2.gz, gunzipped, GRIB2-
 * parsed and PNG-unpacked in the browser, painted onto a Canvas and overlaid
 * on the map as an image source.
 *
 * This used to be one hardcoded field — base reflectivity — with the dBZ colour
 * ramp baked into the painter. The bucket carries 243 CONUS products, so the
 * field is now chosen from a catalogue (mrms_products.js) that supplies its own
 * colour ramp, units, no-data floor and paint decimation.
 *
 * Reflectivity products deliberately keep using the app's REF colour table
 * rather than a ramp of their own, so MRMS and the single-site radar agree and
 * a user's custom palette applies to both.
 *
 * DATA SOURCE — the only one:
 *   arn:aws:s3:::noaa-mrms-pds   (us-east-1, public, unsigned)
 *   equivalent to: aws s3 ls --no-sign-request s3://noaa-mrms-pds/
 * Every request is built by _bucketUrl(), which refuses anything outside that
 * bucket, so the national mosaic cannot silently acquire a second provider.
 *
 * A note on time: the bucket is laid out by UTC day, and the eastern evening
 * crosses that boundary — 8pm EDT is 00:00 UTC the FOLLOWING day, when the new
 * folder holds only its first file or two. _getLatestKey walks back a day when
 * the current one is thin, which is what keeps the layer live across the flip.
 */

import Palettes from './palettes.js';
import { getProduct, buildRampLUT } from './mrms_products.js?v=mrms9';

const MRMS_BUCKET  = 'https://noaa-mrms-pds.s3.amazonaws.com';
const DEFAULT_PRODUCT_ID = 'ref_base';

const SOURCE_ID = 'mrms-img-src';
const LAYER_ID  = 'mrms-img-layer';

const LIST_CACHE_TTL_MS   = 60000;   // 1 min
const REFRESH_INTERVAL_MS = 120000;  // 2 min auto-refresh
const FETCH_TIMEOUT_MS    = 20000;   // 20 s per file

const MRMS_MISSING = -999;
// Superseded by each product's own `floor` (see mrms_products.js); kept only
// as the fallback for a product that does not declare one.
const DEFAULT_FLOOR = -30;

let _mapWrapper      = null;
let _active          = false;
let _refreshTimer    = null;
let _listCache       = null;
let _currentFrameKey = null;
let _rendering       = false;
let _lastRenderedKey = null;
let _productId       = DEFAULT_PRODUCT_ID;
/*
 * The decoded frame, kept so panning and zooming can repaint at the new
 * resolution without re-fetching. Decoding is 24.5 million points and a third
 * of a second; the download is a megabyte and a half. Neither should happen
 * again just because the map moved a little.
 */
let _frame           = null;   // { key, values, grid }
let _moveTimer       = null;
let _moveHooked      = false;

function _product() { return getProduct(_productId); }

document.addEventListener('paletteUpdated', (e) => {
    const name = e.detail?.paletteName;
    if ((name === 'MRMS_REF' || name === 'REF') && _active && _lastRenderedKey && _product().reflectivity) {
        _rendering = false;
        _fetchAndRender(_lastRenderedKey);
    }
});

function _pad(n) { return String(n).padStart(2, '0'); }

function _parseTimestamp(key) {
    const m = key.match(/(\d{8})-(\d{6})\.grib2/);
    if (!m) return null;
    const d = m[1], t = m[2];
    return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}Z`;
}

/*
 * Every request this layer makes goes through here, and nothing else builds a
 * URL for it.
 *
 * noaa-mrms-pds is the SOLE data provider for the MRMS national mosaic — no
 * mirror, no proxy, no tile service standing in for it. That is a property
 * worth enforcing rather than trusting: mosaics are the kind of layer that
 * quietly acquires a "temporary" fallback, and a second source would mean two
 * different national radars that disagree with each other and with the
 * single-site radar.
 *
 * The origin check is deliberately paranoid about a path that tries to climb
 * out of the bucket, since keys come from a listing response.
 */
function _bucketUrl(pathAndQuery) {
    const url = `${MRMS_BUCKET}/${String(pathAndQuery).replace(/^\/+/, '')}`;
    if (!url.startsWith(`${MRMS_BUCKET}/`) || url.includes('..')) {
        throw new Error(`[MRMS] refusing a request outside ${MRMS_BUCKET}: ${url}`);
    }
    return url;
}

async function _fetchS3Keys(prefix) {
    const keys = [];
    let token = null;
    do {
        const tp = token ? `&continuation-token=${encodeURIComponent(token)}` : '';
        const url = _bucketUrl(`?list-type=2&prefix=${encodeURIComponent(prefix)}${tp}`);
        const resp = await fetch(url, { cache: 'no-store' });
        const xml  = await resp.text();
        const re = /<Key>([^<]+)<\/Key>/g;
        let match;
        while ((match = re.exec(xml)) !== null) keys.push(match[1]);
        const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
        token = (next && /<IsTruncated>true<\/IsTruncated>/.test(xml)) ? next[1] : null;
    } while (token);
    return keys;
}

function u16(buf, off) { return (buf[off] << 8) | buf[off + 1]; }
function u32(buf, off) { return ((buf[off] << 24) | (buf[off+1] << 16) | (buf[off+2] << 8) | buf[off+3]) >>> 0; }
function s32(buf, off) { const v = u32(buf, off); return v > 0x7FFFFFFF ? v - 0x100000000 : v; }
function s16(buf, off) { const v = (buf[off] << 8) | buf[off + 1]; return v > 0x7FFF ? v - 0x10000 : v; }
function f32(buf, off) {
    const dv = new DataView(new Uint8Array([buf[off], buf[off+1], buf[off+2], buf[off+3]]).buffer);
    return dv.getFloat32(0, false);
}

function parseGrib2Sections(buf) {
    let off = 16;
    let sLen = u32(buf, off);
    off += sLen;

    let grid = null, drs = null, bitmap = null, dataBytes = null;

    while (off < buf.length - 4) {
        const tag = String.fromCharCode(buf[off], buf[off+1], buf[off+2], buf[off+3]);
        if (tag === '7777') break;

        sLen = u32(buf, off);
        if (sLen < 5 || sLen > buf.length - off) break;
        const sNum = buf[off + 4];

        if (sNum === 3) {
            const numPoints = u32(buf, off + 6);
            const tmpl = u16(buf, off + 12);
            if (tmpl === 0) {
                const basicAngle   = u32(buf, off + 38);
                const subdivisions = u32(buf, off + 42);
                const divisor = (basicAngle === 0 || subdivisions === 0) ? 1e6 : subdivisions / basicAngle;
                grid = {
                    numPoints,
                    nx:       u32(buf, off + 30),
                    ny:       u32(buf, off + 34),
                    lat1:     s32(buf, off + 46) / divisor,
                    lon1:     s32(buf, off + 50) / divisor,
                    lat2:     s32(buf, off + 55) / divisor,
                    lon2:     s32(buf, off + 59) / divisor,
                    di:       u32(buf, off + 63) / divisor,
                    dj:       u32(buf, off + 67) / divisor,
                    scanMode: buf[off + 71],
                };
            }
        } else if (sNum === 5) {
            drs = {
                numDataPoints: u32(buf, off + 5),
                template:      u16(buf, off + 9),
                refValue:      f32(buf, off + 11),
                binaryScale:   s16(buf, off + 15),
                decimalScale:  s16(buf, off + 17),
                nbits:         buf[off + 19],
            };
        } else if (sNum === 6) {
            bitmap = buf[off + 5];
        } else if (sNum === 7) {
            dataBytes = buf.slice(off + 5, off + sLen);
        }

        off += sLen;
    }

    return { grid, drs, bitmap, dataBytes };
}

async function decodePNG16(dataBytes) {
    const buf = dataBytes;
    if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('Not a PNG');

    let off = 8;
    let width = 0, height = 0, bitDepth = 0, colorType = 0;
    const idatChunks = [];

    while (off < buf.length) {
        const chunkLen = (buf[off] << 24 | buf[off+1] << 16 | buf[off+2] << 8 | buf[off+3]) >>> 0;
        const chunkType = String.fromCharCode(buf[off+4], buf[off+5], buf[off+6], buf[off+7]);
        const chunkData = buf.subarray(off + 8, off + 8 + chunkLen);

        if (chunkType === 'IHDR') {
            width     = (chunkData[0] << 24 | chunkData[1] << 16 | chunkData[2] << 8 | chunkData[3]) >>> 0;
            height    = (chunkData[4] << 24 | chunkData[5] << 16 | chunkData[6] << 8 | chunkData[7]) >>> 0;
            bitDepth  = chunkData[8];
            colorType = chunkData[9];
        } else if (chunkType === 'IDAT') {
            idatChunks.push(chunkData);
        } else if (chunkType === 'IEND') {
            break;
        }

        off += 12 + chunkLen;
    }

    if (!width || !height) throw new Error('PNG missing IHDR');

    let totalIdat = 0;
    for (const c of idatChunks) totalIdat += c.length;
    const compressedBuf = new Uint8Array(totalIdat);
    let pos = 0;
    for (const c of idatChunks) { compressedBuf.set(c, pos); pos += c.length; }

    const ds = new DecompressionStream('deflate');
    const stream = new Blob([compressedBuf]).stream().pipeThrough(ds);
    const reader = stream.getReader();
    const chunks = [];
    let totalLen = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLen += value.length;
        }
    } catch (_) { /* ok at end of valid data */ }
    const rawData = new Uint8Array(totalLen);
    let rp = 0;
    for (const c of chunks) { rawData.set(c, rp); rp += c.length; }

    const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
    const bytesPerPixel = channels * (bitDepth >> 3);
    const stride = width * bytesPerPixel;

    const out = new Uint8Array(height * stride);
    let ri = 0;
    for (let y = 0; y < height; y++) {
        const filter = rawData[ri++];
        const rowOff = y * stride;
        const prevRowOff = rowOff - stride;
        for (let x = 0; x < stride; x++) {
            const raw = rawData[ri++] || 0;
            let a = (x >= bytesPerPixel) ? out[rowOff + x - bytesPerPixel] : 0;
            let b = (y > 0) ? out[prevRowOff + x] : 0;
            let c_ = (y > 0 && x >= bytesPerPixel) ? out[prevRowOff + x - bytesPerPixel] : 0;
            let val;
            switch (filter) {
                case 0: val = raw; break;
                case 1: val = (raw + a) & 0xFF; break;
                case 2: val = (raw + b) & 0xFF; break;
                case 3: val = (raw + ((a + b) >> 1)) & 0xFF; break;
                case 4: {
                    const p = a + b - c_;
                    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c_);
                    val = (raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c_)) & 0xFF;
                    break;
                }
                default: val = raw;
            }
            out[rowOff + x] = val;
        }
    }

    const pixels = new Uint16Array(width * height);
    if (bitDepth === 16) {
        for (let i = 0; i < width * height; i++) {
            pixels[i] = (out[i * bytesPerPixel] << 8) | out[i * bytesPerPixel + 1];
        }
    } else if (bitDepth === 8) {
        for (let i = 0; i < width * height; i++) {
            pixels[i] = out[i * bytesPerPixel];
        }
    }

    return { width, height, bitDepth, pixels };
}

async function unpackGrib2Data(drs, dataBytes, numPoints, nx, ny) {
    const R = drs.refValue;
    const E = drs.binaryScale;
    const D = drs.decimalScale;
    const bFactor = Math.pow(2, E);
    const dFactor = Math.pow(10, D);

    if (drs.template === 0) {
        const nbits = drs.nbits;
        const values = new Float32Array(numPoints);
        if (nbits === 0) { values.fill(R / dFactor); return values; }
        let bitPos = 0;
        for (let i = 0; i < numPoints; i++) {
            let X = 0;
            for (let b = 0; b < nbits; b++) {
                const byteIdx = (bitPos + b) >> 3;
                const bitIdx  =  7 - ((bitPos + b) & 7);
                X = (X << 1) | ((dataBytes[byteIdx] >> bitIdx) & 1);
            }
            bitPos += nbits;
            values[i] = (R + X * bFactor) / dFactor;
        }
        return values;
    }

    if (drs.template === 40 || drs.template === 41) {
        const png = await decodePNG16(dataBytes);
        const values = new Float32Array(numPoints);
        const count = Math.min(numPoints, png.pixels.length);
        for (let i = 0; i < count; i++) {
            values[i] = (R + png.pixels[i] * bFactor) / dFactor;
        }
        return values;
    }

    throw new Error(`Unsupported GRIB2 DRS template: ${drs.template}`);
}

function _parseRgb(str) {
    const m = String(str).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return null;
    const a = m[4] !== undefined ? Number(m[4]) : 1;
    return { r: +m[1], g: +m[2], b: +m[3], a: Math.round(a <= 1 ? a * 255 : a) };
}

/*
 * Reflectivity colours come from the APP's colortable, not a table of our own.
 *
 * This layer used to carry a hardcoded fifteen-stop NWS ramp in
 * components/palettes.js, entirely separate from app/radar/colormaps. So the
 * national mosaic and the single-site radar coloured the same dBZ differently,
 * and a colortable the user uploaded changed one and not the other — the two
 * radars visibly disagreeing about the same storm.
 *
 * window.vortexColormaps is published by the bundle (colormaps.js). N0B is the
 * base-reflectivity table, and it is what the colortable menu rewrites in place
 * when a different table is picked, so reading it here means MRMS follows every
 * choice automatically. The bundled palette stays as the fallback for the
 * moment before the bundle has loaded.
 *
 * The table's `values` deliberately contain REPEATED entries (…25, 25, 30…) to
 * make hard band edges. Array.prototype.sort is stable, so equal values keep
 * their order and those edges survive; the interpolation below guards the
 * zero-width segment they create.
 */
function buildPaletteLUT() {
    const stops = [];
    const app = (typeof window !== 'undefined') && window.vortexColormaps && window.vortexColormaps.N0B;

    if (app && Array.isArray(app.values) && Array.isArray(app.colors) && app.values.length) {
        for (let i = 0; i < app.values.length && i < app.colors.length; i++) {
            const c = _parseRgb(app.colors[i]);
            if (c) stops.push({ val: Number(app.values[i]), ...c });
        }
    }
    if (!stops.length) {
        const pal = new Palettes();
        const palArray = pal.palettes['MRMS_REF'] ? pal.getPalette('MRMS_REF') : pal.getPalette('REF');
        for (let i = 0; i < palArray.length; i += 2) {
            const c = _parseRgb(palArray[i + 1]);
            if (c) stops.push({ val: Number(palArray[i]), ...c });
        }
    }
    stops.sort((a, b) => a.val - b.val);

    const SIZE = 281;
    const lut = new Uint8ClampedArray(SIZE * 4);
    for (let idx = 0; idx < SIZE; idx++) {
        const dbz = idx / 2 - 40;
        if (!stops.length || dbz < stops[0].val) { lut[idx*4+3] = 0; continue; }
        if (dbz >= stops[stops.length - 1].val) {
            const c = stops[stops.length - 1];
            lut[idx*4]=c.r; lut[idx*4+1]=c.g; lut[idx*4+2]=c.b; lut[idx*4+3]=c.a;
            continue;
        }
        for (let s = 0; s < stops.length - 1; s++) {
            if (dbz >= stops[s].val && dbz <= stops[s+1].val) {
                const l = stops[s], r = stops[s+1];
                const t = r.val > l.val ? (dbz - l.val) / (r.val - l.val) : 0;
                lut[idx*4]   = Math.round(l.r + (r.r - l.r) * t);
                lut[idx*4+1] = Math.round(l.g + (r.g - l.g) * t);
                lut[idx*4+2] = Math.round(l.b + (r.b - l.b) * t);
                lut[idx*4+3] = Math.round(l.a + (r.a - l.a) * t);
                break;
            }
        }
    }
    return lut;
}

function dbzToLutIdx(dbz) { return Math.max(0, Math.min(280, Math.round((dbz + 40) * 2))); }

/*
 * Paint a decoded grid using the ACTIVE product's colours.
 *
 * Two colour paths, on purpose:
 *   - reflectivity products go through the app's REF palette, so MRMS matches
 *     the single-site radar and honours a user's custom colour table;
 *   - everything else uses the ramp declared in the catalogue, sampled once
 *     into a 256-entry table. A CONUS grid is 24.5 million points (98 million
 *     for the rotation grids), so per-pixel work has to be an array index, not
 *     an interpolation.
 *
 * STEP comes from the product too. The rotation grids are 14000x7000 and would
 * otherwise produce a canvas four times the area of every other field.
 */
/*
 * WEB MERCATOR ROW MAPPING — the reason this is not a straight copy.
 *
 * A Mapbox `image` source stretches the picture linearly in Web Mercator Y
 * between the corner coordinates it is given. The MRMS grid is
 * EQUIRECTANGULAR: a fixed 0.01 degrees of latitude per row, linear in
 * latitude, not in Mercator.
 *
 * Painting the grid row-for-row and handing Mapbox the bounding box therefore
 * puts every row at the wrong latitude, and the error is worst in the middle
 * of the box — for the CONUS grid (55N to 20N) that is up to 2.2 degrees, about
 * 240 km, pushing everything NORTHWARD. Storms in south Georgia were drawn over
 * central Georgia; echoes off the Carolina coast were drawn over Virginia and
 * DC. It looks like plausible weather in the wrong place, which is exactly the
 * kind of wrong that goes unnoticed until someone looks out of the window.
 *
 * So the canvas is painted in MERCATOR space: for each output row we work out
 * the latitude Mapbox will place it at, then sample the grid row that actually
 * covers that latitude. Longitude needs no such treatment — Mercator X is
 * linear in longitude.
 */
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
function _mercY(lat) { return Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)); }
function _invMercY(y) { return (2 * (Math.atan(Math.exp(y)) - Math.PI / 4)) * R2D; }

/*
 * WHICH PART OF THE GRID TO DRAW, AND HOW FINELY.
 *
 * Painting the whole CONUS grid into one image is what made this look blurry.
 * The mosaic spans 70 degrees of longitude; at the old fixed decimation that
 * was 3500 pixels across, about 2.2 km per pixel. Zoomed into a county the
 * screen is nearer 0.15 km per pixel, so Mapbox was upscaling the picture some
 * fifteen times — soft blobs, no matter how good the data underneath.
 *
 * So the layer now paints only the visible window, at the finest resolution
 * that window needs, exactly as the model overlay does. Zoomed out you get the
 * whole country decimated; zoomed in you get the grid's native 1 km detail
 * over the part you are actually looking at.
 *
 * The window is padded so a small pan does not immediately expose an edge, and
 * the step is chosen so the canvas never exceeds MAX_CANVAS_PX across — a
 * 7000x3500 canvas is 98 MB of RGBA and not something to hand a phone.
 */
const MAX_CANVAS_PX = 3600;
// How far past one pixel per grid cell we are willing to draw. The data is
// 1 km; rendering it at three times that lets a colour boundary land on a
// pixel instead of being stretched, without pretending to detail that is not
// there.
const SUPERSAMPLE = 3;
const VIEW_PAD = 0.25;            // fraction of the view added on each side

function _gridWindow(grid) {
    const lonW0 = grid.lon1 > 180 ? grid.lon1 - 360 : grid.lon1;
    const latTop = Math.max(grid.lat1, grid.lat2);
    const latBot = Math.min(grid.lat1, grid.lat2);
    const full = {
        i0: 0, i1: grid.nx - 1, j0: 0, j1: grid.ny - 1,
        west: lonW0, east: lonW0 + (grid.nx - 1) * grid.di,
        north: latTop, south: latBot,
    };

    const map = _getMap();
    if (!map || typeof map.getBounds !== 'function') return full;
    let b;
    try { b = map.getBounds(); } catch (e) { return full; }
    if (!b) return full;

    const padLon = (b.getEast() - b.getWest()) * VIEW_PAD;
    const padLat = (b.getNorth() - b.getSouth()) * VIEW_PAD;
    const west = Math.max(full.west, b.getWest() - padLon);
    const east = Math.min(full.east, b.getEast() + padLon);
    const south = Math.max(full.south, b.getSouth() - padLat);
    const north = Math.min(full.north, b.getNorth() + padLat);
    // Off the grid entirely (looking at Europe, say): nothing to draw.
    if (!(east > west) || !(north > south)) return null;

    const i0 = Math.max(0, Math.floor((west - full.west) / grid.di));
    const i1 = Math.min(grid.nx - 1, Math.ceil((east - full.west) / grid.di));
    const j0 = Math.max(0, Math.floor((latTop - north) / grid.dj));
    const j1 = Math.min(grid.ny - 1, Math.ceil((latTop - south) / grid.dj));
    if (i1 <= i0 || j1 <= j0) return null;

    return {
        i0, i1, j0, j1,
        west: full.west + i0 * grid.di,
        east: full.west + i1 * grid.di,
        north: latTop - j0 * grid.dj,
        south: latTop - j1 * grid.dj,
    };
}

/*
 * Paint the window at the SCREEN's resolution, sampling the data smoothly.
 *
 * Two things made this look soft, and only one of them was the window size.
 *
 * The canvas used to hold at most one pixel per grid cell. At a county zoom
 * that image still has to be magnified to fill the screen, and - worse -
 * colour was assigned per CELL and the finished picture then stretched, so
 * every boundary between two colours got smeared across however many screen
 * pixels the magnification covered. Bands of colour with soft edges is exactly
 * what "blurry" looks like.
 *
 * So the canvas is now sized to the screen, and the DATA is interpolated to
 * each output pixel BEFORE any colour is chosen. Colour boundaries then land
 * on a single pixel and stay crisp while the field varies smoothly - the same
 * trick the single-site radar uses when its smoothing is on.
 *
 * Sampling adapts to which way we are scaling:
 *   - more than one cell per output pixel (zoomed out): box-average, the
 *     correct downsample, which also avoids the shimmer of point-sampling;
 *   - otherwise (zoomed in): bilinear between the four surrounding cells.
 * With smoothing off both become nearest-neighbour, giving honest hard cells.
 *
 * No-data is never mixed in as a value: it simply loses its weight, and a
 * pixel with no valid neighbours stays transparent. Averaging "no echo" into
 * a real value would drag every storm edge down and ring it with invented
 * weak returns.
 */
/*
 * Paint the window at the SCREEN's resolution, sampling the data smoothly.
 *
 * Two things made this look soft, and only one of them was the window size.
 *
 * The canvas used to hold at most one pixel per grid cell. At a county zoom
 * that image still has to be magnified to fill the screen, and - worse -
 * colour was assigned per CELL and the finished picture then stretched, so
 * every boundary between two colours got smeared across however many screen
 * pixels the magnification covered. Bands of colour with soft edges is exactly
 * what "blurry" looks like.
 *
 * So the canvas is now sized to the screen, and the DATA is interpolated to
 * each output pixel BEFORE any colour is chosen. Colour boundaries then land
 * on a single pixel and stay crisp while the field varies smoothly - the same
 * trick the single-site radar uses when its smoothing is on.
 *
 * Sampling adapts to which way we are scaling:
 *   - more than one cell per output pixel (zoomed out): box-average, the
 *     correct downsample, which also avoids the shimmer of point-sampling;
 *   - otherwise (zoomed in): bilinear between the four surrounding cells.
 * With smoothing off both become nearest-neighbour, giving honest hard cells.
 *
 * No-data is never mixed in as a value: it simply loses its weight, and a
 * pixel with no valid neighbours stays transparent. Averaging "no echo" into
 * a real value would drag every storm edge down and ring it with invented
 * weak returns.
 */
function paintToCanvas(values, grid, win) {
    const { nx, ny, scanMode } = grid;
    const product = _product();
    const isRef = !!product.reflectivity;

    const lut = isRef ? buildPaletteLUT() : null;
    const ramp = isRef ? null : buildRampLUT(product);
    const floor = product.floor != null ? product.floor : DEFAULT_FLOOR;
    const smooth = (typeof window === 'undefined') || window.vortexSmoothing !== false;

    const winCols = win.i1 - win.i0 + 1;
    const winRows = win.j1 - win.j0 + 1;

    /*
     * Target size: how many device pixels the map will actually give this
     * window. Capped both ways - never past MAX_CANVAS_PX, and never more than
     * SUPERSAMPLE times the cell count, beyond which we would only be
     * interpolating our own interpolation.
     */
    let targetW = winCols;
    const map = _getMap();
    try {
        if (map && typeof map.getCanvas === 'function' && typeof map.getBounds === 'function') {
            const b = map.getBounds();
            const viewLon = b.getEast() - b.getWest();
            const winLon = win.east - win.west;
            if (viewLon > 0 && winLon > 0) {
                targetW = Math.round(map.getCanvas().width * (winLon / viewLon));
            }
        }
    } catch (e) { /* keep the cell-count default */ }

    const cw = Math.max(1, Math.min(MAX_CANVAS_PX, Math.round(
        Math.min(Math.max(targetW, 1), winCols * SUPERSAMPLE))));
    const ch = Math.max(1, Math.round(cw * (winRows / winCols)));

    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(cw, ch);
    const pix = imgData.data;
    const flipJ = (scanMode & 0x40) !== 0;

    const latTop = Math.max(grid.lat1, grid.lat2);
    const dj = grid.dj || ((latTop - Math.min(grid.lat1, grid.lat2)) / (ny - 1));
    const yTop = _mercY(win.north);
    const yBot = _mercY(win.south);

    // Grid row for each output row, as a FRACTION so it can be interpolated.
    const rowAt = new Float32Array(ch);
    for (let cy = 0; cy < ch; cy++) {
        const lat = _invMercY(yTop + ((cy + 0.5) / ch) * (yBot - yTop));
        rowAt[cy] = (latTop - lat) / dj;
    }
    const cellsPerPixelX = winCols / cw;
    const cellsPerPixelY = winRows / ch;
    const downsampling = smooth && (cellsPerPixelX > 1.2 || cellsPerPixelY > 1.2);

    const rowIndex = (j) => (flipJ ? ny - 1 - j : j);

    const valueAtCell = (j, i) => {
        if (j < 0 || j > ny - 1 || i < 0 || i > nx - 1) return NaN;
        const v = values[rowIndex(j) * nx + i];
        return (!Number.isFinite(v) || v <= MRMS_MISSING + 1 || v < floor) ? NaN : v;
    };

    // Zoomed out: average the cells this pixel covers.
    const boxAt = (fj, fi) => {
        const j0 = Math.max(win.j0, Math.round(fj - cellsPerPixelY / 2));
        const j1 = Math.min(win.j1, Math.round(fj + cellsPerPixelY / 2));
        const i0 = Math.max(win.i0, Math.round(fi - cellsPerPixelX / 2));
        const i1 = Math.min(win.i1, Math.round(fi + cellsPerPixelX / 2));
        let sum = 0, n = 0;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const v = valueAtCell(j, i);
                if (Number.isFinite(v)) { sum += v; n++; }
            }
        }
        return n ? sum / n : NaN;
    };

    // Zoomed in: bilinear across the four surrounding cells, weighting only
    // the ones that actually hold data.
    /*
     * Anchored to the NEAREST cell first. Interpolating wherever any of the
     * four neighbours held data would paint a pixel just for being next to an
     * echo, growing every storm by a cell - measured at 27% more painted
     * area, which reads as light returns that are not there. Requiring the
     * nearest cell to be real keeps the footprint identical to
     * nearest-neighbour and lets the interpolation do only what it is for:
     * smooth the values inside.
     */
    const bilinearAt = (fj, fi) => {
        if (!Number.isFinite(valueAtCell(Math.round(fj), Math.round(fi)))) return NaN;
        const j0 = Math.floor(fj), i0 = Math.floor(fi);
        const tj = fj - j0, ti = fi - i0;
        let sum = 0, wsum = 0;
        for (let dj2 = 0; dj2 <= 1; dj2++) {
            for (let di2 = 0; di2 <= 1; di2++) {
                const v = valueAtCell(j0 + dj2, i0 + di2);
                if (!Number.isFinite(v)) continue;
                const w = (dj2 ? tj : 1 - tj) * (di2 ? ti : 1 - ti);
                if (w <= 0) continue;
                sum += v * w; wsum += w;
            }
        }
        return wsum > 0 ? sum / wsum : NaN;
    };

    for (let cy = 0; cy < ch; cy++) {
        const fj = rowAt[cy];
        for (let cx = 0; cx < cw; cx++) {
            const fi = win.i0 + ((cx + 0.5) / cw) * winCols - 0.5;
            let v;
            if (!smooth) v = valueAtCell(Math.round(fj), Math.round(fi));
            else if (downsampling) v = boxAt(fj, fi);
            else v = bilinearAt(fj, fi);

            const po = (cy * cw + cx) * 4;
            if (!Number.isFinite(v)) { pix[po + 3] = 0; continue; }

            let li;
            if (isRef) {
                li = dbzToLutIdx(v) * 4;
                pix[po] = lut[li]; pix[po + 1] = lut[li + 1];
                pix[po + 2] = lut[li + 2]; pix[po + 3] = lut[li + 3];
            } else {
                const t = (v - ramp.min) / ((ramp.max - ramp.min) || 1);
                li = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
                pix[po] = ramp.lut[li]; pix[po + 1] = ramp.lut[li + 1];
                pix[po + 2] = ramp.lut[li + 2]; pix[po + 3] = ramp.lut[li + 3];
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

const LEGEND_ID = 'vortexMrmsLegend';
// Beyond this, a frame is called out as stale instead of being presented as
// current. MRMS updates every ~2 minutes, so a quarter hour is well past "the
// feed hiccupped" and into "do not trust this".
const STALE_AFTER_MIN = 15;

function _removeLegend() {
    const el = document.getElementById(LEGEND_ID);
    if (el) el.remove();
}

/*
 * On-map legend for the MRMS layer.
 *
 * The layer used to paint with no label at all, which is how a national
 * mosaic ends up indistinguishable from a model forecast overlay covering the
 * same area — and left "is this live?" as something you could only answer by
 * reading the console. It now states the product, its units, the frame's valid
 * time and how old that frame is, and says so plainly when the feed is stale.
 */
function _drawLegend(s3Key) {
    _removeLegend();
    const product = _product();

    // Sample the same colours the painter uses, so the bar cannot disagree
    // with the map.
    const stops = [];
    if (product.reflectivity) {
        const lut = buildPaletteLUT();
        for (let i = 0; i <= 16; i++) {
            const dbz = -30 + (i / 16) * 105;
            const li = dbzToLutIdx(dbz) * 4;
            stops.push(`rgb(${lut[li]},${lut[li+1]},${lut[li+2]}) ${(i / 16 * 100).toFixed(0)}%`);
        }
    } else {
        const r = buildRampLUT(product);
        for (let i = 0; i <= 16; i++) {
            const li = Math.round((i / 16) * 255) * 4;
            stops.push(`rgb(${r.lut[li]},${r.lut[li+1]},${r.lut[li+2]}) ${(i / 16 * 100).toFixed(0)}%`);
        }
    }

    const iso = _parseTimestamp(s3Key);
    let ageMin = null, timeLabel = '—';
    if (iso) {
        const t = Date.parse(iso);
        if (Number.isFinite(t)) {
            ageMin = Math.round((Date.now() - t) / 60000);
            timeLabel = iso.slice(11, 16) + 'Z';
        }
    }
    const stale = ageMin != null && ageMin > STALE_AFTER_MIN;
    const ageText = ageMin == null ? 'unknown age'
        : ageMin < 1 ? 'just now'
        : ageMin === 1 ? '1 min ago'
        : `${ageMin} min ago`;

    let lo, hi;
    if (product.reflectivity) { lo = -30; hi = 75; }
    else { const r = buildRampLUT(product); lo = r.min; hi = r.max; }
    const fmt = (v) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1));

    const el = document.createElement('div');
    el.id = LEGEND_ID;
    el.innerHTML = `
        <div class="vml-title">MRMS · ${product.label}${product.unit ? ` <span style="opacity:.6">(${product.unit})</span>` : ''}</div>
        <div class="vml-bar" style="background:linear-gradient(90deg, ${stops.join(', ')})"></div>
        <div class="vml-scale"><span>${fmt(lo)}</span><span>${fmt((lo + hi) / 2)}</span><span>${fmt(hi)}</span></div>
        <div class="vml-age${stale ? ' stale' : ''}">${stale ? '⚠ STALE — ' : ''}${timeLabel} · ${ageText}</div>`;
    document.body.appendChild(el);
}

async function _fetchAndRender(s3Key) {
    if (_rendering) return;
    _rendering = true;
    try {
        const url = _bucketUrl(s3Key);
        console.log(`[MRMS] Fetching ${s3Key}`);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const resp = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const ds = new DecompressionStream('gzip');
        const decompressed = (resp.body || new Blob([await resp.arrayBuffer()]).stream()).pipeThrough(ds);
        const reader = decompressed.getReader();
        const chunks = []; let totalLen = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); totalLen += value.length;
        }
        const buf = new Uint8Array(totalLen);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }

        console.log(`[MRMS] Decompressed: ${buf.length} bytes`);
        if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'GRIB') throw new Error('Not GRIB2');

        const { grid, drs, dataBytes } = parseGrib2Sections(buf);
        if (!grid || !drs || !dataBytes) throw new Error('GRIB2 parse failed');

        console.log(`[MRMS] Grid ${grid.nx}x${grid.ny}  lat ${grid.lat1}..${grid.lat2}  lon ${grid.lon1}..${grid.lon2}`);
        console.log(`[MRMS] DRS: tmpl=${drs.template} ref=${drs.refValue} bscale=${drs.binaryScale} dscale=${drs.decimalScale} nbits=${drs.nbits}`);

        const values = await unpackGrib2Data(drs, dataBytes, grid.numPoints, grid.nx, grid.ny);

        _frame = { key: s3Key, values, grid };
        await _repaint();
        _hookMapMove();
        _lastRenderedKey = s3Key;
        _drawLegend(s3Key);
        console.log(`[MRMS] Rendered frame: ${_parseTimestamp(s3Key) || 'latest'}`);
    } catch (err) {
        console.error('[MRMS] Fetch/render failed:', err);
    } finally {
        _rendering = false;
    }
}

/*
 * Paint the frame we already have for wherever the map is now.
 *
 * Separate from fetching on purpose: a pan or a zoom changes which part of the
 * grid we need and how finely, but not which frame, so this runs on its own
 * without touching the network.
 */
/*
 * Turn the painted canvas into something an image source will take.
 *
 * toDataURL base64-encodes a PNG synchronously on the main thread. At a county
 * zoom this canvas is three million pixels, so doing that on every repaint —
 * and a repaint follows every zoom — is a visible hitch. toBlob does the same
 * work off-thread and skips the base64 inflation entirely; the object URL is
 * revoked when the next one replaces it so the blobs do not accumulate.
 */
let _objectUrl = null;
function _canvasUrl(canvas) {
    return new Promise((resolve) => {
        if (typeof canvas.toBlob !== 'function') { resolve(canvas.toDataURL('image/png')); return; }
        canvas.toBlob((blob) => {
            if (!blob) { resolve(canvas.toDataURL('image/png')); return; }
            const url = URL.createObjectURL(blob);
            if (_objectUrl) { try { URL.revokeObjectURL(_objectUrl); } catch (e) {} }
            _objectUrl = url;
            resolve(url);
        }, 'image/png');
    });
}

async function _repaint() {
    if (!_frame || !_active) return;
    const { values, grid } = _frame;
    const win = _gridWindow(grid);
    if (!win) { _removeFromMap(); return; }   // map is off the grid entirely
    const canvas = paintToCanvas(values, grid, win);
    const dataUrl = await _canvasUrl(canvas);
    if (!_active) return;                    // switched off while encoding
    _addImageToMap(dataUrl, [
        [win.west, win.north], [win.east, win.north],
        [win.east, win.south], [win.west, win.south],
    ]);
}

/*
 * Repaint after the map settles. Debounced, and only on 'moveend' — repainting
 * mid-gesture would re-encode a canvas on every frame of a drag.
 */
function _hookMapMove() {
    if (_moveHooked) return;
    const map = _getMap();
    if (!map || typeof map.on !== 'function') return;
    _moveHooked = true;
    map.on('moveend', () => {
        if (!_active) return;
        clearTimeout(_moveTimer);
        _moveTimer = setTimeout(() => {
            Promise.resolve(_repaint()).catch((e) => console.warn('[MRMS] repaint failed:', e));
        }, 140);
    });
}

function _getMap() { return _mapWrapper?.map; }

function _removeFromMap() {
    const map = _getMap();
    if (!map) return;
    if (map.getLayer(LAYER_ID))  map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

/*
 * Put the painted frame on the map.
 *
 * Every repaint used to remove the layer and add it back, which is a destroy
 * and recreate of the source, the layer and its GL texture — and on a zoom,
 * where a repaint follows every gesture, that is what made the mosaic flash
 * and stutter. An image source can be updated in place, so the existing one is
 * reused whenever it is still there and only its picture and corners change.
 */
function _addImageToMap(dataUrl, coordinates) {
    const map = _getMap();
    if (!map) return;

    const existing = map.getSource(SOURCE_ID);
    if (existing && typeof existing.updateImage === 'function' && map.getLayer(LAYER_ID)) {
        try {
            existing.updateImage({ url: dataUrl, coordinates });
            return;
        } catch (e) {
            // Fall through to a clean rebuild if the update is refused.
        }
    }

    _removeFromMap();
    map.addSource(SOURCE_ID, { type: 'image', url: dataUrl, coordinates });
    const before = map.getLayer('radar-webgl') ? 'radar-webgl' : undefined;
    map.addLayer({
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        paint: {
            'raster-opacity': 0.7,
            'raster-fade-duration': 0,
            /*
             * Match the app's smoothing setting on the UPSCALE too. The canvas
             * is coarser than the screen when zoomed in, so this is what decides
             * whether cells read as soft blobs or as crisp squares — the same
             * choice the setting makes for the single-site radar.
             */
            'raster-resampling': (typeof window !== 'undefined' && window.vortexSmoothing === false)
                ? 'nearest' : 'linear',
        },
    }, before);
}

async function _getLatestKey() {
    const now = new Date();
    for (let i = 0; i < 2; i++) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        const ds = `${d.getUTCFullYear()}${_pad(d.getUTCMonth()+1)}${_pad(d.getUTCDate())}`;
        const prefix = `${_product().path}/${ds}/`;
        try {
            const keys = await _fetchS3Keys(prefix);
            if (keys.length) { keys.sort(); return keys[keys.length - 1]; }
        } catch (e) { console.warn(`[MRMS] S3 list failed for ${prefix}`, e); }
    }
    return null;
}

export async function listMRMSFrames(count = 12) {
    // Keyed by product: the cached frame list belongs to the field it was built
    // for, and serving it after a switch would animate the wrong data.
    if (_listCache && _listCache.productId === _productId
        && (Date.now() - _listCache.ts) < LIST_CACHE_TTL_MS) {
        return _listCache.frames.slice(-count);
    }
    const frames = [];
    const now = new Date();
    for (let i = 0; i < 2 && frames.length < count * 3; i++) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        const ds = `${d.getUTCFullYear()}${_pad(d.getUTCMonth()+1)}${_pad(d.getUTCDate())}`;
        const prefix = `${_product().path}/${ds}/`;
        try {
            const keys = await _fetchS3Keys(prefix);
            for (const key of keys) {
                const ts = _parseTimestamp(key);
                if (ts) frames.push({ dateTime: ts, key });
            }
        } catch (e) { console.warn(`[MRMS] S3 list failed for ${prefix}:`, e); }
    }
    frames.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
    _listCache = { frames, ts: Date.now(), productId: _productId };
    return frames.slice(-count);
}

export async function addMRMS(mapWrapper) {
    _mapWrapper = mapWrapper;
    _active = true;
    _currentFrameKey = null;
    const key = await _getLatestKey();
    if (key && _active) await _fetchAndRender(key);

    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(async () => {
        if (!_active || _currentFrameKey) return;
        const k = await _getLatestKey();
        if (k && _active) _fetchAndRender(k);
    }, REFRESH_INTERVAL_MS);

    console.log('[MRMS] Layer added (S3 noaa-mrms-pds, MergedBaseReflectivityQC)');
}

export function removeMRMS() {
    _active = false;
    _frame = null;
    if (_objectUrl) { try { URL.revokeObjectURL(_objectUrl); } catch (e) {} _objectUrl = null; }
    clearTimeout(_moveTimer);
    _removeLegend();
    _currentFrameKey = null;
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    _removeFromMap();
    console.log('[MRMS] Layer removed');
}

export async function setMRMSFrame(s3Key) {
    if (!_active || !_mapWrapper) return;
    _currentFrameKey = s3Key;
    await _fetchAndRender(s3Key);
}

export async function clearMRMSFrame() {
    if (!_active || !_mapWrapper) return;
    _currentFrameKey = null;
    const k = await _getLatestKey();
    if (k && _active) await _fetchAndRender(k);
}

export function isMRMSActive() {
    return _active;
}

/**
 * Switch the field being shown.
 *
 * Clears the cached frame list and the current frame, because both belong to
 * the product they were fetched for — reusing them across a switch would paint
 * the old field's data under the new field's colours.
 */
export async function setMRMSProduct(id) {
    const next = getProduct(id);
    if (!next || next.id === _productId) return;
    _productId = next.id;
    _frame = null;                 // the cached grid belongs to the old product
    _listCache = null;
    _currentFrameKey = null;
    _lastRenderedKey = null;
    if (!_active || !_mapWrapper) return;
    _rendering = false;
    const key = await _getLatestKey();
    if (key && _active) await _fetchAndRender(key);
}

export function getMRMSProductId() { return _productId; }
