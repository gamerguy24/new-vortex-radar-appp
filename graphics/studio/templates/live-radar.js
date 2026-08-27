// Template: Live Radar (interactive) — a full-frame, MOVEABLE map showing the
// app's own high-resolution radar.
//
// Two things make this different from the other templates:
//
// 1. THE MAP MOVES. Every other template fits its projection to a fixed region
//    preset. Here the projection is built from a centre + zoom kept in config,
//    and the canvas is wired for drag-to-pan and wheel-to-zoom, so you compose
//    the shot directly instead of picking a region from a list.
//
// 2. THE RADAR IS THE APP'S OWN DATA, DECODED HERE. engine/radar.js fetches a
//    pre-rendered NWS mosaic; this uses engine/radar_l2.js, which pulls the
//    volume straight from the AWS bucket the radar page lists and decodes
//    super-res NEXRAD Level 2 IN THIS BROWSER with the app's own libnexrad
//    decoder and colormaps. No server render sits in between, so a graphic and
//    the live radar cannot disagree.
//
//    Because the data is decoded once and held in memory, panning and zooming
//    only re-rasterise — they do not refetch. Smoothing is the same idea as the
//    radar page's smoothing toggle: gate values are interpolated before they
//    are coloured, so the image is smooth without inventing dBZ levels.
//
// Everything else (title, brand, timestamp, legend, sponsor) is editable text.
import { backgroundLayer, landLayer, BASEMAP_OPTIONS } from '../engine/basemap.js';
import { cityLabelLayer } from '../engine/labels.js';
import { roundRect } from '../engine/scene.js';
import { fetchRadarL2, fetchRadarL2Loop, radarL2Layer, warmRasters, isLevel2Site, radarPageView } from '../engine/radar_l2.js?v=cachefix8';
import { loadRadarSites, radarSitesLayer } from '../engine/radar_sites.js?v=cachefix8';

const FONT = '"Roboto Condensed", "Arial Narrow", system-ui, sans-serif';

// KTLX, used only when this browser has never had the radar page open.
const FALLBACK_VIEW = { lat: 35.33, lon: -97.28 };

/**
 * Where the map should open: on the radar the viewer last had up on the radar
 * page. Position is read straight from the record the radar page writes, so
 * this stays synchronous — defaultConfig() cannot await a station lookup.
 */
function openingView() {
  const v = radarPageView();
  if (v && isFinite(v.lat) && isFinite(v.lon)) return { lat: v.lat, lon: v.lon };
  return FALLBACK_VIEW;
}

// One in-flight radar decode, keyed by SITE and PRODUCT — not by the view. A
// decoded volume covers the radar's whole disc, so moving the map re-rasterises
// what is already here rather than fetching anything.
const radarStore = { key: null, status: 'idle', stage: null, radar: null, error: null, retryTimer: null };

// Radar station pills (the blue KTLX-style markers from the radar page).
// Loaded once from the app's own site table and reused across rerenders.
const siteStore = { status: 'idle', sites: null };

// Pointer wiring is installed once on the studio canvas and reads whatever the
// live config/ctrl are, so it survives rerenders.
//
// `active` is the important field. Two things are gated on it. A decode must
// not START mid-drag — it is seconds of work on the main thread and would make
// the map stutter — and the raster is rebuilt at reduced resolution while you
// move, since rasterising is a projection inversion per pixel. Both go back to
// full quality once you stop.
const interaction = {
  installed: false, config: null, ctrl: null, scene: null,
  active: false, rafPending: false, idleTimer: null,
  // Set true once a pointerdown-to-pointerup gesture actually panned the map.
  // The browser still fires a 'click' after a drag release, and if that
  // release happens to land on a station marker it would otherwise select a
  // radar the operator was just panning past, not clicking on.
  moved: false,
};

// Coalesce redraws to one per animation frame. Without this a drag issues a
// full rebuild + re-warp per pointermove event, which is the whole of the lag.
function requestRedraw() {
  if (interaction.rafPending || !interaction.ctrl) return;
  interaction.rafPending = true;
  requestAnimationFrame(() => {
    interaction.rafPending = false;
    if (interaction.ctrl) interaction.ctrl.rerender();
  });
}

// Mark the map as being interacted with, and schedule the "settled" redraw that
// actually refreshes the radar for the new view.
function markActive() {
  interaction.active = true;
  clearTimeout(interaction.idleTimer);
  interaction.idleTimer = setTimeout(() => {
    interaction.active = false;
    if (interaction.ctrl) interaction.ctrl.rerender();   // full quality + refetch
    // A raster belongs to the projection it was drawn under, so the move just
    // invalidated every loop frame. Rebuild them now, off the animation path,
    // rather than letting the loop rebuild them one hitch at a time.
    if (playback.playing) warmFrames();
  }, 320);
}

