/*
 * toolbelt_drag.js
 * Makes the studio's floating tool belt (#toolbelt) freely draggable so users
 * can move it out of the way of the map / template overlays. Grab the ⠿ handle
 * (or any empty part of the bar) to move it; the position is remembered, and a
 * double-click on the handle snaps it back to the default top-center spot.
 */
(function () {
    const bar = document.getElementById('toolbelt');
    const handle = document.getElementById('tb-drag');
    if (!bar) return;

    const KEY = 'vortexStudioToolbeltPos';
    const parent = () => bar.offsetParent || document.body;

    function place(left, top) {
        bar.style.left = left + 'px';
        bar.style.top = top + 'px';
        bar.style.right = 'auto';
        bar.style.bottom = 'auto';
        bar.style.transform = 'none'; // cancel the default translateX(-50%) centering
    }
    function reset() {
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        bar.style.left = bar.style.top = bar.style.right = bar.style.bottom = bar.style.transform = '';
    }
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    // Restore a saved position after layout settles (so offsetWidth is real).
    requestAnimationFrame(() => {
        try {
            const s = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (s && isFinite(s.left) && isFinite(s.top)) {
                const pr = parent().getBoundingClientRect();
                place(clamp(s.left, 0, pr.width - bar.offsetWidth), clamp(s.top, 0, pr.height - bar.offsetHeight));
            }
        } catch (e) { /* ignore */ }
    });

    // Only start a drag from the handle, the bar background, or a separator —
    // never from a button, slider, colour picker or dropdown.
    function isDragTarget(t) {
        if (t === bar) return true;
        if (handle && (t === handle || handle.contains(t))) return true;
        return !!(t.classList && t.classList.contains('tb-sep'));
    }

    let dragging = false, sx = 0, sy = 0, startLeft = 0, startTop = 0;

    function onDown(e) {
        if (!isDragTarget(e.target)) return;
        const pr = parent().getBoundingClientRect();
        const r = bar.getBoundingClientRect();
        startLeft = r.left - pr.left;
        startTop = r.top - pr.top;
        place(startLeft, startTop); // pin exactly where it is before moving
        sx = e.clientX; sy = e.clientY;
        dragging = true;
        bar.classList.add('dragging');
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        e.preventDefault();
    }
    function onMove(e) {
        if (!dragging) return;
        const pr = parent().getBoundingClientRect();
        const left = clamp(startLeft + (e.clientX - sx), 0, pr.width - bar.offsetWidth);
        const top = clamp(startTop + (e.clientY - sy), 0, pr.height - bar.offsetHeight);
        place(left, top);
    }
    function onUp() {
        dragging = false;
        bar.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        try {
            localStorage.setItem(KEY, JSON.stringify({ left: parseFloat(bar.style.left), top: parseFloat(bar.style.top) }));
        } catch (e) { /* ignore */ }
    }

    bar.addEventListener('pointerdown', onDown);
    if (handle) handle.addEventListener('dblclick', reset);

    // Keep it on-screen if the window is resized.
    window.addEventListener('resize', () => {
        if (!bar.style.left) return;
        const pr = parent().getBoundingClientRect();
        place(
            clamp(parseFloat(bar.style.left) || 0, 0, pr.width - bar.offsetWidth),
            clamp(parseFloat(bar.style.top) || 0, 0, pr.height - bar.offsetHeight)
        );
    });
})();
