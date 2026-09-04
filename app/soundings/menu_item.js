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

/*
 * Models served by the raw-GRIB sounding endpoint (server: soundings_grib.js).
 *
 * This list was GFS-only for two reasons, both since fixed. The NAM's winds
 * came out as six-figure nonsense because NCEP packs u and v into a SINGLE
 * GRIB message and the decoder was reading the wrong one from a byte range
 * computed backwards; HRRR and ECMWF use packings the hand-written decoder
 * does not implement (JPEG2000 and CCSDS) and now fall back to a compiled
 * decoder for those. All five verified to give plausible profiles: winds
 * within 0-250 kt and temperature decreasing with height.
 */
const MODELS = [
    { id: 'hrrr', label: 'HRRR (3 km)' },
    { id: 'nam3km', label: 'NAM 3 km nest' },
    { id: 'nam', label: 'NAM (12 km)' },
    { id: 'gfs', label: 'GFS (0.25°)' },
    { id: 'ecmwf', label: 'ECMWF (0.25°)' },
];

/*
 * Forecast lead times, per model (0 = analysis).
 *
 * These were one fixed list for every model, which was harmless while GFS was
 * the only choice. It is not harmless now: the HRRR stops at +48, the NAM 3 km
 * nest at +60, and asking a model for an hour it does not run just errors. Each
 * model offers only hours it actually publishes.
 */
const FCST_BY_MODEL = {
    /*
     * HRRR runs 48 hours only on the 00/06/12/18Z cycles; every other hour
     * stops at +18. The sounding always uses the LATEST run, which is usually
     * one of the short ones, so offering 24-48 h produced "not posted yet" most
     * of the day. +18 is what is reliably there.
     */
    hrrr: [0, 1, 2, 3, 4, 6, 9, 12, 15, 18],
    nam3km: [0, 1, 3, 6, 9, 12, 18, 24, 36, 48, 60],
    nam: [0, 3, 6, 12, 18, 24, 36, 48, 60, 84],
    gfs: [0, 3, 6, 12, 24, 48, 72, 120, 180, 240],
    // ECMWF open data is 3-hourly to +144, then 6-hourly.
    ecmwf: [0, 3, 6, 12, 24, 48, 72, 120, 144],
};
const DEFAULT_FCST = [0, 3, 6, 12, 24, 48];

