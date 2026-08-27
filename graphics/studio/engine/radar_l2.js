/*
 * graphics/studio/engine/radar_l2.js
 * Scene-facing wrapper around the browser Level 2 decoder.
 *
 * engine/radar.js pulls a pre-rendered mosaic PNG from the NWS ImageServer.
 * This one decodes super-res NEXRAD Level 2 IN THIS BROWSER with the app's own
 * libnexrad decoder and the app's own colormaps — the same code path the radar
 * page runs — so a graphic and the live radar agree gate for gate.
 *
 * Two things follow from decoding client-side, and both are the point:
 *
 *   • ONE download per volume. Panning and zooming only re-rasterise what is
 *     already in memory, so the map moves at once instead of waiting on a round
 *     trip. The previous server-render design re-decoded on every view change,
 *     which is where the ~30 second waits and the HTTP 502s came from.
 *
 *   • The viewer's own colortable works. Uploaded tables live in this browser's
 *     localStorage and no server can see them.
 *
 * See engine/radar_l2_raster.js for the decode, the AWS listing and the
 * rasteriser itself.
 */

import { loadSweep, loadSweepFromUrl, listLatestVolume, listRecentVolumes, prefetchVolume, rasterize, chosenPalette, awsLatestVolumeUrl, PRODUCTS } from './radar_l2_raster.js?v=cachefix10';
import { loadRadarSites } from './radar_sites.js?v=cachefix10';

const CONUS = { W: -125, S: 24, E: -66.5, N: 50 };

/**
 * Does this station publish Level 2? The site table also carries TDWR and
 * profiler entries, which do not — note that eligibility is NOT about the id:
 * PAKC and TJUA are WSR-88D despite not starting with K.
 */
export function isLevel2Site(s) {
  return !!s && String(s.type || '') === 'WSR-88D';
}

// Geographic bbox covering the current view, sampled from the projection.
// Still exported: callers use it to decide what is on screen.
export function viewBbox(scene, padFrac = 0.04) {
  const p = scene.projection;
  if (!p || !p.invert) return [CONUS.W, CONUS.S, CONUS.E, CONUS.N];
  let W = Infinity, S = Infinity, E = -Infinity, N = -Infinity;
  const nx = 24, ny = 16;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const ll = p.invert([scene.width * i / nx, scene.height * j / ny]);
      if (!ll) continue;
      const [lon, lat] = ll;
      if (!isFinite(lon) || !isFinite(lat)) continue;
      if (lon < W) W = lon; if (lon > E) E = lon;
      if (lat < S) S = lat; if (lat > N) N = lat;
    }
  }
  if (!(isFinite(W) && isFinite(S) && E > W && N > S)) return [CONUS.W, CONUS.S, CONUS.E, CONUS.N];
  const px = (E - W) * padFrac, py = (N - S) * padFrac;
  return [
    Math.max(-179, W - px), Math.max(-85, S - py),
    Math.min(179, E + px), Math.min(85, N + py),
  ];
}

/** Centre of the current view, in degrees. */
function viewCenter(scene) {
  const p = scene.projection;
  if (p && p.invert) {
    const ll = p.invert([scene.width / 2, scene.height / 2]);
    if (ll && isFinite(ll[0]) && isFinite(ll[1])) return { lat: ll[1], lon: ll[0] };
  }
  const b = viewBbox(scene);
  return { lat: (b[1] + b[3]) / 2, lon: (b[0] + b[2]) / 2 };
}

/**
 * WSR-88D nearest the view centre, for the "auto" site setting.
 *
 * Only WSR-88D is eligible: the site table also holds TDWR and profiler
 * stations, and neither publishes a Level 2 volume, so picking one would
 * guarantee a "no volume listed" failure.
 */
// Rough great-circle distance in km. Good enough for ranking stations.
function kmBetween(aLat, aLon, bLat, bLon) {
  const dy = (bLat - aLat) * 111.32;
  const dx = (bLon - aLon) * 111.32 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  return Math.sqrt(dy * dy + dx * dx);
}

