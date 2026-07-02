/*
 * grib2_decode.js
 * Minimal GRIB2 single-message decoder for NCEP model fields. Handles the two
 * data-representation templates NCEP actually uses for the fields we plot:
 *   - 5.0  simple packing
 *   - 5.3  complex packing + spatial differencing  (GFS/HRRR/NAM/GEFS)
 * and grid definitions:
 *   - 3.0  regular lat/lon        (GFS, GEFS)
 *   - 3.30 Lambert conformal      (HRRR, NAM)
 * Returns { values: Float32Array (row-major, NaN = missing), nx, ny, grid }.
 * Not a general GRIB2 library — just enough to render forecast rasters.
 */

function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function s32(b, o) { const v = u32(b, o); return v & 0x80000000 ? -(v & 0x7fffffff) : v; } // sign-magnitude
function s16(b, o) { const v = u16(b, o); return v & 0x8000 ? -(v & 0x7fff) : v; }          // sign-magnitude
function f32(b, o) { return new DataView(new Uint8Array([b[o], b[o + 1], b[o + 2], b[o + 3]]).buffer).getFloat32(0, false); }

// MSB-first bit reader over a byte array.
class BitReader {
  constructor(bytes, start) { this.b = bytes; this.byte = start; this.bit = 0; }
  read(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = v * 2 + ((this.b[this.byte] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.byte++; }
    }
    return v;
  }
  readSignMag(n) {
    if (n === 0) return 0;
    const v = this.read(n);
    const signBit = Math.pow(2, n - 1);
    return v & signBit ? -(v - signBit) : v;
  }
  align() { if (this.bit) { this.bit = 0; this.byte++; } }
}

function parseSections(buf) {
  const sec = {};
  let off = 16; // skip section 0 (16 bytes)
  let len = u32(buf, off); off += len; // skip section 1
  while (off < buf.length - 4) {
    const tag = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
    if (tag === '7777') break;
    len = u32(buf, off);
    if (len < 5 || len > buf.length - off) break;
    const num = buf[off + 4];
    sec[num] = { off, len };
    off += len;
  }
  return sec;
}

function parseGDS(buf, s) {
  const off = s.off;
  const tmpl = u16(buf, off + 12);
  if (tmpl === 0) {
    const basic = u32(buf, off + 38);
    const subdiv = u32(buf, off + 42);
    const div = (basic === 0 || subdiv === 0 || subdiv === 0xffffffff) ? 1e6 : subdiv / basic;
    return {
      template: 0,
      nx: u32(buf, off + 30), ny: u32(buf, off + 34),
      la1: s32(buf, off + 46) / div, lo1: s32(buf, off + 50) / div,
      la2: s32(buf, off + 55) / div, lo2: s32(buf, off + 59) / div,
      di: u32(buf, off + 63) / div, dj: u32(buf, off + 67) / div,
      scanMode: buf[off + 71],
    };
  }
  if (tmpl === 30) {
    // Lambert conformal conic.
    return {
      template: 30,
      nx: u32(buf, off + 30), ny: u32(buf, off + 34),
      la1: s32(buf, off + 38) / 1e6, lo1: s32(buf, off + 42) / 1e6,
      lad: s32(buf, off + 47) / 1e6, lov: s32(buf, off + 51) / 1e6,
      dx: u32(buf, off + 55) / 1e3, dy: u32(buf, off + 59) / 1e3, // metres
      projFlag: buf[off + 63],
      scanMode: buf[off + 64], // octet 65 (off+63 is the projection-centre flag)
      latin1: s32(buf, off + 65) / 1e6, latin2: s32(buf, off + 69) / 1e6,
    };
  }
  return { template: tmpl, nx: u32(buf, off + 30), ny: u32(buf, off + 34) };
}

// Section 6 bitmap -> Uint8Array of 0/1 per grid point, or null if none.
function parseBitmap(buf, s, npts) {
  if (!s) return null;
  const ind = buf[s.off + 5];
  if (ind === 255) return null; // no bitmap
  const bits = new Uint8Array(npts);
  const br = new BitReader(buf, s.off + 6);
  for (let i = 0; i < npts; i++) bits[i] = br.read(1);
  return bits;
}