// Keep the displayed volume from going stale. Panning/zooming only
// re-rasterises whatever is already decoded (see radarStore's key comment
// above) — nothing else ever re-checks for a newer scan, so a viewer who
// never touches the map would otherwise keep looking at an ever-older volume
// forever. NEXRAD volumes complete roughly every 4-6 minutes; checking every
// 90s catches a new one promptly without hammering the bucket. Skipped
// mid-interaction, same as every other refresh here.
const REFRESH_INTERVAL_MS = 90 * 1000;
setInterval(() => {
  // Skip while a loop is playing — Play already keeps the picture moving,
  // and nulling the key here would yank the display back to a single fetch
  // mid-loop.
  if (interaction.active || !interaction.ctrl || playback.playing) return;
  radarStore.key = null;   // next build() sees this as a changed key and refetches
  interaction.ctrl.rerender();
}, REFRESH_INTERVAL_MS);

/* ── loop playback (Play) ─────────────────────────────────────────────────
 * Cycles the display through the last several volumes for whichever site is
 * on screen, so an operator can see storm motion without leaving the
 * Studio. Frames are decoded once and held here directly — not through
 * radar_l2_raster's small LRU volume cache — so replaying the loop after
 * the first pass is free: no re-download, no re-decode, and each frame's
 * own raster cache (see radar_l2.js) means even the pixels are only ever
 * rasterised once per view.
 */
const LOOP_FRAME_MS = 750;
const playback = { playing: false, frames: [], idx: 0, key: null, timer: null, warmCancel: null };

function stopPlayback() {
  playback.playing = false;
  clearInterval(playback.timer);
  playback.timer = null;
  // Stop any warm-up still running, so it is not competing for the main
  // thread after the operator has already pressed stop.
  if (playback.warmCancel) { playback.warmCancel(); playback.warmCancel = null; }
}

export function isPlaying() { return playback.playing; }
export { stopPlayback };

export async function togglePlayback() {
  if (playback.playing) {
    stopPlayback();
    if (interaction.ctrl) interaction.ctrl.rerender();
    return;
  }
  if (!radarStore.radar) return;   // nothing on screen yet to loop

  // radarStore.key already encodes site + product + palette (see build()) —
  // reuse it so a loop is invalidated the same moment a single fetch would be.
  if (playback.key !== radarStore.key) { playback.frames = []; playback.idx = 0; playback.key = radarStore.key; }

  playback.playing = true;
  if (interaction.ctrl) interaction.ctrl.rerender();   // flip the button at once

  if (!playback.frames.length) {
    const base = radarStore.radar;
    try {
      playback.frames = await fetchRadarL2Loop(interaction.scene, {
        site: base.meta.site,
        product: base.product,
        palette: base.palette,
        opacity: base.opacity,
        onProgress: (stage) => {
          radarStore.stage = stage;
          if (interaction.ctrl) interaction.ctrl.rerender();
        },
      });
    } catch (e) {
      playback.playing = false;
      radarStore.status = 'error';
      radarStore.stage = null;
      radarStore.error = e.message;
      if (interaction.ctrl) interaction.ctrl.rerender();
      return;
    }
    playback.idx = Math.max(0, playback.frames.length - 1);   // start on newest
  }

  if (playback.frames.length < 2) {
    // Nothing to animate (e.g. the archive-URL fallback only ever has one
    // frame) — leave the single scan on screen rather than "play" a loop of one.
    playback.playing = false;
    if (interaction.ctrl) interaction.ctrl.rerender();
    return;
  }

  radarStore.status = 'ready';
  radarStore.radar = playback.frames[playback.idx];

  // Build every frame's raster BEFORE animating. Without this the first pass
  // round the loop hitches on each frame, because a frame is only rasterised
  // by the tick that first displays it.
  warmFrames(() => {
    radarStore.stage = null;
    if (interaction.ctrl) interaction.ctrl.rerender();
  });

  playback.timer = setInterval(() => {
    if (interaction.active) return;   // don't fight a drag
    playback.idx = (playback.idx + 1) % playback.frames.length;
    radarStore.radar = playback.frames[playback.idx];
    if (interaction.ctrl) interaction.ctrl.rerender();
  }, LOOP_FRAME_MS);
}

