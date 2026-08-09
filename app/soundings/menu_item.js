/*
 * menu_item.js
 * Footer tool for click-a-point forecast soundings. Arm it, click anywhere on
 * the map, and it fetches a BUFKIT-style sounding (rucsoundings.js) for that
 * point and renders a Skew-T + hodograph + indices (skewt.js) in a modal, with
 * a model + forecast-hour picker.
 */

const map = require('../core/map/map');
const { renderSounding } = require('./skewt');

const icon = '#soundingMenuItemIcon';

// Models served by the raw-GRIB sounding endpoint (server: soundings_grib.js).
// GFS decodes cleanly (incl. winds) with the pure-JS decoder. NAM is deferred:
// its UGRD complex-packing reconstruction is wrong in grib2_decode.js (winds
// come out garbage); HRRR is deferred too (JPEG2000). Both need a decoder fix.
const MODELS = [
    { id: 'gfs', label: 'GFS (0.25°)' },
];

// forecast lead times offered, in hours (0 = analysis)
const FCST = [
    { v: '0', label: 'Analysis' },
    { v: '3', label: '+3 h' }, { v: '6', label: '+6 h' }, { v: '12', label: '+12 h' },
    { v: '24', label: '+24 h' }, { v: '48', label: '+48 h' },
];

let armed = false;

function select() { $(icon).addClass('menu_item_selected').removeClass('menu_item_not_selected'); }
function deselect() { $(icon).removeClass('menu_item_selected').addClass('menu_item_not_selected'); }

function onMapClick(e) {
    disarm();
    openSoundingModal(e.lngLat.lat, e.lngLat.lng);
}

function arm() {
    // Stand down the other gesture-grabbing tools first.
    ['#drawMenuItemIcon', '#mstMenuItemIcon', '#colorPickerItemClass'].forEach((sel) => {
        if ($(sel).hasClass('menu_item_selected')) $(sel).click();
    });
    armed = true;
    select();
    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', onMapClick);
}

function disarm() {
    armed = false;
    deselect();
    map.getCanvas().style.cursor = '';
    map.off('click', onMapClick);
}

$(icon).on('click', () => { armed ? disarm() : arm(); });
// If another tool arms, drop out so gestures don't collide.
['#drawMenuItemIcon', '#mstMenuItemIcon', '#settingsItemClass'].forEach((sel) => {
    $(sel).on('click', () => { if (armed) disarm(); });
});

// ── modal ─────────────────────────────────────────────────────────────────────
function injectStyles() {
    if (document.getElementById('snd-styles')) return;
    const s = document.createElement('style');
    s.id = 'snd-styles';
    s.textContent = `
    .snd-bg{position:fixed;inset:0;z-index:100065;background:rgba(3,7,14,.74);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
        display:flex;align-items:center;justify-content:center;padding:24px;font-family:'Onest',system-ui,sans-serif;}
    .snd-modal{width:min(1060px,96vw);max-height:94vh;overflow:auto;color:#e7eef7;
        background:linear-gradient(180deg,rgba(17,25,42,.99),rgba(9,14,26,.99));
        border:1px solid rgba(255,255,255,.10);border-radius:20px;
        box-shadow:0 34px 90px rgba(0,0,0,.64),inset 0 1px 0 rgba(255,255,255,.05);}
    .snd-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 18px;flex-wrap:wrap;
        border-bottom:1px solid rgba(255,255,255,.07);background:linear-gradient(180deg,rgba(39,190,255,.09),rgba(39,190,255,0));}
    .snd-title{display:flex;align-items:center;gap:12px;min-width:0;}
    .snd-badge{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
        background:linear-gradient(180deg,#33c2ff,#1f8fd0);color:#04121e;font-size:16px;box-shadow:0 4px 14px rgba(39,190,255,.4);}
    .snd-h{font-size:16px;font-weight:800;letter-spacing:.2px;}
    .snd-hsub{font-size:11.5px;color:#8ea4bd;font-weight:600;margin-top:1px;}
    .snd-controls{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;}
    .snd-fieldgrp{display:flex;flex-direction:column;gap:4px;font-size:9.5px;text-transform:uppercase;letter-spacing:.09em;font-weight:700;color:#7f93b0;}
    .snd-select{padding:8px 11px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13);
        color:#e7eef7;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;}
    .snd-select:focus{outline:none;border-color:#27beff;}
    .snd-x{width:34px;height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);
        color:#93a6be;cursor:pointer;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;align-self:center;transition:all .12s;}
    .snd-x:hover{color:#fff;background:rgba(255,90,90,.16);border-color:rgba(255,90,90,.4);}
    .snd-body{padding:16px 18px 18px;}
    .snd-canvas-wrap{border-radius:14px;overflow:hidden;background:#0a0f1c;border:1px solid rgba(255,255,255,.08);
        min-height:220px;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 2px 22px rgba(0,0,0,.35);}
    .snd-canvas-wrap canvas{max-width:100%;height:auto;display:block;}
    .snd-msg{padding:30px;color:#9fb0c8;text-align:center;font-size:14px;line-height:1.55;}
    .snd-actions{display:flex;gap:9px;margin-top:14px;}
    .snd-btn{padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.12);font-weight:800;font-size:13px;
        cursor:pointer;font-family:inherit;background:rgba(255,255,255,.06);color:#e7eef7;transition:all .12s;}
    .snd-btn:hover{background:rgba(255,255,255,.13);}
    .snd-btn.primary{background:linear-gradient(180deg,#57d3ff,#27beff);color:#04121e;border-color:transparent;}
    .snd-btn.primary:hover{filter:brightness(1.08);}
    .snd-spinner{width:38px;height:38px;border:4px solid rgba(255,255,255,.14);border-top-color:#27beff;border-radius:50%;animation:snd-spin .8s linear infinite;}
    @keyframes snd-spin{to{transform:rotate(360deg);}}`;
    document.head.appendChild(s);
}