// Decode DRS 5.3 (complex packing + spatial differencing) / 5.0 (simple).
function decodeData(buf, drs, data, npts) {
  const off = drs.off;
  const tmpl = u16(buf, off + 9);
  const R = f32(buf, off + 11);
  const E = s16(buf, off + 15);
  const D = s16(buf, off + 17);
  const nbits = buf[off + 19];
  const bscale = Math.pow(2, E);
  const dscale = Math.pow(10, -D);

  if (tmpl === 0) {
    const br = new BitReader(buf, data.off + 5);
    const out = new Float32Array(npts);
    for (let i = 0; i < npts; i++) out[i] = (R + br.read(nbits) * bscale) * dscale;
    return out;
  }
  if (tmpl !== 3 && tmpl !== 2) throw new Error(`Unsupported DRS template ${tmpl}`);

  // Complex-packing parameters.
  const NG = u32(buf, off + 31);
  const gwRef = buf[off + 35];
  const gwBits = buf[off + 36];
  const glRef = u32(buf, off + 37);
  const glInc = buf[off + 41];
  const glLast = u32(buf, off + 42);
  const glBits = buf[off + 46];
  const order = tmpl === 3 ? buf[off + 47] : 0;
  const ndsd = tmpl === 3 ? buf[off + 48] : 0;

  const br = new BitReader(buf, data.off + 5);

  // Spatial-differencing extra descriptors come first. Per g2clib: the initial
  // value(s) ival1/ival2 are UNSIGNED; only the overall minimum minsd is stored
  // sign-magnitude (1 sign bit + (nb-1) magnitude bits).
  let ival1 = 0, ival2 = 0, minsd = 0;
  if (tmpl === 3) {
    const nb = ndsd * 8;
    ival1 = br.read(nb);
    if (order === 2) ival2 = br.read(nb);
    const sign = br.read(1);
    const mag = br.read(nb - 1);
    minsd = sign ? -mag : mag;
  }

  // NCEP byte-aligns each of the following blocks to an octet boundary.
  br.align();
  const gref = new Array(NG);
  for (let i = 0; i < NG; i++) gref[i] = br.read(nbits);
  br.align();
  const gwid = new Array(NG);
  for (let i = 0; i < NG; i++) gwid[i] = gwRef + br.read(gwBits);
  br.align();
  const glen = new Array(NG);
  for (let i = 0; i < NG; i++) glen[i] = glRef + br.read(glBits) * glInc;
  glen[NG - 1] = glLast;
  br.align();

  // Decode each group's values.
  const vals = new Float32Array(npts);
  let n = 0;
  for (let g = 0; g < NG; g++) {
    const w = gwid[g];
    const ref = gref[g];
    const L = glen[g];
    if (w === 0) {
      for (let k = 0; k < L && n < npts; k++) vals[n++] = ref;
    } else {
      for (let k = 0; k < L && n < npts; k++) vals[n++] = ref + br.read(w);
    }
  }

  // Undo spatial differencing.
  if (tmpl === 3) {
    if (order === 1) {
      vals[0] = ival1;
      for (let i = 1; i < npts; i++) { vals[i] += minsd; vals[i] += vals[i - 1]; }
    } else if (order === 2) {
      vals[0] = ival1; vals[1] = ival2;
      for (let i = 2; i < npts; i++) { vals[i] += minsd; vals[i] += 2 * vals[i - 1] - vals[i - 2]; }
    }
  }

  // Scale to physical values.
  for (let i = 0; i < npts; i++) vals[i] = (R + vals[i] * bscale) * dscale;
  return vals;
}

function decodeGrib2Message(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'GRIB') throw new Error('Not GRIB2');
  const sec = parseSections(buf);
  if (!sec[3] || !sec[5] || !sec[7]) throw new Error('Missing GRIB2 sections');
  const grid = parseGDS(buf, sec[3]);
  const npts = grid.nx * grid.ny;
  const packed = decodeData(buf, sec[5], sec[7], npts);
  const bitmap = parseBitmap(buf, sec[6], npts);

  let values;
  if (bitmap) {
    values = new Float32Array(npts);
    let j = 0;
    for (let i = 0; i < npts; i++) values[i] = bitmap[i] ? packed[j++] : NaN;
  } else {
    values = packed;
  }
  return { values, nx: grid.nx, ny: grid.ny, grid };
}

module.exports = { decodeGrib2Message };
