// Forecast-model field overlay for the studio. Fetches a colorized field PNG
// from the app's model layer (/api/models/:id/field — the SAME endpoint the
// in-app Models & Forecast panel uses), warps it from EPSG:4326 onto the studio
// projection (same technique as the radar overlay), and draws a gradient legend
// from the response's X-Legend header. Pro-gated server-side like all /api/models.
import { roundRect } from './scene.js';
import { FONT } from './style.js';

const API = '/api/models';

// Cycle models that expose the standard latest/hours/index/field endpoints.
export const MODEL_OPTIONS = [
  { value: 'gfs', label: 'GFS (0.25° global)' },
  { value: 'nam', label: 'NAM (12 km CONUS)' },
  { value: 'hrrr', label: 'HRRR (3 km CONUS)' },
];

// Curated broadcast fields (variable + level matcher — mirrors the app panel).
export const MODEL_PRESETS = [
  { id: 't2m', label: '2 m Temperature', v: 'TMP', lvl: '2 m above ground' },
  { id: 'refc', label: 'Composite Reflectivity', v: 'REFC', lvl: 'entire atmosphere' },
  { id: 'mslp', label: 'Mean Sea-Level Pressure', v: 'PRMSL', lvl: 'mean sea level' },
  { id: 'cape', label: 'Surface CAPE', v: 'CAPE', lvl: 'surface' },
  { id: 'pwat', label: 'Precipitable Water', v: 'PWAT', lvl: 'entire atmosphere' },
  { id: 't850', label: '850 mb Temperature', v: 'TMP', lvl: '850 mb' },
  { id: 't500', label: '500 mb Temperature', v: 'TMP', lvl: '500 mb' },
  { id: 'apcp', label: 'Total Precipitation', v: 'APCP', lvl: 'surface' },
];

export const FHR_OPTIONS = [0, 1, 3, 6, 9, 12, 18, 24, 30, 36, 48, 60, 72, 84, 96, 120]
  .map((h) => ({ value: String(h), label: `+${h} h` }));

async function j(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
function pickHour(req, hours) {
  const r = Number(req) || 0;
  if (!hours || !hours.length) return r;
  if (hours.includes(r)) return r;
  return hours.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), hours[0]);
}

// Fetch + resolve one field for the given view bbox. Returns { img, bbox,
// legend, run, fhr, label, validTime }.
export async function loadModelField(model, presetId, fhr, bbox) {
  const preset = MODEL_PRESETS.find((p) => p.id === presetId) || MODEL_PRESETS[0];
  const run = await j(`${API}/${model}/latest`);
  const { hours } = await j(`${API}/${model}/hours?date=${run.date}&cycle=${run.cycle}`);
  const useFhr = pickHour(fhr, hours);
  const idx = await j(`${API}/${model}/index?date=${run.date}&cycle=${run.cycle}&fhr=${useFhr}`);
  const v = preset.v.toUpperCase(), lvl = preset.lvl.toLowerCase();
  const msg = (idx.messages || []).find((m) => m.variable.toUpperCase() === v && m.level.toLowerCase().startsWith(lvl));
  if (!msg) throw new Error(`${preset.label} not in this ${model.toUpperCase()} run`);
  const res = await fetch(`${API}/${model}/field?date=${run.date}&cycle=${run.cycle}&fhr=${useFhr}&msg=${msg.n}&bbox=${bbox.join(',')}&w=760`);
  if (!res.ok) throw new Error('field HTTP ' + res.status);
  let legend = null; try { legend = JSON.parse(res.headers.get('X-Legend') || 'null'); } catch (e) { /* ignore */ }
  const img = await createImageBitmap(await res.blob());
  return { img, bbox, legend, run, fhr: useFhr, hours, label: preset.label, validTime: validTime(run, useFhr) };
}

// run.date = 'YYYYMMDD', run.cycle = 'HH' (UTC) + fhr hours → local valid-time label.
function validTime(run, fhr) {
  try {
    const y = +run.date.slice(0, 4), mo = +run.date.slice(4, 6) - 1, d = +run.date.slice(6, 8);
    const t = new Date(Date.UTC(y, mo, d, +run.cycle + Number(fhr)));
    return t.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  } catch (e) { return ''; }
}

