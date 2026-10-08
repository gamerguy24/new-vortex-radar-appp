/*
 * components/logo_overlay.js
 * Lets a signed-in user put their own logo on the radar (a corner watermark,
 * handy for livestreaming). The logo + placement (corner, size, opacity) are
 * stored per-user on the server (/api/logo) so they persist and sync, with a
 * localStorage cache for instant render on load.
 *
 * Opened via the "Brand Logo" menu row.
 */

import Dialog from "../js/ui/dialog.js";

const CACHE_KEY = 'vortexBrandLogo';
const MAX_DIM = 600; // longest edge of the stored image, px

/*
 * A video is stored as it was given. A still goes through a canvas and comes
 * out at most MAX_DIM across, which is why any photograph can be dropped in;
 * there is no cheap way to do that to a video in a browser, so the limit has
 * to be a limit. Said before the upload rather than after it.
 */
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

/** Read the kind off the data URL itself, so the two can never disagree. */
const isVideo = (u) => /^data:video\//.test(String(u || ''));

let _overlay = null;
let _current = null; // { dataUrl, corner, size, opacity }

// ---- overlay element ----
function ensureOverlay() {
    if (_overlay) return _overlay;
    _overlay = document.createElement('div');
    _overlay.id = 'vr-logo-overlay';
    /*
     * Both elements, one shown. Swapping the tag would mean rebuilding the
     * node on every change, and a video that is torn down and recreated
     * restarts from its first frame each time the size slider moves.
     */
    _overlay.innerHTML = '<img alt="logo" />'
      + '<video muted loop playsinline autoplay preload="auto"></video>';
    document.body.appendChild(_overlay);
    return _overlay;
}

function applyLogo(cfg) {
    _current = cfg || null;
    if (!cfg || !cfg.dataUrl) {
        if (_overlay) _overlay.style.display = 'none';
        return;
    }
    const ov = ensureOverlay();
    ov.className = 'vr-logo-' + (cfg.corner || 'top-right');
    ov.style.width = (cfg.size || 16) + 'vw';
    ov.style.opacity = cfg.opacity != null ? cfg.opacity : 1;
    const img = ov.querySelector('img');
    const vid = ov.querySelector('video');
    if (isVideo(cfg.dataUrl)) {
      img.style.display = 'none';
      img.removeAttribute('src');
      // Only reassign when it actually changed: setting src restarts
      // playback, and the size and opacity controls apply live.
      if (vid.getAttribute('src') !== cfg.dataUrl) vid.setAttribute('src', cfg.dataUrl);
      vid.style.display = 'block';
      // Muted autoplay is allowed without a gesture; a rejected play() is
      // not worth a console error on a watermark.
      const p = vid.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      vid.pause();
      vid.removeAttribute('src');
      vid.style.display = 'none';
      img.src = cfg.dataUrl;
      img.style.display = 'block';
    }
    ov.style.display = 'block';
}

// ---- helpers ----
async function api(method, body) {
    const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch('/api/logo', opts);
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
}