/**
 * Pre-rasterise the loop's frames for the CURRENT view, one per animation
 * frame so the page stays responsive.
 *
 * Called when a loop starts and again whenever the map settles somewhere new:
 * a raster is tied to the projection it was drawn under, so panning or zooming
 * invalidates all of them at once and the loop would otherwise spend its next
 * pass rebuilding them one hitch at a time.
 */
function warmFrames(onDone) {
  if (playback.warmCancel) { playback.warmCancel(); playback.warmCancel = null; }
  if (!playback.frames.length || !interaction.scene) return;

  const cfg = interaction.config;
  if (!cfg) return;
  const opts = {
    quality: parseInt(cfg.quality, 10) || 1600,
    smooth: !!cfg.smooth,
    minDbz: parseFloat(cfg.minDbz) || 0,
  };

  playback.warmCancel = warmRasters(playback.frames, interaction.scene, opts, (done, total) => {
    if (done < total) {
      radarStore.stage = `preparing loop ${done}/${total}`;
      if (interaction.ctrl) interaction.ctrl.rerender();
    } else {
      playback.warmCancel = null;
      if (onDone) onDone();
    }
  });
}

/* ── zoom maths ────────────────────────────────────────────────────────────
 * Web-mercator style: zoom z means the whole world is 256·2^z px wide, which is
 * what d3.geoMercator's `scale` expresses as (256·2^z)/2π.
 */
function scaleForZoom(z) { return (256 * Math.pow(2, z)) / (2 * Math.PI); }

function clampView(cfg) {
  cfg.zoom = Math.max(4, Math.min(12, cfg.zoom));
  cfg.centerLat = Math.max(-84, Math.min(84, cfg.centerLat));
  cfg.centerLon = ((cfg.centerLon + 540) % 360) - 180;
}

/* ── canvas interaction ───────────────────────────────────────────────────── */
function installInteraction() {
  if (interaction.installed) return;
  const canvas = document.getElementById('stage-canvas');
  if (!canvas) return;                       // studio not mounted yet
  interaction.installed = true;

  let dragging = false;
  let last = null;

  // Canvas CSS pixels → scene pixels (the canvas is displayed scaled to fit).
  const toScene = (ev) => {
    const r = canvas.getBoundingClientRect();
    const sc = interaction.scene;
    if (!sc || !r.width) return null;
    return [
      (ev.clientX - r.left) * (sc.width / r.width),
      (ev.clientY - r.top) * (sc.height / r.height),
    ];
  };

  canvas.addEventListener('pointerdown', (ev) => {
    const cfg = interaction.config;
    // Only when this template is active and the map is unlocked, so the studio's
    // paint/overlay-drag tools keep working everywhere else.
    if (!cfg || cfg.__kind !== 'live-radar' || cfg.lockMap) return;
    dragging = true; interaction.moved = false;
    last = [ev.clientX, ev.clientY];
    canvas.setPointerCapture(ev.pointerId);
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const cfg = interaction.config, sc = interaction.scene;
    if (!cfg || !sc || !sc.projection) return;
    const dx = ev.clientX - last[0], dy = ev.clientY - last[1];
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    interaction.moved = true;
    last = [ev.clientX, ev.clientY];

    const r = canvas.getBoundingClientRect();
    const sx = sc.width / (r.width || 1), sy = sc.height / (r.height || 1);

    // Pan by re-projecting the scene centre offset by the drag. Doing it
    // through invert() keeps the drag anchored to the ground at any latitude,
    // where a naive degrees-per-pixel shift would slip as you move north.
    const p = sc.projection;
    const c = p([cfg.centerLon, cfg.centerLat]);
    if (!c) return;
    const moved2 = p.invert([c[0] - dx * sx, c[1] - dy * sy]);
    if (!moved2) return;
    cfg.centerLon = moved2[0];
    cfg.centerLat = moved2[1];
    clampView(cfg);
    markActive();
    requestRedraw();
  });

  const endDrag = (ev) => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* already released */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (ev) => {
    const cfg = interaction.config, sc = interaction.scene;
    if (!cfg || cfg.__kind !== 'live-radar' || cfg.lockMap) return;
    if (!sc || !sc.projection) return;
    ev.preventDefault();

    const pt = toScene(ev);
    const p = sc.projection;
    const before = pt ? p.invert(pt) : null;

    cfg.zoom += (ev.deltaY < 0 ? 0.35 : -0.35);
    clampView(cfg);

    // Zoom toward the cursor: rebuild at the new scale, then shift the centre so
    // the geographic point under the pointer stays under the pointer.
    if (before && pt) {
      const test = d3.geoMercator()
        .center([cfg.centerLon, cfg.centerLat])
        .scale(scaleForZoom(cfg.zoom))
        .translate([sc.width / 2, sc.height / 2]);
      const after = test.invert(pt);
      if (after) {
        cfg.centerLon += (before[0] - after[0]);
        cfg.centerLat += (before[1] - after[1]);
        clampView(cfg);
      }
    }
    markActive();
    requestRedraw();
  }, { passive: false });
}

