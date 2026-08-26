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
// 2. THE RADAR IS THE APP'S OWN DATA. engine/radar.js fetches a pre-rendered
//    NWS mosaic; this uses engine/radar_l2.js → /api/graphics/radar-l2, which
//    decodes super-res NEXRAD Level 2 with the same decoder and the same
//    colormaps as the radar page. Smoothing is the same idea as the radar
//    page's smoothing toggle: gate values are interpolated before they are
//    coloured, so the image is smooth without inventing dBZ levels.
//
// Everything else (title, brand, timestamp, legend, sponsor) is editable text.
import { backgroundLayer, landLayer, BASEMAP_OPTIONS } from '../engine/basemap.js';
import { cityLabelLayer } from '../engine/labels.js';
import { roundRect } from '../engine/scene.js';
import { fetchRadarL2, radarL2Layer } from '../engine/radar_l2.js';
import { loadRadarSites, radarSitesLayer } from '../engine/radar_sites.js';

const FONT = '"Roboto Condensed", "Arial Narrow", system-ui, sans-serif';

// One in-flight radar request, keyed by view+options so panning re-fetches but
// an unrelated rerender (editing a title) does not.
const radarStore = { key: null, status: 'idle', radar: null, error: null };

// Radar station pills (the blue KTLX-style markers from the radar page).
// Loaded once from the app's own site table and reused across rerenders.
const siteStore = { status: 'idle', sites: null };

// Pointer wiring is installed once on the studio canvas and reads whatever the
// live config/ctrl are, so it survives rerenders.
//
// `active` is the important field. While the map is being dragged or zoomed we
// must NOT re-request radar: the fetch key is derived from the view, so a fetch
// fired mid-drag is superseded by the next pointermove and discarded, and the
// radar can never finish loading while you touch the map — while the server is
// asked for a fresh multi-second render dozens of times a second. Instead the
// last raster keeps drawing (warped to the new view) and one fetch runs when
// you stop.
const interaction = {
  installed: false, config: null, ctrl: null, scene: null,
  active: false, rafPending: false, idleTimer: null,
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
  }, 320);
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
  let moved = false;

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
    dragging = true; moved = false;
    last = [ev.clientX, ev.clientY];
    canvas.setPointerCapture(ev.pointerId);
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const cfg = interaction.config, sc = interaction.scene;
    if (!cfg || !sc || !sc.projection) return;
    const dx = ev.clientX - last[0], dy = ev.clientY - last[1];
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    moved = true;
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
        const sub = [cfg.subtitle, store.radar && store.radar.meta ? `${store.radar.meta.site} · ${store.radar.meta.productLabel}` : null]
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
        txt(ctx, 'Loading radar…', W - 26, 86, { size: 15, weight: 700, color: '#e8862b', align: 'right' });
      } else if (store.status === 'refreshing') {
        txt(ctx, 'Updating…', W - 26, 86, { size: 13, weight: 700, color: '#96a2b0', align: 'right' });
      } else if (store.status === 'error') {
        txt(ctx, 'Radar unavailable: ' + (store.error || ''), W - 26, 86, { size: 14, weight: 700, color: '#cc5a4c', align: 'right' });
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

  defaultConfig() {
    return {
      __kind: 'live-radar',
      title: 'LIVE RADAR',
      subtitle: '',
      timeLabel: '',
      // View — a moveable map rather than a region preset.
      centerLat: 35.33,
      centerLon: -97.28,
      zoom: 7.2,
      lockMap: false,
      showHint: true,
      // Radar
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
      product: config.product,
      smooth: !!config.smooth,
      minDbz: parseFloat(config.minDbz) || 0,
      opacity: parseFloat(config.radarOpacity) || 0.9,
      width: parseInt(config.quality, 10) || 1600,
    };
    // Key on the view (rounded, so a 1px drag doesn't refetch) plus the options.
    const key = [
      config.centerLat.toFixed(2), config.centerLon.toFixed(2), config.zoom.toFixed(2),
      opts.product, opts.smooth, opts.minDbz, opts.width,
    ].join('|');

    // Only request radar once the view has settled. Mid-drag the key changes on
    // every frame, so a request fired here would be thrown away by the staleness
    // guard below and the radar would never finish loading.
    if (radarStore.key !== key && !interaction.active) {
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
          ctrl.rerender();
        })
        .catch((e) => {
          if (radarStore.key !== key) return;
          radarStore.radar = null;
          radarStore.status = 'error';
          radarStore.error = e.message;
          ctrl.rerender();
        });
    }

    if (radarStore.radar) {
      radarStore.radar.opacity = opts.opacity;
      // Warp cheaply while the map is moving, at full quality once it settles.
      // The warp is a per-pixel projection inversion, so this is the difference
      // between a smooth drag and a stuttering one.
      scene.add(radarL2Layer(radarStore.radar, {
        quality: interaction.active ? 700 : opts.width,
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
    if (config.sites && config.sites !== 'off') {
      if (siteStore.status === 'idle') {
        siteStore.status = 'loading';
        loadRadarSites().then((list) => {
          siteStore.sites = list;
          siteStore.status = 'ready';
          ctrl.rerender();
        });
      }
      if (siteStore.sites && siteStore.sites.length) {
        scene.add(radarSitesLayer({
          sites: siteStore.sites,
          labels: config.sites === 'labels',
          tdwr: !!config.sitesTdwr,
          fontSize: 15,
          // Mark the site actually supplying the radar on screen.
          highlight: radarStore.radar && radarStore.radar.meta ? radarStore.radar.meta.site : null,
        }));
      }
    }
    scene.add(legendLayer(config));
    scene.add(chromeLayer(config, radarStore));
  },
};
