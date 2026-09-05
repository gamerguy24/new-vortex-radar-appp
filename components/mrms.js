/*
 * MRMS (Multi-Radar Multi-Sensor) Layer
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
import { getProduct, buildRampLUT } from './mrms_products.js?v=mrms4';

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

function buildPaletteLUT() {
    const pal = new Palettes();
    const palArray = pal.palettes['MRMS_REF'] ? pal.getPalette('MRMS_REF') : pal.getPalette('REF');
    const stops = [];
    for (let i = 0; i < palArray.length; i += 2) {
        const val = Number(palArray[i]);
        const m = String(palArray[i + 1]).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) continue;
        const a = m[4] !== undefined ? Number(m[4]) : 1;
        stops.push({ val, r: +m[1], g: +m[2], b: +m[3], a: Math.round(a <= 1 ? a * 255 : a) });
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
function paintToCanvas(values, grid) {
    const { nx, ny, scanMode } = grid;
    const product = _product();
    const isRef = !!product.reflectivity;

    const lut = isRef ? buildPaletteLUT() : null;
    const ramp = isRef ? null : buildRampLUT(product);
    const floor = product.floor != null ? product.floor : DEFAULT_FLOOR;

    const STEP = product.step || 2;
    const cw = Math.ceil(nx / STEP);
    const ch = Math.ceil(ny / STEP);

    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(cw, ch);
    const pix = imgData.data;
    const flipJ = (scanMode & 0x40) !== 0;

    for (let cy = 0; cy < ch; cy++) {
        const gy = cy * STEP;
        for (let cx = 0; cx < cw; cx++) {
            const gx = cx * STEP;
            const srcRow = flipJ ? (ny - 1 - gy) : gy;
            const v = values[srcRow * nx + gx];
            const po = (cy * cw + cx) * 4;
            // -999 is missing and -3 is "no radar coverage"; the per-product
            // floor covers both plus fields that legitimately reach zero.
            if (!Number.isFinite(v) || v <= MRMS_MISSING + 1 || v < floor) {
                pix[po + 3] = 0;
                continue;
            }
            let li;
            if (isRef) {
                li = dbzToLutIdx(v) * 4;
                pix[po]   = lut[li];
                pix[po+1] = lut[li+1];
                pix[po+2] = lut[li+2];
                pix[po+3] = lut[li+3];
            } else {
                const t = (v - ramp.min) / ((ramp.max - ramp.min) || 1);
                li = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
                pix[po]   = ramp.lut[li];
                pix[po+1] = ramp.lut[li+1];
                pix[po+2] = ramp.lut[li+2];
                pix[po+3] = ramp.lut[li+3];
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
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

        const dataUrl = paintToCanvas(values, grid);

        let lonW = grid.lon1 > 180 ? grid.lon1 - 360 : grid.lon1;
        let lonE = grid.lon2 > 180 ? grid.lon2 - 360 : grid.lon2;
        const latN = Math.max(grid.lat1, grid.lat2);
        const latS = Math.min(grid.lat1, grid.lat2);

        _addImageToMap(dataUrl, [[lonW, latN], [lonE, latN], [lonE, latS], [lonW, latS]]);
        _lastRenderedKey = s3Key;
        _drawLegend(s3Key);
        console.log(`[MRMS] Rendered frame: ${_parseTimestamp(s3Key) || 'latest'}`);
    } catch (err) {
        console.error('[MRMS] Fetch/render failed:', err);
    } finally {
        _rendering = false;
    }
}

function _getMap() { return _mapWrapper?.map; }

function _removeFromMap() {
    const map = _getMap();
    if (!map) return;
    if (map.getLayer(LAYER_ID))  map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

function _addImageToMap(dataUrl, coordinates) {
    const map = _getMap();
    if (!map) return;
    _removeFromMap();
    map.addSource(SOURCE_ID, { type: 'image', url: dataUrl, coordinates });
    const before = map.getLayer('radar-webgl') ? 'radar-webgl' : undefined;
    map.addLayer({
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 0 },
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
    _listCache = null;
    _currentFrameKey = null;
    _lastRenderedKey = null;
    if (!_active || !_mapWrapper) return;
    _rendering = false;
    const key = await _getLatestKey();
    if (key && _active) await _fetchAndRender(key);
}

export function getMRMSProductId() { return _productId; }
