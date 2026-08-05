import Dialog from "../js/ui/dialog.js";

// --- Add your cameras here ---------------------------------------------------
const CAMERAS = [
    { name: 'Times Square', url: 'https://www.youtube.com/embed/z-jYdOIKcTQ?autoplay=1', lng: -73.9855, lat: 40.7580 },
    { name: 'Lower Manhattan, NY', url: 'https://www.youtube.com/embed/1kvGNR_A3DY?autoplay=1', lng: -74.0026, lat: 40.7081 },
    { name: 'Austell, GA - Live Train Cam', url: 'https://www.youtube.com/embed/Ux0rtJXPPQ0?autoplay=1', lng: -84.6388, lat: 33.8126 },
    { name: 'Gatlinburg, TN - SkyPark', url: 'https://www.youtube.com/embed/teGLziUvDkI?autoplay=1', lng: -83.5124, lat: 35.7143 },
    { name: 'Lawton, OK', url: 'https://www.youtube.com/embed/n7uM73bpS3E?autoplay=1', lng: -98.3903, lat: 34.6087 },
    { name: 'Nashville, TN - Lower Broadway', url: 'https://www.youtube.com/embed/h5Grd2w7HQM?autoplay=1', lng: -86.7767, lat: 36.1596 },
    { name: 'Sunny Isles Beach, FL', url: 'https://www.youtube.com/embed/bi7B4EmyHHs?autoplay=1', lng: -80.1223, lat: 25.9407 },
    { name: 'Council Bluffs, IA', url: 'https://www.youtube.com/embed/qsrevo5Vdkw?autoplay=1', lng: -95.8608, lat: 41.2619 },
    { name: 'Fort Madison, IA - Train Cam', url: 'https://www.youtube.com/embed/L6eG4ahJc_Q?autoplay=1', lng: -91.3151, lat: 40.6295 },
    { name: 'Birmingham, AL - Railcam', url: 'https://www.youtube.com/embed/KUM6HBnv_fw?autoplay=1', lng: -86.8104, lat: 33.5186 },
];
// -----------------------------------------------------------------------------

// Store markers so we can remove them later
let _camMarkers = [];
let _camPopup = null;

export function addCamMarkers(mapInstance) {
    removeCamMarkers();
    CAMERAS.forEach(cam => {
        const el = document.createElement('div');
        el.title = cam.name;
        el.style.cssText = `
            width: 32px; height: 32px;
            background: #ff2121;
            border: 2px solid white;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5);
            font-size: 15px;
            color: white;
        `;
        el.innerHTML = '<i class="ti ti-video"></i>';

        const maps = [mapInstance.map];
        if (mapInstance.dualMap) maps.push(mapInstance.dualMap);

        maps.forEach(m => {
            const marker = new maplibregl.Marker({ element: el.cloneNode(true) })
                .setLngLat([cam.lng, cam.lat])
                .addTo(m);
            marker.getElement().addEventListener('click', (e) => {
                e.stopPropagation();
                _openCamPopup(m, cam);
            });
            _camMarkers.push(marker);
        });
    });
}

export function removeCamMarkers() {
    _closeCamPopup();
    _camMarkers.forEach(m => m.remove());
    _camMarkers = [];
}

function _closeCamPopup() {
    if (_camPopup) {
        try { _camPopup.remove(); } catch { /* ignore */ }
        _camPopup = null;
    }
}