/** WSR-88D stations, nearest to the view centre first. */
async function sitesByDistance(scene) {
  let sites;
  try { sites = await loadRadarSites(); } catch (e) { sites = null; }
  if (!sites || !sites.length) return [];

  const { lat, lon } = viewCenter(scene);
  return sites
    .filter((s) => s && isFinite(s.lat) && isFinite(s.lon) && isLevel2Site(s))
    .map((s) => ({ ...s, km: kmBetween(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.km - b.km);
}

/**
 * The radar the viewer last had open on the radar page, if it is relevant here.
 *
 * The point of the studio is to make a graphic of the storm you were just
 * looking at, so when the view is inside that radar's coverage it is the right
 * default — not whichever station happens to sit closest to the centre of the
 * frame. Outside its range it is ignored, because a graphic of empty sky is
 * worse than picking a different radar.
 *
 * The radar page records this in localStorage when it plots a Level 2 volume
 * (see plot() in app/radar/libnexrad/level2/level2_factory.js).
 */
const CURRENT_SITE_KEY = 'vortexCurrentRadarSite';
const CURRENT_SITE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const L2_RANGE_KM = 230;

export function radarPageView() {
  try {
    const raw = JSON.parse(localStorage.getItem(CURRENT_SITE_KEY) || 'null');
    if (!raw || typeof raw.site !== 'string') return null;
    // Stale entries are worse than no entry: a site from last week says nothing
    // about what the viewer is working on now.
    if (!raw.at || Date.now() - raw.at > CURRENT_SITE_MAX_AGE_MS) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

function radarPageSite() {
  const v = radarPageView();
  return v ? v.site : null;
}

/**
 * Candidate sites for the "auto" setting, best first.
 *
 * More than one, deliberately. A single station can be down for maintenance or
 * simply have nothing in the archive, and hard-failing on it means the operator
 * sees an error for a radar they never chose. Trying the next nearest turns
 * that into a graphic.
 */
async function autoCandidates(scene, limit = 4) {
  const ranked = await sitesByDistance(scene);
  if (!ranked.length) return [];

  const ids = ranked.slice(0, limit).map((s) => s.id);

  const preferred = radarPageSite();
  if (preferred) {
    const match = ranked.find((s) => s.id === preferred);
    if (match && match.km <= L2_RANGE_KM) {
      return [preferred, ...ids.filter((id) => id !== preferred)];
    }
  }
  return ids;
}

/**
 * Load the radar for the current view.
 *
 * Note what is NOT here: the view. A decoded volume covers the radar's whole
 * ~230 km disc, so panning and zooming inside it need no new data — the caller
 * should key this on the SITE and the PRODUCT, not on the camera.
 *
 * @returns {Promise<object>} shape-compatible with the old server-render result:
 *   { sweep, location, opacity, meta } — plus the pieces the rasteriser needs.
 */
export async function fetchRadarL2(scene, opts = {}) {
  const {
    opacity = 0.9, product = 'reflectivity', site = null, palette = null,
    onProgress = null,
  } = opts;

  // An explicit pick is honoured exactly — if the operator chose a station, a
  // silent substitution would be a lie. "Auto" gets to try alternatives.
  const candidates = site ? [site] : await autoCandidates(scene);
  if (!candidates.length) throw new Error('no radar site for this view');

  let radar = null;
  const failures = [];
  for (const id of candidates) {
    try {
      radar = await loadSweep({ site: id, product, onProgress });
      break;
    } catch (e) {
      failures.push(`${id}: ${e.message}`);
    }
  }
  if (!radar) {
    // Report every station tried, so the message says what actually happened
    // rather than naming one radar the operator never picked.
    throw new Error(failures.length === 1 ? failures[0] : failures.join('; '));
  }

  // Explicit pick wins; otherwise follow whatever the viewer chose on the radar
  // page, so a graphic does not quietly disagree with the radar they are
  // looking at.
  radar.palette = palette || chosenPalette(product);
  radar.opacity = opacity;

  // Caption material: what was ACTUALLY drawn, not what was asked for.
  radar.meta = {
    site: radar.site,
    product,
    productLabel: (PRODUCTS[product] || PRODUCTS.reflectivity).label,
    scanTime: radar.time ? radar.time.toISOString() : null,
    elevationAngle: radar.sweep.elevationAngle,
    palette: radar.palette || radar.code,
    source: 'aws',
    gates: radar.sweep.ranges.length,
    radials: radar.sweep.azimuths.length,
    superRes: radar.sweep.superRes,
    gateSpacingKm: radar.sweep.gateSpacingKm,
  };
  return radar;
}

/* ── loop frames (Play) ──────────────────────────────────────────────────── */

// How many past volumes a Play loop holds, and how long each stays on screen.
const LOOP_FRAME_COUNT = 8;

/**
 * The last LOOP_FRAME_COUNT volumes for one site, oldest first, as a marker
 * chain: the chunks bucket names each volume's folder as a simple counter
 * (see server.js's pickLatestFolder), so "the volume before this one" is
 * just that number minus one. A folder that's missing or incomplete just
 * shortens the loop rather than failing it — a station hiccup on one scan
 * shouldn't cost the whole loop.
 */
async function loadLoopFrames(site, product, onProgress) {
  // Ask for the whole loop up front. The archive listing returns every key for
  // the day anyway, so N frames cost the same one request as a single frame.
  const found = await listRecentVolumes(site, LOOP_FRAME_COUNT);
  if (!found.urls || !found.urls.length) throw new Error(found.reason);

  let urls = found.urls;

  // The relay's chunks fallback answers with a single marker rather than a list
  // of keys: the chunks bucket names each volume's folder as a plain counter
  // (see server.js's pickLatestFolder), so "the volume before this one" is that
  // number minus one. Expand the marker into a chain. A folder that turns out
  // to be missing or incomplete just shortens the loop below rather than
  // failing it — one station hiccup shouldn't cost the whole loop.
  if (urls.length === 1) {
    const m = /^vortex-chunks:([A-Z0-9]{3,4}):(\d+)$/.exec(urls[0]);
    if (m) {
      const latest = parseInt(m[2], 10);
      const chain = [];
      for (let i = LOOP_FRAME_COUNT - 1; i >= 0; i--) {
        const f = latest - i;
        if (f >= 0) chain.push(`vortex-chunks:${m[1]}:${f}`);
      }
      urls = chain;
    }
  }

  // Start every download at once, then decode them in order.
  //
  // Serial download-then-decode per frame meant eight round trips end to end,
  // which was most of the wait before a loop could start. Overlapping the
  // network cuts that to roughly one round trip. Decoding stays strictly
  // sequential below: eight volumes parsed concurrently would hold eight fully
  // decoded volumes in memory at once, which is hundreds of megabytes each.
  urls.forEach((u) => prefetchVolume(u));

  const frames = [];
  for (let i = 0; i < urls.length; i++) {
    if (onProgress) onProgress(`loop frame ${i + 1}/${urls.length}`);
    try {
      frames.push(await loadSweepFromUrl({ url: urls[i], site, product }));
    } catch (e) {
      // Missing/incomplete volume — skip it, keep the rest of the loop.
    }
  }
  return frames;
}

/**
 * Load a Play loop for the current view. Site resolution mirrors
 * fetchRadarL2 exactly (explicit pick wins; "auto" tries the nearest
 * candidates in order) so the loop is built from the same site a single
 * frame would have picked.
 * @returns {Promise<object[]>} frames, oldest first, each shaped like fetchRadarL2's result.
 */
export async function fetchRadarL2Loop(scene, opts = {}) {
  const {
    opacity = 0.9, product = 'reflectivity', site = null, palette = null,
    onProgress = null,
  } = opts;

  const candidates = site ? [site] : await autoCandidates(scene);
  if (!candidates.length) throw new Error('no radar site for this view');

  let frames = null;
  const failures = [];
  for (const id of candidates) {
    try {
      const found = await loadLoopFrames(id, product, onProgress);
      if (found.length) { frames = found; break; }
      failures.push(`${id}: no scans available`);
    } catch (e) {
      failures.push(`${id}: ${e.message}`);
    }
  }
  if (!frames) throw new Error(failures.length === 1 ? failures[0] : failures.join('; '));

  const chosen = palette || chosenPalette(product);
  for (const f of frames) {
    f.palette = chosen;
    f.opacity = opacity;
    f.meta = {
      site: f.site,
      product,
      productLabel: (PRODUCTS[product] || PRODUCTS.reflectivity).label,
      scanTime: f.time ? f.time.toISOString() : null,
      elevationAngle: f.sweep.elevationAngle,
      palette: f.palette || f.code,
      source: 'aws',
      gates: f.sweep.ranges.length,
      radials: f.sweep.azimuths.length,
      superRes: f.sweep.superRes,
      gateSpacingKm: f.sweep.gateSpacingKm,
    };
  }
  return frames;
}

/* ── layer ────────────────────────────────────────────────────────────────── */

// Cheap signature of the projection geometry, so the raster is only rebuilt
// when the view actually changes rather than on every unrelated rerender.
const SIG_PTS = [[-98, 39], [-118, 34], [-80, 42]];
function projSig(scene) {
  const p = scene.projection;
  let s = `${scene.width}x${scene.height}|`;
  for (const pt of SIG_PTS) { const q = p(pt); s += q ? `${Math.round(q[0])},${Math.round(q[1])};` : 'n;'; }
  return s;
}

// Two points, far enough apart to be numerically stable, used to derive the
// transform below. Any two distinct points work — see similarityBetween().
const XFORM_PTS = [[-98, 39], [-80, 42]];

/**
 * The pure scale+translate that turns "old projection's pixels" into "new
 * projection's pixels", when the only thing that changed is the mercator
 * projection's centre/zoom (never rotation, here).
 *
 * This holds exactly, not approximately: a mercator projection's own output
 * plane is a function of longitude and latitude alone, and re-centring /
 * re-scaling it is a plain affine remap of that plane — the same fact that
 * lets slippy-map tiles be dragged around as flat images instead of
 * redrawn. Two reference points measured under both projections fully pin
 * down that affine map (uniform scale, since neither projection is ever
 * rotated or skewed here).
 */
function similarityBetween(oldProj, newProj) {
  const a0 = oldProj(XFORM_PTS[0]), b0 = oldProj(XFORM_PTS[1]);
  const a1 = newProj(XFORM_PTS[0]), b1 = newProj(XFORM_PTS[1]);
  if (!a0 || !b0 || !a1 || !b1) return null;
  const oldDist = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  if (oldDist < 1e-6) return null;
  const s = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]) / oldDist;
  if (!isFinite(s) || s <= 0) return null;
  return { s, tx: a1[0] - s * a0[0], ty: a1[1] - s * a0[1] };
}

/**
 * Scene layer for the Level 2 radar.
 *
 * `quality` is the raster width. engine/radar.js caps its equivalent at 900
 * because a national mosaic is fuzzy anyway; here the source is super-res gate
 * data, so a higher resolution is the difference between a crisp storm core and
 * a soft blob.
 *
 * `fastPreview` (set while the map is being dragged/zoomed) skips the real
 * per-pixel rasterisation — a spherical inverse-projection over hundreds of
 * thousands of pixels, which is where drag stutter came from — and instead
 * blits the last real raster through similarityBetween() above. That is
 * exact for pan/zoom, so quality never actually drops; the true raster is
 * simply recomputed once when the view settles (see markActive()'s idle
 * timer in live-radar.js), which is invisible at the ~300ms it takes.
 */
function rasterSig(scene, quality, smooth, minDbz, palette) {
  return [projSig(scene), quality, smooth ? 1 : 0, minDbz, palette || ''].join('|');
}

/**
 * Build and cache one frame's raster if it is not already current.
 *
 * Split out of the layer so a Play loop can pre-build every frame BEFORE it
 * starts animating. Otherwise each frame rasterises on the very tick that first
 * displays it — a visible hitch per frame on the first pass round the loop, and
 * again after every pan or zoom, because moving the map invalidates all of them
 * at once.
 *
 * @returns {boolean} true if a raster was actually built (i.e. work was done)
 */
export function ensureRaster(radar, scene, { quality = 1600, smooth = true, minDbz = 15 } = {}) {
  if (!radar || !radar.sweep) return false;
  const sig = rasterSig(scene, quality, smooth, minDbz, radar.palette);
  if (radar._raster && radar._raster.sig === sig) return false;
  const canvas = rasterize(radar, scene, { quality, smooth, minDbz, palette: radar.palette });
  if (!canvas) { radar._raster = null; return true; }
  radar._raster = { sig, canvas, proj: scene.projection, sw: scene.width, sh: scene.height };
  return true;
}

/**
 * Pre-build rasters for a list of frames, ONE PER ANIMATION FRAME.
 *
 * Doing all of them in a single synchronous pass would block the main thread
 * for the better part of a second, which is the very stutter this exists to
 * remove. Spreading the work keeps the page responsive while the loop warms.
 *
 * @returns {function} cancel — call it if the view changes or playback stops,
 *          so a superseded warm-up stops competing for the main thread.
 */
export function warmRasters(frames, scene, opts = {}, onProgress = null) {
  let i = 0;
  let cancelled = false;
  const step = () => {
    if (cancelled) return;
    // A throw here would escape into the animation frame, where nothing catches
    // it: the chain would stop dead partway through and the remaining frames
    // would never get rasters, with no error anywhere near the Play button. A
    // frame that cannot be rasterised is skipped instead, so one bad scan costs
    // one frame rather than the rest of the loop.
    try {
      // Skip frames that are already current; only real work costs a frame.
      while (i < frames.length && !ensureRaster(frames[i], scene, opts)) i++;
    } catch (e) {
      console.warn('[studio] could not rasterise loop frame', i, e && e.message);
    }
    if (onProgress) onProgress(Math.min(i + 1, frames.length), frames.length);
    if (i < frames.length) { i++; requestAnimationFrame(step); }
    else if (onProgress) onProgress(frames.length, frames.length);
  };
  requestAnimationFrame(step);
  return () => { cancelled = true; };
}

export function radarL2Layer(radar, { quality = 1600, smooth = true, minDbz = 15, fastPreview = false } = {}) {
  return {
    name: 'radar-l2',
    draw(ctx, scene) {
      if (!radar || !radar.sweep) return;

      const sig = rasterSig(scene, quality, smooth, minDbz, radar.palette);
      const cached = radar._raster;
      const alpha = radar.opacity == null ? 0.9 : radar.opacity;

      if (cached && cached.sig === sig) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cached.canvas, 0, 0, scene.width, scene.height);
        ctx.restore();
        return;
      }

      if (fastPreview && cached && cached.proj) {
        const t = similarityBetween(cached.proj, scene.projection);
        if (t) {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          // The destination rect scales off the SCENE dimensions the raster
          // covered, not the raster canvas's own pixel size — those two differ
          // whenever `quality` isn't equal to scene.width (the normal case:
          // quality defaults to 1200/1600/2200 while the canvas is 1920 or
          // more). Scaling off the raster's own width/height here was the bug:
          // t.s is a scene-space scale factor, so applying it to the raster's
          // (differently-sized) pixel dimensions drew the image at the wrong
          // size and mostly off-frame — which is what "the radar disappears
          // while dragging" was.
          //
          // cached.sw/sh rather than the CURRENT scene: if the canvas has been
          // resized since this raster was made (the 1080p/720p picker), the
          // current dimensions are not the ones it covers.
          const rw = cached.sw || scene.width, rh = cached.sh || scene.height;
          ctx.drawImage(
            cached.canvas, 0, 0, cached.canvas.width, cached.canvas.height,
            t.tx, t.ty, rw * t.s, rh * t.s,
          );
          ctx.restore();
          return;
        }
      }

      const canvas = rasterize(radar, scene, { quality, smooth, minDbz, palette: radar.palette });
      if (!canvas) return;
      // No .copy() needed (this vendored d3 build's projections don't have
      // one): build() always constructs a brand-new projection object rather
      // than mutating the previous one, so holding this reference is already
      // a safe, unmutated snapshot of "the projection the raster was made at".
      // sw/sh: the scene rect this raster covers. The fast-preview blit above
      // needs it, because the canvas itself is only `quality` px wide.
      radar._raster = { sig, canvas, proj: scene.projection, sw: scene.width, sh: scene.height };
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, scene.width, scene.height);
      ctx.restore();
    },
  };
}

export { awsLatestVolumeUrl, chosenPalette };
