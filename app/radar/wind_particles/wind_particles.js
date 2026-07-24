/*
 * wind_particles.js
 * Animated "wind particles" that flow along the radar velocity field, so you can
 * read a storm's motion at a glance instead of interpreting raw velocity colors.
 *
 * The flow is built from the VELOCITY moment, independent of the product drawn,
 * so it works on every product. Three sources, in order:
 *   1. Level 2 volume  -> read 'VEL' at the selected tilt from the same factory
 *      (works even while showing reflectivity — L2 carries every moment).
 *   2. A displayed Level 3 velocity product -> use it directly.
 *   3. Any other Level 3 product (e.g. reflectivity) -> fetch the L3 super-res
 *      base velocity ('p99v0') for the station in the background and use that.
 *
 * A single Doppler radar measures RADIAL velocity, so particles stream along the
 * beam (outbound away from the radar, inbound toward it). Rendered as a
 * transparent full-map canvas overlay. Controlled by the "Wind Particles" toggle.
 */

const map = require('../../core/map/map');
const loaders = require('../libnexrad/loaders_nexrad');

// Level 3 product codes that ARE velocity.
const VELOCITY_L3_CODES = [99, 154, 182];

// Tunables (visual — safe to adjust).
const STEP = 12;
const PARTICLE_COUNT = 2600;
const SPEED_SCALE = 0.10;
const MAX_AGE = 90;
const FADE_OUT = 0.06;
const MAX_ABS_MS = 120;
const FIELD_REFRESH_MS = 1000;
const VEL_FETCH_TTL_MS = 120000; // re-fetch background L3 velocity at most this often
const AZ_BUCKETS = 360;

let _canvas = null, _ctx = null, _parent = null;
let _raf = null, _fieldTimer = null;
let _field = null;
let _particles = [];
let _enabled = false;
let _moving = false;

// Background-fetched L3 velocity factory (for non-velocity L3 products).
let _velFactory = null, _velStation = null, _velFetchAt = 0, _velFetching = false;

function ensureCanvas() {
    _parent = map.getCanvasContainer();
    if (_canvas) return;
    _canvas = document.createElement('canvas');
    _canvas.className = 'wind-particles-canvas';
    _canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    _parent.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');
    sizeCanvas();
}
function sizeCanvas() {
    if (!_canvas || !_parent) return;
    const w = _parent.clientWidth, h = _parent.clientHeight;
    if (_canvas.width !== w || _canvas.height !== h) { _canvas.width = w; _canvas.height = h; }
}
function seedParticles() {
    _particles = new Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        _particles[i] = { x: Math.random() * _canvas.width, y: Math.random() * _canvas.height, age: Math.random() * MAX_AGE };
    }
}
function respawn(p) { p.x = Math.random() * _canvas.width; p.y = Math.random() * _canvas.height; p.age = 0; }

// ── velocity source resolution ────────────────────────────────────────────────
// Returns { az, rg, data, loc } (azimuths deg, ranges km, data[radial][gate] m/s,
// radar [lat,lng,alt]) or null.
function currentVelInfo() {
    const A = window.atticData || {};
    const cur = A.nexrad_factory;
    if (!cur) return null;
    try {
        if (cur.nexrad_level === 2) {
            const elev = A.nexrad_factory_elevation_number;
            const data = cur.get_data('VEL', elev);
            if (data && data.length) {
                return { az: cur.get_azimuth_angles(elev), rg: cur.get_ranges('VEL', elev), data, loc: cur.get_location() };
            }
        } else if (cur.nexrad_level === 3 && VELOCITY_L3_CODES.includes(cur.product_code)) {
            const data = cur.get_data();
            if (data && data.length) {
                return { az: cur.get_azimuth_angles(), rg: cur.get_ranges(), data, loc: cur.get_location(cur.station) };
            }
        }
    } catch (e) { /* fall through to background velocity */ }

    if (_velFactory) {
        try {
            const data = _velFactory.get_data();
            if (data && data.length) {
                return { az: _velFactory.get_azimuth_angles(), rg: _velFactory.get_ranges(), data, loc: _velFactory.get_location(_velStation) };
            }
        } catch (e) { /* ignore */ }
    }
    return null;
}