function _openCamPopup(map, cam) {
    _closeCamPopup();

    const ytId = getYouTubeId(cam.url);
    let playerHtml;

    const actionBtns = `<span style="display:flex;align-items:center;gap:6px;margin-left:8px;flex-shrink:0;">
        <button id="cam-fullscreen-btn" title="Fullscreen (or double-click the video)" style="background:rgba(255,255,255,0.14);border:none;color:#fff;cursor:pointer;font-size:15px;padding:5px 9px;border-radius:7px;display:inline-flex;align-items:center;gap:5px;font-weight:700;"><i class="ti ti-arrows-maximize"></i> Full</button>
        <button id="cam-close-btn" title="Close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:18px;padding:2px;display:inline-flex;align-items:center;"><i class="ti ti-x"></i></button>
    </span>`;

    if (ytId) {
        const thumbUrl = `https://img.youtube.com/vi/${encodeURIComponent(ytId)}/hqdefault.jpg`;
        playerHtml = `
            <div style="font-weight:600;font-size:13px;padding:6px 8px;display:flex;justify-content:space-between;align-items:center;">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${cam.name}</span>
                <span style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:8px;">
                    <a href="https://www.youtube.com/watch?v=${encodeURIComponent(ytId)}" target="_blank" rel="noopener noreferrer"
                        style="font-size:11px;color:#ff4444;text-decoration:none;"
                        onclick="event.stopPropagation();">
                        <i class="ti ti-brand-youtube" style="vertical-align:middle;"></i> YouTube
                    </a>
                    ${actionBtns}
                </span>
            </div>
            <div id="cam-popup-player" style="position:relative;width:100%;padding-bottom:56.25%;background:#000;cursor:pointer;" data-yt-id="${ytId}">
                <img src="${thumbUrl}" alt="${cam.name}"
                    style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;"/>
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                    width:48px;height:48px;background:rgba(255,33,33,0.9);border-radius:50%;
                    display:flex;align-items:center;justify-content:center;pointer-events:none;">
                    <i class="ti ti-player-play-filled" style="font-size:22px;color:white;margin-left:2px;"></i>
                </div>
            </div>
        `;
    } else {
        playerHtml = `
            <div style="font-weight:600;font-size:13px;padding:6px 8px;display:flex;justify-content:space-between;align-items:center;">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${cam.name}</span>
                ${actionBtns}
            </div>
            <div id="cam-popup-player" style="position:relative;width:100%;padding-bottom:56.25%;background:#111;cursor:pointer;" data-cam-url="${cam.url}">
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#aaa;">
                    <div style="width:48px;height:48px;background:rgba(255,33,33,0.9);border-radius:50%;
                        display:flex;align-items:center;justify-content:center;margin:0 auto 6px;">
                        <i class="ti ti-player-play-filled" style="font-size:22px;color:white;margin-left:2px;"></i>
                    </div>
                    <span style="font-size:12px;">Tap to load</span>
                </div>
            </div>
        `;
    }

    _camPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: '340px',
        className: 'cam-popup'
    })
        .setLngLat([cam.lng, cam.lat])
        .setHTML(`<div class="cam-popup-content">${playerHtml}</div>`)
        .addTo(map);

    _camPopup.on('close', () => { _camPopup = null; });

    // Bind play + fullscreen clicks after popup is in DOM
    requestAnimationFrame(() => {
        const container = document.getElementById('cam-popup-player');
        if (!container) return;

        // Double-click the video to jump straight to fullscreen.
        container.addEventListener('dblclick', (e) => { e.stopPropagation(); _openFullscreen(cam); });

        container.addEventListener('click', () => {
            container.style.cursor = 'default';
            if (container.dataset.ytId) {
                const embedUrl = buildYouTubeEmbed(container.dataset.ytId);
                container.innerHTML = `
                    <iframe id="cam-popup-iframe" src="${embedUrl}" allowfullscreen
                        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                        style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;"
                        referrerpolicy="no-referrer-when-downgrade"></iframe>
                `;
            } else if (container.dataset.camUrl) {
                container.innerHTML = `
                    <iframe id="cam-popup-iframe" src="${container.dataset.camUrl}" allowfullscreen allow="autoplay; encrypted-media"
                        style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;"></iframe>
                `;
            }
        });

        const fsButton = document.getElementById('cam-fullscreen-btn');
        if (fsButton) {
            fsButton.addEventListener('click', (e) => {
                e.stopPropagation();
                _openFullscreen(cam);
            });
        }

        const closeBtn = document.getElementById('cam-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                _closeCamPopup();
            });
        }
    });
}

function _openFullscreen(cam) {
    const existing = document.getElementById('cam-fullscreen-overlay');
    if (existing) existing.remove();

    const ytId = getYouTubeId(cam.url);
    let iframeHtml;

    if (ytId) {
        const embedUrl = buildYouTubeEmbed(ytId);
        iframeHtml = `<iframe src="${embedUrl}" allowfullscreen
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            style="width:100%;height:100%;border:none;"
            referrerpolicy="no-referrer-when-downgrade"></iframe>`;
    } else {
        iframeHtml = `<iframe src="${cam.url}" allowfullscreen allow="autoplay; encrypted-media"
            style="width:100%;height:100%;border:none;"></iframe>`;
    }

    const overlay = document.createElement('div');
    overlay.id = 'cam-fullscreen-overlay';
    overlay.innerHTML = `
        <div class="cam-fs-header">
            <span class="cam-fs-title">${cam.name}</span>
            <button id="cam-fs-close" title="Exit Fullscreen"><i class="ti ti-x"></i></button>
        </div>
        <div class="cam-fs-player">${iframeHtml}</div>
    `;
    document.body.appendChild(overlay);

    function closeFs() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    const onKey = (e) => { if (e.key === 'Escape') closeFs(); };
    document.getElementById('cam-fs-close').addEventListener('click', closeFs);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFs(); });
    document.addEventListener('keydown', onKey);
}

/** Extract YouTube video ID from various URL formats. Returns null if not YouTube. */
function getYouTubeId(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
            const embedMatch = u.pathname.match(/\/embed\/([^/?]+)/);
            if (embedMatch) return embedMatch[1];
            if (u.searchParams.has('v')) return u.searchParams.get('v');
            if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
        }
    } catch { /* not a valid URL */ }
    return null;
}