function openSoundingModal(lat, lon) {
    injectStyles();
    const old = document.getElementById('snd-bg');
    if (old) old.remove();

    const bg = document.createElement('div');
    bg.id = 'snd-bg';
    bg.className = 'snd-bg';
    bg.innerHTML = `
        <div class="snd-modal">
            <div class="snd-head">
                <div class="snd-title">
                    <span class="snd-badge"><i class="fa fa-chart-area"></i></span>
                    <div><div class="snd-h">Forecast Sounding</div>
                        <div class="snd-hsub">${lat.toFixed(2)}, ${lon.toFixed(2)}</div></div>
                </div>
                <div class="snd-controls">
                    <label class="snd-fieldgrp">Model
                        <select class="snd-select" id="snd-model">${MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select>
                    </label>
                    <label class="snd-fieldgrp">Forecast hour
                        <select class="snd-select" id="snd-fcst">${FCST.map((f) => `<option value="${f.v}">${f.label}</option>`).join('')}</select>
                    </label>
                    <button class="snd-x" id="snd-close" title="Close">&times;</button>
                </div>
            </div>
            <div class="snd-body">
                <div class="snd-canvas-wrap" id="snd-wrap"><div class="snd-msg">Loading sounding…</div></div>
                <div class="snd-actions">
                    <button class="snd-btn primary" id="snd-save">⤓ Save PNG</button>
                    <button class="snd-btn" id="snd-copy">Copy image</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(bg);

    const wrap = bg.querySelector('#snd-wrap');
    const modelEl = bg.querySelector('#snd-model');
    const fcstEl = bg.querySelector('#snd-fcst');
    const saveBtn = bg.querySelector('#snd-save');
    const copyBtn = bg.querySelector('#snd-copy');
    let canvas = null;

    const close = () => bg.remove();
    bg.querySelector('#snd-close').onclick = close;
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });

    async function load() {
        wrap.innerHTML = '<div class="snd-spinner"></div>';
        const model = modelEl.value;
        const fcst = fcstEl.value;
        try {
            const url = `/api/models/${model}/sounding?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&fhr=${encodeURIComponent(fcst)}`;
            const res = await fetch(url);
            const snd = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(snd.error || ('HTTP ' + res.status));
            canvas = document.createElement('canvas');
            const fLabel = (FCST.find((f) => f.v === fcst) || {}).label || '';
            renderSounding(canvas, snd, {
                title: `${(MODELS.find((m) => m.id === model) || {}).label || model} · ${fLabel}`,
                sub: `${lat.toFixed(2)}, ${lon.toFixed(2)}${snd.header ? '  ·  ' + snd.header : ''}`,
            });
            wrap.innerHTML = '';
            wrap.appendChild(canvas);
        } catch (err) {
            wrap.innerHTML = `<div class="snd-msg">${(err && err.message) || 'Could not load the sounding.'}</div>`;
            canvas = null;
        }
    }

    modelEl.onchange = load;
    fcstEl.onchange = load;
    saveBtn.onclick = () => {
        if (!canvas) return;
        canvas.toBlob((blob) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `vortex-sounding-${Date.now()}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }, 'image/png');
    };
    copyBtn.onclick = async () => {
        if (!canvas) return;
        try {
            const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
            await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => (copyBtn.textContent = 'Copy image'), 1600);
        } catch (e) {
            copyBtn.textContent = 'Copy failed';
            setTimeout(() => (copyBtn.textContent = 'Copy image'), 1600);
        }
    };

    load();
}

module.exports = { openSoundingModal };