// If we're on a non-velocity Level 3 product, pull the L3 base velocity in the
// background so particles still work over reflectivity etc.
function maybeFetchVelocity() {
    const A = window.atticData || {};
    const cur = A.nexrad_factory;
    if (!cur || cur.nexrad_level !== 3) return;
    if (VELOCITY_L3_CODES.includes(cur.product_code)) return; // already velocity
    const station = cur.station;
    if (!station || _velFetching) return;
    if (_velFactory && _velStation === station && Date.now() - _velFetchAt < VEL_FETCH_TTL_MS) return;
    _velFetching = true;
    try {
        loaders.return_level_3_factory_from_info(station, 'p99v0', (factory) => {
            _velFetching = false;
            if (factory) { _velFactory = factory; _velStation = station; _velFetchAt = Date.now(); rebuildField(); }
        });
    } catch (e) { _velFetching = false; }
}

// ── field build (screen-space radial vectors from the velocity moment) ────────
function rebuildField() {
    if (!_enabled || _moving || !_canvas) return;
    maybeFetchVelocity();
    const info = currentVelInfo();
    if (!info) { _field = null; return; }
    const { az: azimuths, rg: ranges, data, loc } = info;
    if (!azimuths || !ranges || !data || ranges.length < 2) { _field = null; return; }

    const azIdx = new Int16Array(AZ_BUCKETS).fill(-1);
    for (let i = 0; i < azimuths.length; i++) {
        const a = azimuths[i];
        if (a == null || !isFinite(a)) continue;
        azIdx[Math.round(((a % 360) + 360) % 360 / 360 * AZ_BUCKETS) % AZ_BUCKETS] = i;
    }
    for (let pass = 0; pass < 2; pass++) {
        for (let b = 0; b < AZ_BUCKETS; b++) {
            if (azIdx[b] === -1) {
                const prev = azIdx[(b - 1 + AZ_BUCKETS) % AZ_BUCKETS];
                const next = azIdx[(b + 1) % AZ_BUCKETS];
                azIdx[b] = prev !== -1 ? prev : next;
            }
        }
    }

    const firstRange = ranges[0];
    const gateSize = ranges[1] - ranges[0];
    const nGates = ranges.length;
    const maxRange = ranges[nGates - 1];
    if (!isFinite(gateSize) || gateSize <= 0) { _field = null; return; }

    const rLat = loc[0], rLng = loc[1];
    if (!rLat && !rLng) { _field = null; return; }
    const rs = map.project({ lng: rLng, lat: rLat });
    const cosLat = Math.cos(rLat * Math.PI / 180);

    const cssW = _canvas.width, cssH = _canvas.height;
    const gw = Math.ceil(cssW / STEP), gh = Math.ceil(cssH / STEP);
    const spd = new Float32Array(gw * gh), dirx = new Float32Array(gw * gh), diry = new Float32Array(gw * gh), has = new Uint8Array(gw * gh);

    for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
            const gi = gy * gw + gx;
            const sx = gx * STEP, sy = gy * STEP;
            const ll = map.unproject([sx, sy]);
            const ky = (ll.lat - rLat) * 111.32;
            const kx = (ll.lng - rLng) * 111.32 * cosLat;
            const range_km = Math.hypot(kx, ky);
            if (range_km < 2 || range_km > maxRange) { has[gi] = 0; continue; }
            let az = Math.atan2(kx, ky) * 180 / Math.PI;
            az = ((az % 360) + 360) % 360;
            const ri = azIdx[Math.round(az / 360 * AZ_BUCKETS) % AZ_BUCKETS];
            const gate = Math.round((range_km - firstRange) / gateSize);
            if (ri < 0 || gate < 0 || gate >= nGates || !data[ri]) { has[gi] = 0; continue; }
            const v = data[ri][gate];
            if (v == null || !isFinite(v) || Math.abs(v) > MAX_ABS_MS) { has[gi] = 0; continue; }
            let ex = sx - rs.x, ey = sy - rs.y;
            const L = Math.hypot(ex, ey) || 1;
            dirx[gi] = ex / L; diry[gi] = ey / L; spd[gi] = v; has[gi] = 1;
        }
    }
    _field = { gw, gh, spd, dirx, diry, has };
}

