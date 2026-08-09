/*
 * menu_item.js
 * Footer tool for click-a-point forecast soundings. Arm it, click anywhere on
 * the map, and it fetches a BUFKIT-style sounding (rucsoundings.js) for that
 * point and renders a Skew-T + hodograph + indices (skewt.js) in a modal, with
 * a model + forecast-hour picker.
 */

const map = require('../core/map/map');
const { MODELS, fetchSounding } = require('./rucsoundings');
const { renderSounding } = require('./skewt');

const icon = '#soundingMenuItemIcon';

// forecast lead times offered (0 => the model's shortest/analysis)
const FCST = [
    { v: 'shortest', label: 'Analysis' },
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
    .snd-bg{position:fixed;inset:0;z-index:100065;background:rgba(4,8,16,.72);backdrop-filter:blur(6px);
        display:flex;align-items:center;justify-content:center;padding:22px;font-family:'Onest',system-ui,sans-serif;}
    .snd-modal{width:min(1040px,96vw);max-height:94vh;overflow:auto;background:rgba(11,18,32,.98);
        border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.6);color:#e7eef7;}
    .snd-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1);flex-wrap:wrap;}
    .snd-head h2{margin:0;font-size:1.05em;display:flex;align-items:center;gap:8px;}
    .snd-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
    .snd-select{padding:7px 10px;border-radius:8px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.16);color:#e7eef7;font-family:inherit;font-size:13px;}
    .snd-select:focus{outline:none;border-color:#27beff;}
    .snd-x{cursor:pointer;opacity:.7;font-size:22px;line-height:1;}.snd-x:hover{opacity:1;}
    .snd-body{padding:14px 16px;}
    .snd-canvas-wrap{border-radius:12px;overflow:hidden;background:#0b1220;border:1px solid rgba(255,255,255,.1);min-height:200px;display:flex;align-items:center;justify-content:center;}
    .snd-canvas-wrap canvas{max-width:100%;height:auto;display:block;}
    .snd-msg{padding:26px;color:#9fb0c8;text-align:center;font-size:14px;}
    .snd-actions{display:flex;gap:8px;margin-top:12px;}
    .snd-btn{padding:9px 14px;border-radius:9px;border:none;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;background:rgba(255,255,255,.08);color:#e7eef7;}
    .snd-btn:hover{background:rgba(255,255,255,.16);}
    .snd-spinner{width:36px;height:36px;border:4px solid rgba(255,255,255,.15);border-top-color:#27beff;border-radius:50%;animation:snd-spin .8s linear infinite;}
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
                <h2><i class="fa fa-chart-area"></i> Forecast Sounding</h2>
                <div class="snd-controls">
                    <select class="snd-select" id="snd-model">${MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select>
                    <select class="snd-select" id="snd-fcst">${FCST.map((f) => `<option value="${f.v}">${f.label}</option>`).join('')}</select>
                    <span class="snd-x" id="snd-close">&times;</span>
                </div>
            </div>
            <div class="snd-body">
                <div class="snd-canvas-wrap" id="snd-wrap"><div class="snd-msg">Loading sounding…</div></div>
                <div class="snd-actions"><button class="snd-btn" id="snd-save">Save PNG</button></div>
            </div>
        </div>`;
    document.body.appendChild(bg);

    const wrap = bg.querySelector('#snd-wrap');
    const modelEl = bg.querySelector('#snd-model');
    const fcstEl = bg.querySelector('#snd-fcst');
    const saveBtn = bg.querySelector('#snd-save');
    let canvas = null;

    const close = () => bg.remove();
    bg.querySelector('#snd-close').onclick = close;
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });

    async function load() {
        wrap.innerHTML = '<div class="snd-spinner"></div>';
        const model = modelEl.value;
        const fcst = fcstEl.value;
        try {
            const snd = await fetchSounding(model, lat, lon, fcst);
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

    load();
}

module.exports = { openSoundingModal };