// ── warp (EPSG:4326 raster → projection space); mirrors engine/radar.js ─────────
function ensureSource(f) {
  if (f._src) return f._src;
  const rw = f.img.width, rh = f.img.height;
  const c = document.createElement('canvas'); c.width = rw; c.height = rh;
  const g = c.getContext('2d'); g.drawImage(f.img, 0, 0);
  f._src = { data: g.getImageData(0, 0, rw, rh).data, rw, rh };
  return f._src;
}
function projSig(scene) {
  const p = scene.projection; const pts = [[-98, 39], [-118, 34], [-80, 42]];
  let s = `${scene.width}x${scene.height}|`;
  for (const pt of pts) { const q = p(pt); s += q ? `${Math.round(q[0])},${Math.round(q[1])};` : 'n;'; }
  return s;
}
function warp(f, scene) {
  const p = scene.projection; if (!p || !p.invert) return null;
  const [W, S, E, N] = f.bbox; const { data: sd, rw, rh } = ensureSource(f);
  const OW = Math.min(1100, scene.width); const scale = OW / scene.width; const OH = Math.max(1, Math.round(scene.height * scale)); const inv = 1 / scale;
  const out = document.createElement('canvas'); out.width = OW; out.height = OH;
  const octx = out.getContext('2d'); const im = octx.createImageData(OW, OH); const od = im.data;
  const dLon = E - W, dLat = N - S;
  for (let oy = 0; oy < OH; oy++) {
    const sy = oy * inv;
    for (let ox = 0; ox < OW; ox++) {
      const ll = p.invert([ox * inv, sy]); if (!ll) continue;
      const u = (ll[0] - W) / dLon, v = (N - ll[1]) / dLat;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const si = (((v * rh) | 0) * rw + ((u * rw) | 0)) * 4; const di = (oy * OW + ox) * 4;
      od[di] = sd[si]; od[di + 1] = sd[si + 1]; od[di + 2] = sd[si + 2]; od[di + 3] = sd[si + 3];
    }
  }
  octx.putImageData(im, 0, 0); return out;
}
function getWarp(f, scene) {
  const sig = projSig(scene);
  if (f._warp && f._warp.sig === sig) return f._warp.canvas;
  const canvas = warp(f, scene); f._warp = { sig, canvas }; return canvas;
}

export function modelFieldLayer(field, opacity) {
  return {
    name: 'model-field',
    draw(ctx, scene) {
      if (!field || !field.img) return;
      const w = getWarp(field, scene); if (!w) return;
      ctx.save();
      ctx.globalAlpha = opacity == null ? 0.85 : opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(w, 0, 0, scene.width, scene.height);
      ctx.restore();
    },
  };
}

// Horizontal gradient legend from the X-Legend stops ([[value,'rgb()'], …]).
export function fieldLegendLayer(legend, rect, { title } = {}) {
  return {
    name: 'legend-gradient',
    draw(ctx) {
      if (!legend || !legend.stops || legend.stops.length < 2) return;
      const { x, y, w, h } = rect;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
      roundRect(ctx, x, y, w, h, 12); ctx.fillStyle = 'rgba(9,14,24,0.9)'; ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; roundRect(ctx, x, y, w, h, 12); ctx.stroke();

      const stops = legend.stops;
      const vmin = stops[0][0], vmax = stops[stops.length - 1][0], span = (vmax - vmin) || 1;
      const unit = legend.unit || '';
      ctx.font = `800 22px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#eaf2ff';
      ctx.fillText(`${(title || '').toUpperCase()}${unit ? '  (' + unit + ')' : ''}`, x + 18, y + 30);

      const bx = x + 18, by = y + 42, bw = w - 36, bh = 20;
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      for (const [val, col] of stops) { let t = (val - vmin) / span; t = Math.max(0, Math.min(1, t)); g.addColorStop(t, col); }
      roundRect(ctx, bx, by, bw, bh, 5); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; roundRect(ctx, bx, by, bw, bh, 5); ctx.stroke();

      // ~6 evenly spaced numeric ticks across the value range.
      ctx.font = `600 15px ${FONT}`; ctx.fillStyle = 'rgba(210,222,238,0.85)';
      const ticks = 6;
      for (let i = 0; i <= ticks; i++) {
        const t = i / ticks; const val = vmin + t * span; const tx = bx + t * bw;
        ctx.textAlign = i === 0 ? 'left' : (i === ticks ? 'right' : 'center');
        const label = Math.abs(val) >= 100 ? Math.round(val) : (Math.round(val * 10) / 10);
        ctx.fillText(String(label), tx, by + bh + 18);
      }
    },
  };
}
