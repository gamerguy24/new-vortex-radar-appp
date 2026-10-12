/*
 * playback_panel.js
 * Settings › Playback: Max Frames, Speed, Direction, Loop Pause and Track
 * During Playback. The controls only read and write playback_settings; the
 * loops listen to that, so this file knows nothing about either of them.
 */

const playback = require('./playback_settings');
const armMenu = require('../menu/vortexRadarMenu');

function el(id) { return document.getElementById(id); }

function speedLabel(v) { return v + '×'; }

/* Paint every control from the settings, so a change made on the bottom bar
   shows here too. */
function render(s) {
    const frames = el('vxpbFrames');
    if (frames) frames.value = String(s.frames);
    const speed = el('vxpbSpeed');
    if (speed) speed.value = String(Math.max(0, playback.SPEED_STEPS.indexOf(s.speed)));
    const speedVal = el('vxpbSpeedVal');
    if (speedVal) speedVal.textContent = 'Now ' + speedLabel(s.speed) + '.';
    const dir = el('vxpbDirection');
    if (dir) dir.value = s.direction;
    const pause = el('vxpbPause');
    if (pause) pause.value = String(s.loopPause);
    const pauseVal = el('vxpbPauseVal');
    if (pauseVal) pauseVal.textContent = s.loopPause + ' ms';
    const track = el('vxpbTrack');
    if (track) track.checked = s.track;
}

function wire() {
    const frames = el('vxpbFrames');
    if (!frames) return;           // a page without the panel (the Pro shell)

    frames.innerHTML = playback.FRAME_CHOICES
        .map((n) => `<option value="${n}">${n} frames</option>`).join('');
    frames.addEventListener('change', () => playback.set('frames', parseInt(frames.value, 10)));

    const speed = el('vxpbSpeed');
    speed.max = String(playback.SPEED_STEPS.length - 1);
    speed.addEventListener('input', () => {
        playback.set('speed', playback.SPEED_STEPS[parseInt(speed.value, 10)] || 1);
    });

    const dir = el('vxpbDirection');
    dir.addEventListener('change', () => playback.set('direction', dir.value));

    // Shown as it moves; applied as it moves too, since a timer restart is cheap.
    const pause = el('vxpbPause');
    pause.max = String(playback.PAUSE_MAX_MS);
    pause.addEventListener('input', () => playback.set('loopPause', parseInt(pause.value, 10) || 0));

    const track = el('vxpbTrack');
    track.addEventListener('change', () => playback.set('track', track.checked));

    // Each ? opens and closes the explanation directly under its row.
    for (const btn of document.querySelectorAll('#vxPlaybackPanel .vxpb-help')) {
        btn.addEventListener('click', () => {
            const hint = document.querySelector(`#vxPlaybackPanel .vxpb-hint[data-hint="${btn.dataset.hint}"]`);
            if (!hint) return;
            hint.hidden = !hint.hidden;
            btn.setAttribute('aria-expanded', String(!hint.hidden));
        });
    }

    render(playback.get());
    playback.on((key, value, all) => render(all));

    /*
     * The bar's sliders button: open the menu straight on Settings, scrolled
     * to Playback, rather than leave the panel to be found three taps deep.
     */
    const barBtn = el('vortexPlaybackBtn');
    if (barBtn) {
        barBtn.addEventListener('click', () => {
            armMenu.showARMwindow();
            $('.armScreen').hide();
            $('#vortexRadarMenuSettingsScreen').show();
            // After the menu has started opening: while it is still hidden
            // nothing in it has a position to scroll to.
            setTimeout(() => {
                const header = el('armrPlaybackHeader');
                if (!header) return;
                header.scrollIntoView({ block: 'start' });
            }, 60);
        });
    }
}

wire();