function frame() {
    if (!_enabled) return;
    const w = _canvas.width, h = _canvas.height;

    _ctx.globalCompositeOperation = 'destination-out';
    _ctx.fillStyle = `rgba(0,0,0,${FADE_OUT})`;
    _ctx.fillRect(0, 0, w, h);
    _ctx.globalCompositeOperation = 'source-over';

    if (_field && !_moving) {
        const f = _field;
        _ctx.beginPath();
        _ctx.strokeStyle = 'rgba(255,255,255,0.82)';
        _ctx.lineWidth = 1.1;
        for (let i = 0; i < _particles.length; i++) {
            const p = _particles[i];
            p.age++;
            const gx = Math.round(p.x / STEP), gy = Math.round(p.y / STEP);
            if (p.age > MAX_AGE || gx < 0 || gy < 0 || gx >= f.gw || gy >= f.gh) { respawn(p); continue; }
            const gi = gy * f.gw + gx;
            if (!f.has[gi]) { respawn(p); continue; }
            const v = f.spd[gi];
            const nx = p.x + f.dirx[gi] * v * SPEED_SCALE;
            const ny = p.y + f.diry[gi] * v * SPEED_SCALE;
            _ctx.moveTo(p.x, p.y); _ctx.lineTo(nx, ny);
            p.x = nx; p.y = ny;
            if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) respawn(p);
        }
        _ctx.stroke();
    }
    _raf = requestAnimationFrame(frame);
}

function onMoveStart() { _moving = true; if (_ctx) _ctx.clearRect(0, 0, _canvas.width, _canvas.height); }
function onMoveEnd() { _moving = false; sizeCanvas(); rebuildField(); }
function onResize() { sizeCanvas(); rebuildField(); }

function enable() {
    if (_enabled) return;
    _enabled = true;
    ensureCanvas();
    sizeCanvas();
    seedParticles();
    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    map.on('resize', onResize);
    rebuildField();
    if (_fieldTimer) clearInterval(_fieldTimer);
    _fieldTimer = setInterval(rebuildField, FIELD_REFRESH_MS);
    if (_raf) cancelAnimationFrame(_raf);
    _raf = requestAnimationFrame(frame);

    if (!(window.atticData || {}).nexrad_factory) {
        toast('Wind particles need a radar loaded — pick a station/product first.');
    }
}

function disable() {
    _enabled = false;
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    if (_fieldTimer) { clearInterval(_fieldTimer); _fieldTimer = null; }
    map.off('movestart', onMoveStart);
    map.off('moveend', onMoveEnd);
    map.off('resize', onResize);
    _field = null;
    if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
    _canvas = _ctx = null;
}

let _toastEl = null;
function toast(msg) {
    if (_toastEl) _toastEl.remove();
    _toastEl = document.createElement('div');
    _toastEl.textContent = msg;
    _toastEl.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:100070;' +
        'background:rgba(11,18,32,.97);color:#e5edff;border:1px solid #27324a;border-radius:12px;' +
        "padding:10px 15px;font-family:'Onest',system-ui,sans-serif;font-size:13px;max-width:88vw;text-align:center;" +
        'box-shadow:0 12px 34px rgba(0,0,0,.55);';
    document.body.appendChild(_toastEl);
    setTimeout(() => { if (_toastEl) { _toastEl.remove(); _toastEl = null; } }, 6000);
}

module.exports = { enable, disable };