function fcstFor(modelId) {
    return (FCST_BY_MODEL[modelId] || DEFAULT_FCST)
        .map((h) => ({ v: String(h), label: h === 0 ? 'Analysis' : '+' + h + ' h' }));
}

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
    .snd-bg{position:fixed;inset:0;z-index:100065;background:var(--vx-scrim);
        display:flex;align-items:center;justify-content:center;padding:24px;font-family:var(--vx-font);}
    .snd-modal{width:min(1060px,96vw);max-height:94vh;overflow:auto;color:var(--vx-text);
        background:linear-gradient(180deg,rgba(17,25,42,.99),rgba(9,14,26,.99));
        border:1px solid rgba(255,255,255,.10);border-radius:var(--vx-r-3);
        box-shadow:var(--vx-shadow-lg);}
    .snd-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 18px;flex-wrap:wrap;
        border-bottom:1px solid rgba(255,255,255,.07);background:linear-gradient(180deg,var(--vx-accent-soft),var(--vx-accent-soft));}
    .snd-title{display:flex;align-items:center;gap:12px;min-width:0;}
    .snd-badge{width:38px;height:38px;border-radius:var(--vx-r-3);display:flex;align-items:center;justify-content:center;flex-shrink:0;
        background:var(--vx-accent);color:var(--vx-accent-ink);font-size:16px;box-shadow:var(--vx-shadow);}
    .snd-h{font-size:16px;font-weight:800;letter-spacing:.2px;}
    .snd-hsub{font-size:11.5px;color:var(--vx-text-2);font-weight:600;margin-top:1px;}
    .snd-controls{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;}
    .snd-fieldgrp{display:flex;flex-direction:column;gap:4px;font-size:9.5px;text-transform:uppercase;letter-spacing:.09em;font-weight:700;color:var(--vx-text-2);}
    /* Solid, not translucent: the open list is opaque, and a see-through
       closed control next to it read as a different colour. color-scheme keeps
       the native popup dark (see the global select rule in index.css). */
    .snd-select{padding:8px 11px;border-radius:var(--vx-r-3);background:var(--vx-surface-2,#161d29);border:1px solid rgba(255,255,255,.13);
        color:var(--vx-text);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;color-scheme:dark;}
    .snd-select option{background:var(--vx-surface-2,#161d29);color:var(--vx-text,#e8eef7);}
    .snd-select:hover{border-color:rgba(255,255,255,.24);}
    .snd-select:focus{outline:none;border-color:var(--vx-accent);}
    .snd-x{width:34px;height:34px;border-radius:var(--vx-r-3);border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);
        color:var(--vx-text-2);cursor:pointer;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;align-self:center;transition:all .12s;}
    .snd-x:hover{color:#fff;background:rgba(255,90,90,.16);border-color:rgba(255,90,90,.4);}
    .snd-body{padding:16px 18px 18px;}
    .snd-canvas-wrap{border-radius:var(--vx-r-3);overflow:hidden;background:var(--vx-surface);border:1px solid rgba(255,255,255,.08);
        min-height:220px;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 2px 22px rgba(0,0,0,.35);}
    .snd-canvas-wrap canvas{max-width:100%;height:auto;display:block;}
    .snd-msg{padding:30px;color:var(--vx-text-2);text-align:center;font-size:14px;line-height:1.55;}
    .snd-actions{display:flex;gap:9px;margin-top:14px;}
    .snd-btn{padding:10px 16px;border-radius:var(--vx-r-3);border:1px solid rgba(255,255,255,.12);font-weight:800;font-size:13px;
        cursor:pointer;font-family:inherit;background:rgba(255,255,255,.06);color:var(--vx-text);transition:all .12s;}
    .snd-btn:hover{background:rgba(255,255,255,.13);}
    .snd-btn.primary{background:linear-gradient(180deg,#57d3ff,var(--vx-accent));color:var(--vx-accent-ink);border-color:transparent;}
    .snd-btn.primary:hover{filter:brightness(1.08);}
    .snd-spinner{width:38px;height:38px;border:4px solid rgba(255,255,255,.14);border-top-color:var(--vx-accent);border-radius:50%;animation:snd-spin .8s linear infinite;}
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
                        <select class="snd-select" id="snd-fcst">${fcstFor(MODELS[0].id).map((f) => `<option value="${f.v}">${f.label}</option>`).join('')}</select>
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
    let imageBlob = null; // set when the exact SounderPy image is available

    const close = () => bg.remove();
    bg.querySelector('#snd-close').onclick = close;
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });

    /*
     * Explain, in the panel, why this is the built-in plot rather than the
     * SHARPpy one — with the exact command that fixes it. "sounderpy is not
     * installed" is a one-line fix that is invisible without being told.
     */
    function buildSounderpyNote(reason) {
        const missing = /No module named|not available|ModuleNotFound/i.test(reason);
        const box = document.createElement('div');
        box.style.cssText = 'margin:10px 2px 0;padding:9px 11px;border-radius:8px;font-size:11.5px;line-height:1.45;'
            + 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#9fb2c9;';
        box.innerHTML = missing
            ? 'Showing the built-in sounding. For the exact SHARPpy plot, install the renderer on the server:'
                + '<br><code style="display:inline-block;margin-top:5px;padding:3px 6px;border-radius:4px;'
                + 'background:rgba(0,0,0,.35);color:#cfe2f5;font-size:11px">pip install sounderpy metpy matplotlib numpy</code>'
                + '<br><span style="opacity:.7">then restart the server.</span>'
            : 'Showing the built-in sounding — the SHARPpy renderer failed: '
                + '<span style="opacity:.8">' + reason.replace(/[<>&]/g, '') + '</span>';
        return box;
    }

    async function load() {
        wrap.innerHTML = '<div class="snd-spinner"></div>';
        canvas = null; imageBlob = null;
        const model = modelEl.value;
        const fcst = fcstEl.value;
        const qs = `lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&fhr=${encodeURIComponent(fcst)}`;

        /*
         * 1) Prefer the exact SHARPpy/SounderPy image — the same renderer the
         * reference sites use. It needs Python packages on the SERVER, and when
         * they are missing the endpoint answers 501 and we fall back.
         *
         * The reason is captured and shown below the fallback rather than
         * swallowed: silently serving a different-looking plot leaves you
         * wondering why it does not match, with nothing on screen to explain it.
         */
        let sounderpyNote = null;
        try {
            const imgRes = await fetch(`/api/models/${model}/sounding/image?${qs}`);
            if (imgRes.ok && (imgRes.headers.get('content-type') || '').indexOf('image') !== -1) {
                imageBlob = await imgRes.blob();
                const img = document.createElement('img');
                img.alt = 'Sounding';
                img.style.cssText = 'max-width:100%;height:auto;display:block;';
                img.src = URL.createObjectURL(imageBlob);
                wrap.innerHTML = '';
                wrap.appendChild(img);
                return;
            }
            const why = await imgRes.json().catch(() => ({}));
            sounderpyNote = String(why.error || ('HTTP ' + imgRes.status));
        } catch (e) {
            sounderpyNote = e.message || 'request failed';
        }

        // 2) Built-in Skew-T / hodograph / parameter panel (always available).
        try {
            const res = await fetch(`/api/models/${model}/sounding?${qs}`);
            const snd = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(snd.error || ('HTTP ' + res.status));
            canvas = document.createElement('canvas');
            const fLabel = (fcstFor(model).find((f) => f.v === fcst) || {}).label || '';
            renderSounding(canvas, snd, {
                title: `${(MODELS.find((m) => m.id === model) || {}).label || model} · ${fLabel}`,
                sub: `${lat.toFixed(2)}, ${lon.toFixed(2)}${snd.header ? '  ·  ' + snd.header : ''}`,
            });
            wrap.innerHTML = '';
            wrap.appendChild(canvas);
            if (sounderpyNote) wrap.appendChild(buildSounderpyNote(sounderpyNote));
        } catch (err) {
            wrap.innerHTML = `<div class="snd-msg">${(err && err.message) || 'Could not load the sounding.'}</div>`;
            canvas = null;
        }
    }

    modelEl.onchange = () => {
        /*
         * Rebuild the hour list for the newly chosen model, keeping the current
         * lead time when that model also runs it — switching HRRR -> NAM to
         * compare the same hour should not silently jump you back to analysis.
         */
        const want = fcstEl.value;
        const hours = fcstFor(modelEl.value);
        fcstEl.innerHTML = hours.map((f) => `<option value="${f.v}">${f.label}</option>`).join('');
        fcstEl.value = hours.some((f) => f.v === want) ? want : '0';
        load();
    };
    fcstEl.onchange = load;
    // Current image bytes — the SounderPy PNG when present, else the canvas.
    const currentBlob = async () => {
        if (imageBlob) return imageBlob;
        if (canvas) return await new Promise((r) => canvas.toBlob(r, 'image/png'));
        return null;
    };
    saveBtn.onclick = async () => {
        const blob = await currentBlob();
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `vortex-sounding-${Date.now()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    copyBtn.onclick = async () => {
        const blob = await currentBlob();
        if (!blob) return;
        try {
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
