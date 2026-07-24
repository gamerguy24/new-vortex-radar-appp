/*
 * wind_particles.js
 * Animated "wind particles" that flow along the radar velocity field, so you can
 * read a storm's motion at a glance instead of interpreting raw velocity colors.
 *
 * A single Doppler radar measures RADIAL velocity (motion toward or away from the
 * radar), so particles stream along the beam: outbound gates carry them away from
 * the radar, inbound gates pull them toward it. The speed at each point comes from
 * the same value framebuffer the inspector reads (window.atticData.fb), decoded
 * with cmin/cmax, so the particles follow whatever elevation/tilt is displayed and
 * re-sample as playback advances.
 *
 * Rendered as a transparent full-map canvas overlay (screen space), gated to
 * velocity products. Controlled by the "Wind Particles" layer toggle.
 */

const map = require('../../core/map/map');

// Product codes that carry velocity (m/s). 154 = super-res vel, 99 = digital base
// vel, 182 = TDWR vel, 'VEL' = Level 2 velocity.
const VELOCITY_CODES = [154, 99, 182, 'VEL'];
const isVelocityProduct = (code) => VELOCITY_CODES.includes(code);

// Tunables (visual — safe to adjust).
const STEP = 10;          // field grid resolution, CSS px
const PARTICLE_COUNT = 3000;
const SPEED_SCALE = 0.09; // m/s -> screen px per frame
const MAX_AGE = 90;       // frames before a particle respawns
const FADE_OUT = 0.055;   // trail fade per frame (0..1)
const MAX_ABS_MS = 80;    // ignore |value| above this (range-folded / junk)
const FIELD_REFRESH_MS = 700; // re-sample the velocity field (rides playback)

let _canvas = null, _ctx = null, _parent = null;
let _raf = null, _fieldTimer = null;
let _field = null;
let _particles = [];
let _enabled = false;
let _moving = false;

function getGL() {
    const c = map.getCanvas();
    return c.getContext('webgl') || c.getContext('webgl2');
}

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
    if (_canvas.width !== w || _canvas.height !== h) {
        _canvas.width = w; _canvas.height = h;
    }
}

function seedParticles() {
    _particles = new Array(PARTICLE_COUNT);
    const w = _canvas.width, h = _canvas.height;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        _particles[i] = { x: Math.random() * w, y: Math.random() * h, age: Math.random() * MAX_AGE };
    }
}
function respawn(p) {
    p.x = Math.random() * _canvas.width;
    p.y = Math.random() * _canvas.height;
    p.age = 0;
}

// Read the velocity value framebuffer and build a screen-space grid of radial
// motion vectors (direction from the radar, signed magnitude in m/s).
function rebuildField() {
    if (!_enabled || _moving) return;
    const A = window.atticData || {};
    if (!isVelocityProduct(A.product_code) || A.fb == null || A.cmin == null || !A.current_nexrad_location) {
        _field = null; return;
    }
    const gl = getGL();
    if (!gl) { _field = null; return; }

    const dbw = gl.drawingBufferWidth, dbh = gl.drawingBufferHeight;
    let buf;
    try {
        buf = new Uint8Array(dbw * dbh * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
        gl.readPixels(0, 0, dbw, dbh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } catch (e) { _field = null; return; }

    const cmin = A.cmin, cmax = A.cmax;
    const cssW = _canvas.width, cssH = _canvas.height;
    const gw = Math.ceil(cssW / STEP), gh = Math.ceil(cssH / STEP);
    const spd = new Float32Array(gw * gh);
    const dirx = new Float32Array(gw * gh);
    const diry = new Float32Array(gw * gh);
    const has = new Uint8Array(gw * gh);

    const loc = A.current_nexrad_location; // [lat, lng, elev]
    const rs = map.project({ lng: loc[1], lat: loc[0] }); // radar position in CSS px

    for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
            const sx = gx * STEP, sy = gy * STEP;
            const bx = Math.min(dbw - 1, Math.max(0, Math.round(dbw / cssW * sx)));
            const by = Math.min(dbh - 1, Math.max(0, Math.round(dbh / cssH * (cssH - sy)))); // flip Y
            const idx = (by * dbw + bx) * 4;
            const gi = gy * gw + gx;
            if (buf[idx + 3] !== 255) { has[gi] = 0; continue; } // no data
            const scaled = buf[idx] / 255 + buf[idx + 1] / 65025 + buf[idx + 2] / 16581375;
            const value = scaled * (cmax - cmin) + cmin; // m/s, signed (+ = outbound)
            if (!isFinite(value) || Math.abs(value) > MAX_ABS_MS) { has[gi] = 0; continue; }
            let ddx = sx - rs.x, ddy = sy - rs.y;
            const len = Math.hypot(ddx, ddy) || 1;
            dirx[gi] = ddx / len; diry[gi] = ddy / len;
            spd[gi] = value; has[gi] = 1;
        }
    }
    _field = { gw, gh, spd, dirx, diry, has };
}

function frame() {
    if (!_enabled) return;
    const w = _canvas.width, h = _canvas.height;

    // Fade existing trails without tinting the map (erase alpha only).
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

// ── map interaction: pause + clear while the view moves, rebuild after ────────
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

    // Nudge the user if they aren't on a velocity product yet.
    if (!isVelocityProduct((window.atticData || {}).product_code)) {
        toast('Wind particles follow a velocity product — switch to Base Velocity to see them flow.');
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
