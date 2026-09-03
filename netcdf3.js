/*
 * netcdf3.js
 * Minimal reader for NetCDF "classic" (CDF-1) and 64-bit-offset (CDF-2) files.
 *
 * Exists for one job: reading the NCEP/NCAR reanalysis long-term-mean grids
 * that the forecast anomaly products are measured against. Those are published
 * only as NetCDF, and pulling in a full NetCDF stack for two files would be a
 * lot of dependency for a well-specified, simple container format.
 *
 * The format is a header of dimension / attribute / variable descriptors
 * followed by the data, everything big-endian and padded to 4-byte boundaries.
 * Record variables (those using the unlimited dimension) are interleaved one
 * record at a time; non-record variables are contiguous.
 *
 * Deliberately not implemented: writing, compression (classic NetCDF has
 * none), and string/char variable convenience. Unsupported input throws rather
 * than guessing.
 */

const NC_BYTE = 1, NC_CHAR = 2, NC_SHORT = 3, NC_INT = 4, NC_FLOAT = 5, NC_DOUBLE = 6;
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };

const NC_DIMENSION = 10, NC_VARIABLE = 11, NC_ATTRIBUTE = 12;

class Reader {
    constructor(buf) { this.b = buf; this.p = 0; this.v64 = false; }
    u8() { return this.b[this.p++]; }
    i32() { const v = this.b.readInt32BE(this.p); this.p += 4; return v; }
    u32() { const v = this.b.readUInt32BE(this.p); this.p += 4; return v; }
    i64() {
        // Offsets in CDF-2. Values this large never occur in the files we read,
        // so Number is safe and keeps the arithmetic simple.
        const v = Number(this.b.readBigInt64BE(this.p)); this.p += 8; return v;
    }
    offset() { return this.v64 ? this.i64() : this.i32(); }
    pad() { while (this.p % 4 !== 0) this.p++; }
    name() {
        const n = this.u32();
        const s = this.b.toString('latin1', this.p, this.p + n);
        this.p += n; this.pad();
        return s;
    }
    values(type, n) {
        const out = [];
        for (let i = 0; i < n; i++) {
            switch (type) {
                case NC_BYTE: out.push(this.b.readInt8(this.p)); this.p += 1; break;
                case NC_CHAR: out.push(String.fromCharCode(this.b[this.p])); this.p += 1; break;
                case NC_SHORT: out.push(this.b.readInt16BE(this.p)); this.p += 2; break;
                case NC_INT: out.push(this.b.readInt32BE(this.p)); this.p += 4; break;
                case NC_FLOAT: out.push(this.b.readFloatBE(this.p)); this.p += 4; break;
                case NC_DOUBLE: out.push(this.b.readDoubleBE(this.p)); this.p += 8; break;
                default: throw new Error(`NetCDF: unknown type ${type}`);
            }
        }
        this.pad();
        return type === NC_CHAR ? out.join('') : out;
    }
    list(tag, readItem) {
        const t = this.u32();
        const n = this.u32();
        if (t === 0 && n === 0) return [];
        if (t !== tag) throw new Error(`NetCDF: expected list tag ${tag}, got ${t}`);
        const out = [];
        for (let i = 0; i < n; i++) out.push(readItem());
        return out;
    }
    atts() {
        const out = {};
        this.list(NC_ATTRIBUTE, () => {
            const nm = this.name();
            const type = this.u32();
            const n = this.u32();
            out[nm] = this.values(type, n);
        });
        return out;
    }
}

function parseHeader(buf) {
    if (buf.toString('latin1', 0, 3) !== 'CDF') throw new Error('Not a NetCDF classic file');
    const version = buf[3];
    if (version !== 1 && version !== 2) throw new Error(`NetCDF version ${version} unsupported`);

    const r = new Reader(buf);
    r.p = 4;
    r.v64 = version === 2;
    const numrecs = r.u32();                       // 0xFFFFFFFF = streaming; unused here

    const dims = r.list(NC_DIMENSION, () => ({ name: r.name(), size: r.u32() }));
    const globals = r.atts();
    const vars = r.list(NC_VARIABLE, () => {
        const name = r.name();
        const ndims = r.u32();
        const dimids = [];
        for (let i = 0; i < ndims; i++) dimids.push(r.u32());
        const attributes = r.atts();
        const type = r.u32();
        const vsize = r.u32();
        const begin = r.offset();
        return { name, dimids, attributes, type, vsize, begin };
    });

    // A variable is a record variable if its first dimension is the unlimited
    // one (size 0 in the header). Those are interleaved, so their stride is the
    // total size of one record across every record variable.
    const unlimitedId = dims.findIndex((d) => d.size === 0);
    let recordStride = 0;
    for (const v of vars) {
        if (v.dimids[0] === unlimitedId && unlimitedId >= 0) recordStride += pad4(v.vsize);
    }

    return { version, numrecs, dims, globals, vars, unlimitedId, recordStride };
}

function pad4(n) { return n + ((4 - (n % 4)) % 4); }

/*
 * Read one variable's values as a Float64Array, with scale_factor / add_offset
 * applied and missing values turned into NaN.
 *
 * The reanalysis grids are stored as packed 16-bit integers with those two
 * attributes; ignoring them yields numbers off by orders of magnitude, so they
 * are applied here rather than left to callers to remember.
 */
function readVariable(buf, header, name) {
    const v = header.vars.find((x) => x.name === name);
    if (!v) throw new Error(`NetCDF: no variable "${name}"`);

    const shape = v.dimids.map((id) => (header.dims[id].size === 0 ? header.numrecs : header.dims[id].size));
    const total = shape.reduce((a, b) => a * b, 1);
    const size = TYPE_SIZE[v.type];
    const out = new Float64Array(total);

    const isRecord = header.unlimitedId >= 0 && v.dimids[0] === header.unlimitedId;
    const perRecord = isRecord ? total / shape[0] : total;

    const read = (off) => {
        switch (v.type) {
            case NC_BYTE: return buf.readInt8(off);
            case NC_SHORT: return buf.readInt16BE(off);
            case NC_INT: return buf.readInt32BE(off);
            case NC_FLOAT: return buf.readFloatBE(off);
            case NC_DOUBLE: return buf.readDoubleBE(off);
            default: throw new Error(`NetCDF: cannot read type ${v.type}`);
        }
    };

    for (let i = 0; i < total; i++) {
        let off;
        if (isRecord) {
            const rec = Math.floor(i / perRecord);
            const within = i % perRecord;
            off = v.begin + rec * header.recordStride + within * size;
        } else {
            off = v.begin + i * size;
        }
        out[i] = read(off);
    }

    const a = v.attributes || {};
    const scale = a.scale_factor != null ? Number(a.scale_factor[0]) : 1;
    const add = a.add_offset != null ? Number(a.add_offset[0]) : 0;
    const missing = a.missing_value != null ? Number(a.missing_value[0])
        : (a._FillValue != null ? Number(a._FillValue[0]) : null);

    for (let i = 0; i < total; i++) {
        if (missing != null && out[i] === missing) { out[i] = NaN; continue; }
        out[i] = out[i] * scale + add;
    }
    return { values: out, shape, attributes: a };
}

module.exports = { parseHeader, readVariable };