/* ── control options ───────────────────────────────────────────────────────── */

// The site dropdown is built from the station table once it has loaded.
// Sorted by id so it is scannable. No "Auto" entry: the config starts on
// 'auto' internally just long enough to bootstrap a first site (see build()),
// which then pins config.radarSite to whatever it resolved — from then on,
// and from a click on a station marker (see engine/radar_sites.js's onSelect),
// the site is always an explicit pick. Panning the map used to silently swap
// sites when the view crossed into another radar's range; it no longer does.
function siteOptions() {
  const opts = [];
  if (siteStore.sites && siteStore.sites.length) {
    // WSR-88D only. The station table also holds TDWR and profiler sites, and
    // neither publishes a Level 2 volume — offering them would just hand the
    // operator a choice that always fails.
    const usable = siteStore.sites.filter(isLevel2Site);
    for (const st of usable.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      opts.push({ value: st.id, label: st.name ? st.id + ' — ' + st.name : st.id });
    }
  }
  return opts;
}

// Built-in colortables, mirroring the radar page's Colortables menu. "Auto"
// follows whatever the viewer picked there (read from localStorage by
// engine/radar_l2.js), so a graphic matches their radar without being told.
function paletteOptions() {
  return [
    { value: 'auto', label: 'Auto — match my radar page' },
    { value: 'REF', label: 'Reflectivity — Default' },
    { value: 'REF1', label: 'Reflectivity — 1' },
    { value: 'REF2', label: 'Reflectivity — 2' },
    { value: 'REF3', label: 'Reflectivity — 3' },
    { value: 'REF4', label: 'Reflectivity — 4' },
    { value: 'REF5', label: 'Reflectivity — 5' },
    { value: 'VEL', label: 'Velocity — Default' },
    { value: 'VEL1', label: 'Velocity — 1' },
    { value: 'VEL2', label: 'Velocity — 2' },
  ];
}

/* ── drawing helpers ──────────────────────────────────────────────────────── */
function txt(ctx, str, x, y, o = {}) {
  const { size = 30, weight = 800, color = '#fff', align = 'left', baseline = 'alphabetic', shadow = false, track = 0 } = o;
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = baseline; ctx.fillStyle = color;
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; }
  if (track) {
    // Manual letter-spacing (canvas has no letterSpacing in every engine).
    let cx = x;
    if (align === 'center') cx = x - (ctx.measureText(str).width + track * (str.length - 1)) / 2;
    for (const ch of str) { ctx.textAlign = 'left'; ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
  } else {
    ctx.fillText(str, x, y);
  }
  ctx.restore();
}

// dBZ legend matching the app's reflectivity palette.
const DBZ_STOPS = [
  [15, 'rgb(193,193,193)'], [25, 'rgb(128,252,131)'], [35, 'rgb(1,63,0)'],
  [40, 'rgb(251,249,10)'], [45, 'rgb(247,128,1)'], [50, 'rgb(249,6,0)'],
  [60, 'rgb(128,0,4)'], [70, 'rgb(248,8,245)'],
];

function legendLayer(cfg) {
  return {
    name: 'radar-legend',
    draw(ctx, scene) {
      if (!cfg.showLegend) return;
      const w = 420, h = 54;
      const x = 40, y = scene.height - h - 40;
      ctx.save();
      ctx.fillStyle = 'rgba(8,10,14,0.78)';
      roundRect(ctx, x, y, w, h, 8); ctx.fill();

      const bx = x + 14, by = y + 14, bw = w - 28, bh = 14;
      const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      const lo = DBZ_STOPS[0][0], hi = DBZ_STOPS[DBZ_STOPS.length - 1][0];
      for (const [v, c] of DBZ_STOPS) grad.addColorStop((v - lo) / (hi - lo), c);
      ctx.fillStyle = grad;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

      for (const [v] of DBZ_STOPS) {
        const px = bx + ((v - lo) / (hi - lo)) * bw;
        txt(ctx, String(v), px, by + bh + 16, { size: 13, weight: 700, color: '#dfe5ec', align: 'center' });
      }
      txt(ctx, 'dBZ', x + w - 16, y + 12, { size: 12, weight: 800, color: '#96a2b0', align: 'right', baseline: 'top' });
      ctx.restore();
    },
  };
}