// Downscale + compress an uploaded image, or take a video as it is.
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read that file.'));

        /*
         * Video goes in untouched. There is no canvas pass that would shrink
         * it without re-encoding, so the size is the user's to control and
         * the only honest thing to do is say so up front.
         */
        if (file && String(file.type || '').startsWith('video/')) {
            if (VIDEO_TYPES.indexOf(file.type) === -1) {
                reject(new Error('Use an MP4 or WebM video.'));
                return;
            }
            if (file.size > MAX_VIDEO_BYTES) {
                reject(new Error(`That video is ${(file.size / 1048576).toFixed(1)} MB. `
                    + `The limit is ${MAX_VIDEO_BYTES / 1048576} MB — try a shorter loop or a smaller frame.`));
                return;
            }
            const vreader = new FileReader();
            vreader.onerror = () => reject(new Error('Could not read that file.'));
            vreader.onload = () => resolve(vreader.result);
            vreader.readAsDataURL(file);
            return;
        }

        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('That file is not a valid image.'));
            img.onload = () => {
                const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
                const w = Math.round(img.width * scale);
                const h = Math.round(img.height * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                // PNG keeps transparency (logos usually have it)
                resolve(canvas.toDataURL('image/png'));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

// ---- dialog ----
function openLogoDialog() {
    const cfg = _current || {};
    const content = `
        <div class="vr-logo-form">
            <p class="vr-logo-intro">Add your own logo or an animated bug as a watermark on the radar — great for streaming. It's saved to your account.</p>

            <div class="vr-logo-drop" id="vr-logo-drop">
                <img id="vr-logo-preview" ${!isVideo(cfg.dataUrl) && cfg.dataUrl ? `src="${cfg.dataUrl}"` : ''}
                  style="${cfg.dataUrl && !isVideo(cfg.dataUrl) ? '' : 'display:none;'}" />
                <video id="vr-logo-preview-video" muted loop playsinline autoplay
                  ${isVideo(cfg.dataUrl) ? `src="${cfg.dataUrl}"` : ''}
                  style="${isVideo(cfg.dataUrl) ? '' : 'display:none;'}"></video>
                <div id="vr-logo-placeholder"><i class="ti ti-photo-plus"></i><br>Click or drop an image</div>
                <input type="file" id="vr-logo-file" accept="image/*,video/mp4,video/webm" hidden />
            </div>

            <div class="vr-logo-label">Corner</div>
            <div class="vr-logo-corners" id="vr-logo-corners">
                <button data-corner="top-left" class="${cfg.corner === 'top-left' ? 'active' : ''}">Top left</button>
                <button data-corner="top-right" class="${(cfg.corner || 'top-right') === 'top-right' ? 'active' : ''}">Top right</button>
                <button data-corner="bottom-left" class="${cfg.corner === 'bottom-left' ? 'active' : ''}">Bottom left</button>
                <button data-corner="bottom-right" class="${cfg.corner === 'bottom-right' ? 'active' : ''}">Bottom right</button>
            </div>

            <div class="vr-logo-label">Size</div>
            <input type="range" id="vr-logo-size" min="5" max="40" value="${cfg.size || 16}" />

            <div class="vr-logo-label">Opacity</div>
            <input type="range" id="vr-logo-opacity" min="10" max="100" value="${Math.round((cfg.opacity != null ? cfg.opacity : 1) * 100)}" />

            <div class="vr-logo-actions">
                <button class="vr-logo-remove" id="vr-logo-remove" ${cfg.dataUrl ? '' : 'disabled'}>Remove</button>
                <button class="vr-logo-save" id="vr-logo-save" ${cfg.dataUrl ? '' : 'disabled'}>Save</button>
            </div>
            <div class="vr-logo-msg" id="vr-logo-msg"></div>
        </div>`;

    const dialog = new Dialog('Brand Logo', 'photo', content, {}, true);

    const $ = (id) => document.getElementById(id);
    const drop = $('vr-logo-drop');
    const fileInput = $('vr-logo-file');
    const preview = $('vr-logo-preview');
    const previewVideo = $('vr-logo-preview-video');
    const placeholder = $('vr-logo-placeholder');
    const cornersEl = $('vr-logo-corners');
    const sizeEl = $('vr-logo-size');
    const opacityEl = $('vr-logo-opacity');
    const saveBtn = $('vr-logo-save');
    const removeBtn = $('vr-logo-remove');
    const msg = $('vr-logo-msg');

    let pendingDataUrl = cfg.dataUrl || null;
    let corner = cfg.corner || 'top-right';

    function setMsg(t, kind) { msg.textContent = t || ''; msg.className = 'vr-logo-msg' + (kind ? ' ' + kind : ''); }

    // Live-preview onto the actual map as the user tweaks settings.
    function livePreview() {
        if (!pendingDataUrl) return;
        applyLogo({ dataUrl: pendingDataUrl, corner, size: +sizeEl.value, opacity: +opacityEl.value / 100 });
    }

    async function handleFile(file) {
        if (!file) return;
        try {
            const vid = file && String(file.type || '').startsWith('video/');
            setMsg(vid ? 'Reading video…' : 'Processing image…');
            pendingDataUrl = await fileToDataUrl(file);
            // Show it in the one that can display it, and empty the other so
            // a previous choice is not left behind it.
            if (isVideo(pendingDataUrl)) {
              preview.removeAttribute('src');
              preview.style.display = 'none';
              previewVideo.src = pendingDataUrl;
              previewVideo.style.display = 'block';
              const p = previewVideo.play();
              if (p && typeof p.catch === 'function') p.catch(() => {});
            } else {
              previewVideo.pause();
              previewVideo.removeAttribute('src');
              previewVideo.style.display = 'none';
              preview.src = pendingDataUrl;
              preview.style.display = 'block';
            }
            placeholder.style.display = 'none';
            saveBtn.disabled = false;
            setMsg('');
            livePreview();
        } catch (err) { setMsg(err.message, 'warn'); }
    }

    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => {
        e.preventDefault(); drop.classList.remove('drag');
        handleFile(e.dataTransfer.files[0]);
    });

    cornersEl.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-corner]');
        if (!b) return;
        corner = b.dataset.corner;
        cornersEl.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        livePreview();
    });

    sizeEl.addEventListener('input', livePreview);
    opacityEl.addEventListener('input', livePreview);

    saveBtn.addEventListener('click', async () => {
        if (!pendingDataUrl) return;
        const payload = { dataUrl: pendingDataUrl, corner, size: +sizeEl.value, opacity: +opacityEl.value / 100 };
        saveBtn.disabled = true;
        setMsg('Saving...');
        try {
            const { logo } = await api('POST', payload);
            applyLogo(logo);
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(logo)); } catch {}
            setMsg('Saved. Your logo is on the radar.', 'ok');
            removeBtn.disabled = false;
        } catch (err) { setMsg(err.message, 'warn'); }
        saveBtn.disabled = false;
    });

    removeBtn.addEventListener('click', async () => {
        setMsg('Removing...');
        try {
            await api('DELETE');
            applyLogo(null);
            try { localStorage.removeItem(CACHE_KEY); } catch {}
            pendingDataUrl = null;
            preview.style.display = 'none';
            placeholder.style.display = '';
            saveBtn.disabled = true; removeBtn.disabled = true;
            setMsg('Logo removed.', 'ok');
        } catch (err) { setMsg(err.message, 'warn'); }
    });
}

// ---- init ----
function loadInitial() {
    // instant render from cache
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached && cached.dataUrl) applyLogo(cached);
    } catch {}
    // authoritative from server
    api('GET').then(({ logo }) => {
        applyLogo(logo);
        try {
            if (logo) localStorage.setItem(CACHE_KEY, JSON.stringify(logo));
            else localStorage.removeItem(CACHE_KEY);
        } catch {}
    }).catch(() => {});
}

function init() {
    const btn = document.getElementById('armrBrandLogoBtn');
    if (btn) btn.addEventListener('click', () => {
        const m = document.getElementById('vortexRadarMenu');
        if (m) m.style.display = 'none';
        openLogoDialog();
    });
    loadInitial();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