/** Build proper YouTube embed URL with mobile-friendly params. */
function buildYouTubeEmbed(videoId) {
    const params = new URLSearchParams({
        autoplay: '1',
        playsinline: '1',
        rel: '0',
        modestbranding: '1',
        enablejsapi: '1',
        origin: window.location.origin
    });
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`;
}

export default function openCams(highlightName = null) {
    let listHtml = '';

    if (CAMERAS.length === 0) {
        listHtml = '<p style="color: var(--text-muted, #9ca3af); font-size: 14px; text-align: center; padding: 20px 0;">No live cameras are available right now. Check back during active weather events.</p>';
    } else {
        listHtml = CAMERAS.map((cam, idx) => {
            const ytId = getYouTubeId(cam.url);
            const isHighlighted = highlightName === cam.name;
            const borderColor = isHighlighted ? '#ff2121' : 'var(--border-color, gray)';

            if (ytId) {
                const thumbUrl = `https://img.youtube.com/vi/${encodeURIComponent(ytId)}/hqdefault.jpg`;
                return `
                    <div style="background: rgba(255,255,255,0.05); border: 1px solid ${borderColor}; border-radius: 10px; overflow: hidden; margin-bottom: 12px;">
                        <div style="padding: 8px 12px; font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${cam.name}</span>
                            <span style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                                <button data-fs="${idx}" title="Fullscreen this cam" style="background: none; border: none; color: #cfe0f5; cursor: pointer; font-size: 20px; padding: 0; display: inline-flex; align-items: center;">
                                    <i class="ti ti-maximize"></i>
                                </button>
                                <a href="https://www.youtube.com/watch?v=${encodeURIComponent(ytId)}" target="_blank" rel="noopener noreferrer"
                                    style="font-size: 12px; color: #ff4444; text-decoration: none; white-space: nowrap;"
                                    onclick="event.stopPropagation();">
                                    <i class="ti ti-brand-youtube" style="vertical-align: middle;"></i> YouTube
                                </a>
                            </span>
                        </div>
                        <div id="cam-container-${idx}" style="position: relative; width: 100%; padding-bottom: 56.25%; background: #000; cursor: pointer;" data-yt-id="${ytId}">
                            <img src="${thumbUrl}" alt="${cam.name}"
                                style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;" />
                            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                                width: 60px; height: 60px; background: rgba(255,33,33,0.9); border-radius: 50%;
                                display: flex; align-items: center; justify-content: center; pointer-events: none;">
                                <i class="ti ti-player-play-filled" style="font-size: 28px; color: white; margin-left: 3px;"></i>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                return `
                    <div style="background: rgba(255,255,255,0.05); border: 1px solid ${borderColor}; border-radius: 10px; overflow: hidden; margin-bottom: 12px;">
                        <div style="padding: 8px 12px; font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${cam.name}</span>
                            <button data-fs="${idx}" title="Fullscreen this cam" style="background: none; border: none; color: #cfe0f5; cursor: pointer; font-size: 20px; padding: 0; display: inline-flex; align-items: center; flex-shrink: 0;">
                                <i class="ti ti-maximize"></i>
                            </button>
                        </div>
                        <div id="cam-container-${idx}" style="position: relative; width: 100%; padding-bottom: 56.25%; background: #111; cursor: pointer;" data-cam-url="${cam.url}">
                            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: #aaa;">
                                <div style="width: 60px; height: 60px; background: rgba(255,33,33,0.9); border-radius: 50%;
                                    display: flex; align-items: center; justify-content: center; margin: 0 auto 8px;">
                                    <i class="ti ti-player-play-filled" style="font-size: 28px; color: white; margin-left: 3px;"></i>
                                </div>
                                <span style="font-size: 13px;">Tap to load</span>
                            </div>
                        </div>
                    </div>
                `;
            }
        }).join('');
    }

    const camsContent = `
        <p style="margin-bottom: 16px; color: var(--text-muted, #9ca3af);">Live camera feeds from the Twistcaster Live Media team.</p>
        <div id="cams-list">${listHtml}</div>
    `;

    new Dialog('Live Cams', 'video', camsContent, {}, true);

    // Per-cam fullscreen buttons — each opens that single cam fullscreen.
    document.querySelectorAll('#cams-list [data-fs]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cam = CAMERAS[+btn.dataset.fs];
            if (cam) _openFullscreen(cam);
        });
    });

    CAMERAS.forEach((cam, idx) => {
        const container = document.getElementById(`cam-container-${idx}`);
        if (!container) return;

        // Double-click the video to jump straight to fullscreen.
        container.addEventListener('dblclick', (e) => { e.stopPropagation(); _openFullscreen(cam); });

        container.addEventListener('click', () => {
            container.style.cursor = 'default';

            if (container.dataset.ytId) {
                const embedUrl = buildYouTubeEmbed(container.dataset.ytId);
                container.innerHTML = `
                    <iframe src="${embedUrl}" allowfullscreen
                        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none;"
                        referrerpolicy="no-referrer-when-downgrade"></iframe>
                `;
            } else if (container.dataset.camUrl) {
                container.innerHTML = `
                    <iframe src="${container.dataset.camUrl}" allowfullscreen allow="autoplay; encrypted-media"
                        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none;"></iframe>
                `;
            }
        });
    });
}