// Header slab + brand + live status.
function chromeLayer(cfg, store) {
  return {
    name: 'radar-chrome',
    draw(ctx, scene) {
      const W = scene.width;

      if (cfg.showHeader) {
        const h = 116;
        ctx.save();
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(6,8,12,0.94)');
        g.addColorStop(1, 'rgba(6,8,12,0.55)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, h);

        // brand flag
        const bw = 210;
        ctx.fillStyle = cfg.brandColor || '#e8862b';
        ctx.fillRect(0, 0, bw, h);
        txt(ctx, cfg.brandTop || '', 20, 34, { size: 17, weight: 700, color: 'rgba(0,0,0,0.72)' });
        txt(ctx, cfg.brandBig || '', 20, 74, { size: 40, weight: 900, color: '#0d0f12' });
        txt(ctx, cfg.brandBottom || '', 20, 100, { size: 15, weight: 700, color: 'rgba(0,0,0,0.72)' });

        txt(ctx, cfg.title || '', bw + 26, 56, { size: 40, weight: 900, color: '#fff', shadow: true });
        // Caption names the radar, product AND which feed served it, so a
        // fallback to a non-app source is visible rather than silent.
        const meta = store.radar && store.radar.meta;
        // State the resolution rather than implying it: "Super-Res" here means
        // 0.25 km gates on a 0.5 degree azimuth grid, measured off the sweep
        // that was actually drawn.
        const feed = meta && meta.source
          ? ((meta.superRes ? 'Super-Res ' : '') + 'AWS Level 2')
          : null;
        const sub = [cfg.subtitle, meta ? `${meta.site} · ${meta.productLabel}` : null, feed]
          .filter(Boolean).join('   ·   ');
        txt(ctx, sub, bw + 28, 92, { size: 18, weight: 700, color: '#b9c4d1' });
        ctx.restore();
      }

      // Scan time / status, top-right.
      let stamp = cfg.timeLabel || '';
      if (!stamp && store.radar && store.radar.meta && store.radar.meta.scanTime) {
        try {
          stamp = new Date(store.radar.meta.scanTime)
            .toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' local';
        } catch (e) { stamp = ''; }
      }
      if (stamp) txt(ctx, stamp, W - 26, 56, { size: 20, weight: 800, color: '#fff', align: 'right', shadow: true });

      if (store.status === 'loading') {
        // Name the stage. Fetching the volume and decoding it are seconds apart,
        // and a bare "Loading…" for that long reads as a hang.
        const stage = store.stage ? `Loading radar — ${store.stage}…` : 'Loading radar…';
        txt(ctx, stage, W - 26, 86, { size: 15, weight: 700, color: '#e8862b', align: 'right' });
      } else if (store.status === 'refreshing') {
        txt(ctx, 'Updating…', W - 26, 86, { size: 13, weight: 700, color: '#96a2b0', align: 'right' });
      } else if (playback.playing && playback.frames.length > 1) {
        txt(ctx, `Looping — frame ${playback.idx + 1}/${playback.frames.length}`, W - 26, 86, { size: 13, weight: 700, color: '#4c8dff', align: 'right' });
      } else if (store.status === 'error') {
        // Wrap so a real explanation is readable instead of running off the frame.
        const words = String('Radar unavailable — ' + (store.error || '')).split(' ');
        const lines = [];
        let line = '';
        ctx.save();
        ctx.font = '700 14px ' + FONT;
        for (const w of words) {
          const test = line ? line + ' ' + w : w;
          if (ctx.measureText(test).width > Math.min(560, W * 0.45) && line) { lines.push(line); line = w; }
          else line = test;
        }
        if (line) lines.push(line);
        ctx.restore();
        lines.slice(0, 3).forEach((ln, i) => {
          txt(ctx, ln, W - 26, 86 + i * 18, { size: 14, weight: 700, color: '#cc5a4c', align: 'right' });
        });
      }

      // Hint that the map is draggable — never exported, only shown while the
      // map is unlocked so it cannot end up in a finished graphic by accident.
      if (!cfg.lockMap && cfg.showHint) {
        const msg = 'Drag to pan · scroll to zoom · lock the map when framed';
        ctx.save();
        ctx.font = `700 14px ${FONT}`;
        const w = ctx.measureText(msg).width + 24;
        ctx.fillStyle = 'rgba(8,10,14,0.72)';
        roundRect(ctx, scene.width - w - 26, scene.height - 40, w, 26, 6); ctx.fill();
        txt(ctx, msg, scene.width - 26 - 12, scene.height - 22, { size: 14, weight: 700, color: '#b9c4d1', align: 'right' });
        ctx.restore();
      }
    },
  };
}

export default {
  id: 'live-radar',
  label: 'Live Radar (interactive)',
  scale: null,

  // This template draws its own radar from the app's Level 2 data, so the
  // studio must NOT also insert its shared NWS-mosaic layer — two radar
  // sources composited together disagree on resolution and colour table.
  providesRadar: true,

  defaultConfig() {
    const opened = openingView();
    return {
      __kind: 'live-radar',
      title: 'LIVE RADAR',
      subtitle: '',
      timeLabel: '',
      // View — a moveable map rather than a region preset. It opens framed on
      // whatever radar the viewer last had up on the radar page, so the studio
      // starts on the storm they came here to make a graphic of. Falls back to
      // KTLX when there is nothing recorded (a fresh browser).
      centerLat: opened.lat,
      centerLon: opened.lon,
      zoom: 7.2,
      lockMap: false,
      // Off by default: it is a hint for a map you already know is draggable,
      // and it sits over the frame you are trying to compose.
      showHint: false,
      // Radar
      radarSite: 'auto',
      palette: 'auto',
      product: 'reflectivity',
      smooth: true,
      minDbz: '15',
      radarOpacity: '0.9',
      quality: '1200',
      // Map
      basemap: BASEMAP_OPTIONS && BASEMAP_OPTIONS[0] ? BASEMAP_OPTIONS[0].value : 'dark',
      showCities: true,
      counties: 'bold',
      sites: 'labels',
      sitesTdwr: false,
      // Chrome
      showHeader: true,
      showLegend: true,
      brandTop: 'VORTEX',
      brandBig: 'RADAR',
      brandBottom: 'LIVE',
      brandColor: '#e8862b',
    };
  },

  fields() {
    return [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      { key: 'timeLabel', label: 'Time label (blank = scan time)', type: 'text' },

      { key: 'lockMap', label: 'Lock map (stop pan/zoom)', type: 'toggle' },
      { key: 'showHint', label: 'Show pan/zoom hint', type: 'toggle' },
      { key: 'zoom', label: 'Zoom (4–12)', type: 'text' },
      { key: 'centerLat', label: 'Center latitude', type: 'text' },
      { key: 'centerLon', label: 'Center longitude', type: 'text' },

      { key: 'radarSite', label: 'Radar site', type: 'select', options: siteOptions() },
      { key: 'palette', label: 'Colortable', type: 'select', options: paletteOptions() },
      { key: 'product', label: 'Radar product', type: 'select', options: [
        { value: 'reflectivity', label: 'Base Reflectivity' },
        { value: 'velocity', label: 'Base Velocity' }] },
      { key: 'smooth', label: 'Smoothing', type: 'toggle' },
      { key: 'minDbz', label: 'Hide returns below (dBZ)', type: 'select', options: [
        { value: '0', label: 'Show everything (radar-page look)' },
        { value: '10', label: '10 dBZ' }, { value: '15', label: '15 dBZ' },
        { value: '20', label: '20 dBZ' }, { value: '25', label: '25 dBZ' }] },
      { key: 'radarOpacity', label: 'Radar opacity', type: 'select', options: [
        { value: '1', label: '100%' }, { value: '0.9', label: '90%' },
        { value: '0.75', label: '75%' }, { value: '0.6', label: '60%' }] },
      { key: 'quality', label: 'Render quality', type: 'select', options: [
        { value: '1100', label: 'Fast' }, { value: '1600', label: 'High' }, { value: '2200', label: 'Maximum' }] },

      { key: 'basemap', label: 'Basemap', type: 'select', options: BASEMAP_OPTIONS },
      { key: 'counties', label: 'County lines', type: 'select', options: [
        { value: 'off', label: 'Off' }, { value: 'subtle', label: 'Subtle' },
        { value: 'normal', label: 'Normal' }, { value: 'bold', label: 'Bold' }] },
      { key: 'showCities', label: 'City labels', type: 'toggle' },
      { key: 'sites', label: 'Radar sites', type: 'select', options: [
        { value: 'off', label: 'Off' },
        { value: 'labels', label: 'Station labels (KTLX)' },
        { value: 'dots', label: 'Dots only' }] },
      { key: 'sitesTdwr', label: 'Include TDWR sites', type: 'toggle' },

      { key: 'showHeader', label: 'Show header', type: 'toggle' },
      { key: 'showLegend', label: 'Show dBZ legend', type: 'toggle' },
      { key: 'brandTop', label: 'Brand — top line', type: 'text' },
      { key: 'brandBig', label: 'Brand — big line', type: 'text' },
      { key: 'brandBottom', label: 'Brand — bottom line', type: 'text' },
      { key: 'brandColor', label: 'Brand color', type: 'color' },
    ];
  },

  build(scene, geo, config, ctrl) {
    // Numbers arrive as strings from text fields; normalise before use.
    config.centerLat = parseFloat(config.centerLat);
    config.centerLon = parseFloat(config.centerLon);
    config.zoom = parseFloat(config.zoom);
    if (!isFinite(config.centerLat)) config.centerLat = 35.33;
    if (!isFinite(config.centerLon)) config.centerLon = -97.28;
    if (!isFinite(config.zoom)) config.zoom = 7.2;
    clampView(config);

    // Wire pan/zoom to the live config + controller.
    interaction.config = config;
    interaction.ctrl = ctrl;
    interaction.scene = scene;
    installInteraction();

    // A centre+zoom mercator rather than a region fitted to features — this is
    // what makes the map moveable.
    scene.projection = d3.geoMercator()
      .center([config.centerLon, config.centerLat])
      .scale(scaleForZoom(config.zoom))
      .translate([scene.width / 2, scene.height / 2]);

    scene.clearLayers();
    scene.add(backgroundLayer(config.basemap));
    // Counties are drawn here, UNDER the radar, and their weight is explicit
    // rather than inherited from the basemap style — the basemap decides county
    // colour per style, which is fine for a static map but leaves you no way to
    // make them readable once a radar layer is sitting on top of them.
    const COUNTY_WEIGHTS = {
      off: { countyW: 0 },
      subtle: { county: 'rgba(255,255,255,0.45)', countyW: 0.9, countyHalo: 'rgba(0,0,0,0.45)', countyHaloW: 2.0 },
      normal: { county: 'rgba(255,255,255,0.8)', countyW: 1.3, countyHalo: 'rgba(0,0,0,0.55)', countyHaloW: 2.8 },
      bold: { county: 'rgba(255,255,255,0.95)', countyW: 1.9, countyHalo: 'rgba(0,0,0,0.7)', countyHaloW: 4.0 },
    };
    const countyStyle = COUNTY_WEIGHTS[config.counties] || COUNTY_WEIGHTS.normal;

    scene.add(landLayer({
      styleName: config.basemap,
      landFeatures: geo.states,
      countyMesh: config.counties === 'off' ? null : geo.countyBorders,
      borderMesh: geo.stateBorders,
      override: countyStyle,
    }));

    /* ── radar ── */
    const opts = {
      site: config.radarSite && config.radarSite !== 'auto' ? config.radarSite : null,
      palette: config.palette && config.palette !== 'auto' ? config.palette : null,
      product: config.product,
      smooth: !!config.smooth,
      minDbz: parseFloat(config.minDbz) || 0,
      opacity: parseFloat(config.radarOpacity) || 0.9,
      width: parseInt(config.quality, 10) || 1600,
      // Progress text, so a first decode reads as work in progress rather than
      // a frozen panel: the download and decode take a few seconds.
      onProgress: (stage) => {
        if (radarStore.key !== null) { radarStore.stage = stage; ctrl.rerender(); }
      },
    };
    // Key on WHAT IS DECODED, not on the camera.
    //
    // A decoded volume covers the radar's whole ~230 km disc, so panning and
    // zooming inside it need no new data — they only re-rasterise what is
    // already in memory. Smoothing, dBZ floor and quality are render settings
    // and are applied by the layer, so they are not here either. Only the site
    // and the product change which bytes have to be fetched.
    //
    // On the 'auto' setting the site is resolved from the view centre inside
    // fetchRadarL2, so the key carries the view centre at low precision: enough
    // that crossing into another radar's territory re-resolves, coarse enough
    // that ordinary panning does not.
    const key = [
      opts.product,
      opts.site || `auto@${config.centerLat.toFixed(0)},${config.centerLon.toFixed(0)}`,
      opts.palette || 'auto',
    ].join('|');

    // Don't start a decode mid-drag; it would compete with the redraw for the
    // main thread and make the map stutter.
    if (radarStore.key !== key && !interaction.active) {
      // Site/product/palette changed — a running loop belongs to the old
      // selection and would otherwise keep animating it underneath the new one.
      if (playback.playing) stopPlayback();
      playback.frames = []; playback.idx = 0; playback.key = null;
      radarStore.key = key;
      // Keep the previous raster on screen while the new one loads — warped to
      // the current view it is still broadly right, and blanking the map every
      // time you nudge it is worse than a few seconds of slightly stale echo.
      radarStore.status = radarStore.radar ? 'refreshing' : 'loading';
      radarStore.error = null;
      fetchRadarL2(scene, opts)
        .then((r) => {
          if (radarStore.key !== key) return;      // view moved on; drop stale result
          radarStore.radar = r;
          radarStore.status = 'ready';
          radarStore.stage = null;
          // Pin an 'auto' pick to whatever it actually resolved to, so panning
          // from here on re-rasterises this site rather than silently hopping
          // to whichever radar is nearest the new view centre. Also update the
          // stored key to what build() would now compute for that concrete
          // site — otherwise the very next rerender sees a "changed" key
          // (auto@lat,lon vs. the real id) and redundantly refetches what it
          // just fetched.
          if (config.radarSite === 'auto' && r.meta && r.meta.site) {
            config.radarSite = r.meta.site;
            radarStore.key = [opts.product, r.meta.site, opts.palette || 'auto'].join('|');
            if (ctrl.rebuildProps) ctrl.rebuildProps();
          }
          ctrl.rerender();
        })
        .catch((e) => {
          if (radarStore.key !== key) return;
          radarStore.status = 'error';
          radarStore.stage = null;
          radarStore.error = e.message;
          // Keep whatever raster we already had rather than blanking the map.
          // Then clear the key so the next rerender retries: a decode can fail
          // for transient reasons (the volume was still being uploaded to the
          // bucket, the network dropped), and without this the failure sticks
          // until the view moves.
          if (!radarStore.retryTimer) {
            radarStore.retryTimer = setTimeout(() => {
              radarStore.retryTimer = null;
              radarStore.key = null;
              if (interaction.ctrl) interaction.ctrl.rerender();
            }, 15000);
          }
          ctrl.rerender();
        });
    }

    if (radarStore.radar) {
      radarStore.radar.opacity = opts.opacity;
      // Warp cheaply while the map is moving, at full quality once it settles.
      // The warp is a per-pixel projection inversion, so this is the difference
      // between a smooth drag and a stuttering one.
      scene.add(radarL2Layer(radarStore.radar, {
        quality: opts.width,
        smooth: opts.smooth,
        minDbz: opts.minDbz,
        fastPreview: interaction.active,
      }));

      // Re-stroke ONLY the state outlines over the radar.
      //
      // This used to re-stroke the counties too, on top of the pass underneath.
      // Drawing the same white county mesh twice doubled its weight and its
      // halo, so counties and state borders ended up identical heavy white
      // lines and the map read as an unreadable mesh. Counties belong under the
      // radar; states go over it so the frame stays legible.
      scene.add(landLayer({
        styleName: config.basemap,
        landFeatures: geo.states,
        countyMesh: null,
        borderMesh: geo.stateBorders,
        override: { land: 'rgba(0,0,0,0)', relief: false, countyW: 0 },
      }));
    }

    if (config.showCities) scene.add(cityLabelLayer({ maxRank: 3, fontSize: 18 }));

    /* ── radar station pills ──
     * The same markers the radar page shows, drawn over the map so a graphic
     * can identify which sites are in frame. Loaded once, then cached. */
    // The station table also feeds the "Radar site" dropdown, so load it even
    // when the markers themselves are switched off.
    if (siteStore.status === 'idle') {
      siteStore.status = 'loading';
      loadRadarSites().then((list) => {
        siteStore.sites = list;
        siteStore.status = 'ready';
        // Rebuild the panel, not just the canvas: the "Radar site" dropdown is
        // built from this list, and fields() already ran before it arrived.
        if (ctrl.rebuildProps) ctrl.rebuildProps();
        ctrl.rerender();
      });
    }

    if (config.sites && config.sites !== 'off') {
      if (siteStore.sites && siteStore.sites.length) {
        scene.add(radarSitesLayer({
          sites: siteStore.sites,
          labels: config.sites === 'labels',
          tdwr: !!config.sitesTdwr,
          fontSize: 15,
          // Mark the site actually supplying the radar on screen.
          highlight: radarStore.radar && radarStore.radar.meta ? radarStore.radar.meta.site : null,
          // Click a station to use it, in place of the old auto-pick-by-camera
          // behaviour. Skip a click that's really the release end of a pan —
          // see interaction.moved's comment.
          onSelect: (site) => {
            if (interaction.moved || !isLevel2Site(site) || config.radarSite === site.id) return;
            config.radarSite = site.id;
            if (ctrl.rebuildProps) ctrl.rebuildProps();
            ctrl.rerender();
          },
        }));
      }
    }
    scene.add(legendLayer(config));
    scene.add(chromeLayer(config, radarStore));
  },
};
