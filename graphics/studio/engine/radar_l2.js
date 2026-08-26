// High-resolution radar layer backed by the app's OWN Level 2 data.
//
// engine/radar.js pulls a pre-rendered mosaic PNG from the NWS ImageServer.
// This one calls /api/graphics/radar-l2, which decodes super-res NEXRAD Level 2
// with the same libnexrad decoder and the same colormaps the radar page uses —
// so a graphic and the live radar agree, gate for gate.
//
// The server returns an equirectangular PNG over the bbox we ask for, so
// mapping a source pixel to lon/lat is plain linear arithmetic; we then warp it
// into the scene's d3 projection.

const CONUS = { W: -125, S: 24, E: -66.5, N: 50 };

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('radar image decode failed')); };
    img.src = url;
  });
}

// Geographic bbox covering the current view, sampled from the projection.
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
  // Clamp to sane geographic bounds; a single radar covers ~230 km anyway.
  return [
    Math.max(-179, W - px), Math.max(-85, S - py),
    Math.min(179, E + px), Math.min(85, N + py),
  ];
}

// The radar page stores colortable picks as { REF: 'REF2', VEL: 'VEL1', … }.
// Uploaded custom tables live only in that browser's localStorage, so the
// server cannot resolve them; those fall back to the built-in default.
function chosenPalette(product) {
  const base = product === 'velocity' ? 'VEL' : 'REF';
  try {
    const choices = JSON.parse(localStorage.getItem('vortexColortableChoice') || '{}');
    const id = choices && choices[base];
    return (typeof id === 'string' && id !== base) ? id : null;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch the Level 2 raster for the scene's current view.
 * Returns { img, bbox, opacity, meta } — shape-compatible with engine/radar.js.
 */
export async function fetchRadarL2(scene, opts = {}) {
  const {
    opacity = 0.9, product = 'reflectivity', smooth = true,
    minDbz = 15, width = 1600,
  } = opts;

  const bbox = viewBbox(scene);
  const qs = new URLSearchParams({
    bbox: bbox.map((n) => n.toFixed(4)).join(','),
    w: String(Math.round(width)),
    product,
    smooth: smooth ? '1' : '0',
    minDbz: String(minDbz),
  });

  // Match the colortable the viewer chose on the radar page. Choosing one there
  // mutates product_colors[product] in the browser and records the pick in
  // localStorage, so without this a graphic renders the built-in default and
  // quietly disagrees with the radar they are looking at.
  const palette = chosenPalette(product);
  if (palette) qs.set('palette', palette);

  // Time-box the request. A decode of a fresh 10 MB volume can take a few
  // seconds; a stalled connection should surface as an error the template can
  // show, not leave the caption reading "Loading radar…" forever.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 45000);
  let res;
  try {
    res = await fetch(`/api/graphics/radar-l2?${qs}`, { signal: ctrl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timed out' : e.message);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* not json */ }
    throw new Error(msg);
  }

  // The renderer reports what it actually drew (site, sweep, scan time) in a
  // header, so the template can caption the graphic truthfully.
  let meta = null;
  try { meta = JSON.parse(res.headers.get('X-Radar-Meta') || 'null'); } catch (e) { meta = null; }

  const img = await blobToImage(await res.blob());
  return { img, bbox, opacity, meta };
}

/* ── warping ──────────────────────────────────────────────────────────────── */

function ensureSource(radar) {
  if (radar._src) return radar._src;
  const rw = radar.img.naturalWidth || radar.img.width;
  const rh = radar.img.naturalHeight || radar.img.height;
  const c = document.createElement('canvas');
  c.width = rw; c.height = rh;
  const g = c.getContext('2d');
  g.drawImage(radar.img, 0, 0);
  radar._src = { data: g.getImageData(0, 0, rw, rh).data, rw, rh };
  return radar._src;
}

// Cheap signature of the projection geometry so we only re-warp when the view
// actually changes rather than on every unrelated rerender.
function projSig(scene) {
  const p = scene.projection;
  const pts = [[-98, 39], [-118, 34], [-80, 42]];
  let s = `${scene.width}x${scene.height}|`;
  for (const pt of pts) { const q = p(pt); s += q ? `${Math.round(q[0])},${Math.round(q[1])};` : 'n;'; }
  return s;
}

// Warp the equirectangular raster into projection space.
//
// `quality` is the warp buffer width. engine/radar.js caps this at 900 because a
// national mosaic is fuzzy anyway; here the source is super-res gate data, so
// warping at a higher resolution is the difference between a crisp storm core
// and a soft blob. Alpha is carried through — the server fades out clear-air
// return, and that transparency has to survive the warp.
function warp(radar, scene, quality) {
  const p = scene.projection;
  if (!p || !p.invert) return null;
  const [W, S, E, N] = radar.bbox;
  const { data: sd, rw, rh } = ensureSource(radar);

  const OW = Math.min(quality, Math.max(scene.width, 640));
  const scale = OW / scene.width;
  const OH = Math.max(1, Math.round(scene.height * scale));
  const inv = 1 / scale;

  const out = document.createElement('canvas');
  out.width = OW; out.height = OH;
  const octx = out.getContext('2d');
  const img = octx.createImageData(OW, OH);
  const od = img.data;
  const dLon = E - W, dLat = N - S;

  for (let oy = 0; oy < OH; oy++) {
    const sy = oy * inv;
    for (let ox = 0; ox < OW; ox++) {
      const ll = p.invert([ox * inv, sy]);
      if (!ll) continue;
      const u = (ll[0] - W) / dLon;
      const v = (N - ll[1]) / dLat;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const si = (((v * rh) | 0) * rw + ((u * rw) | 0)) * 4;
      const a = sd[si + 3];
      if (!a) continue;
      const di = (oy * OW + ox) * 4;
      od[di] = sd[si]; od[di + 1] = sd[si + 1]; od[di + 2] = sd[si + 2]; od[di + 3] = a;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function getWarp(radar, scene, quality) {
  const sig = projSig(scene) + '|' + quality;
  if (radar._warp && radar._warp.sig === sig) return radar._warp.canvas;
  const canvas = warp(radar, scene, quality);
  radar._warp = { sig, canvas };
  return canvas;
}

/** Scene layer for the composited Level 2 radar. */
export function radarL2Layer(radar, { quality = 1600 } = {}) {
  return {
    name: 'radar-l2',
    draw(ctx, scene) {
      if (!radar || !radar.img) return;
      const warped = getWarp(radar, scene, quality);
      if (!warped) return;
      ctx.save();
      ctx.globalAlpha = radar.opacity == null ? 0.9 : radar.opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(warped, 0, 0, scene.width, scene.height);
      ctx.restore();
    },
  };
}
