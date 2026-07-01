// User overlays drawn on top of every template: a freehand "coloring" brush so
// users can color/annotate any graphic with their own colors, a custom logo
// "bug", draggable info panels (multi-line text), and a name plate. All render
// into the broadcast canvas so they're included in the exported PNG.
import { roundRect } from './scene.js';

// strokes: [{ color, size, points: [{x, y}, ...] }] in canvas (broadcast) space.
export function freehandLayer(strokes) {
  return {
    name: 'freehand',
    draw(ctx) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const st of strokes) {
        if (!st.points || !st.points.length) continue;
        ctx.strokeStyle = st.color;
        ctx.lineWidth = st.size;
        if (st.points.length === 1) {
          // a single tap renders as a dot
          const p = st.points[0];
          ctx.fillStyle = st.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, st.size / 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(st.points[0].x, st.points[0].y);
        for (let i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i].x, st.points[i].y);
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

// logo: { img: HTMLImageElement, corner: 'tr'|'tl'|'br'|'bl', scale } drawn in a
// frame corner, sized as a fraction of the canvas width (keeps aspect ratio).
export function logoLayer(logo) {
  return {
    name: 'logo',
    draw(ctx, scene) {
      const img = logo.img;
      if (!img || !img.complete || !img.naturalWidth) return;
      const margin = Math.round(scene.width * 0.018);
      const w = Math.round(scene.width * (logo.scale ?? 0.16));
      const h = Math.round(w * (img.naturalHeight / img.naturalWidth));
      const corner = logo.corner || 'tr';
      const x = corner === 'tl' || corner === 'bl' ? margin : scene.width - w - margin;
      const y = corner === 'tl' || corner === 'tr' ? margin : scene.height - h - margin;
      ctx.drawImage(img, x, y, w, h);
    },
  };
}

// Wrap text into lines: honors explicit newlines ('\n') AND word-wraps each
// paragraph to fit maxW with the currently set ctx.font.
export function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text == null ? '' : text).split('\n')) {
    if (para === '') { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (line && ctx.measureText(test).width > maxW) { out.push(line); line = word; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

// Info panel overlay: a titled box with multi-line body text. Stores its drawn
// rect on ov._rect so the studio can hit-test it for dragging.
// ov: { title, text, x, y, w, accent }
export function panelOverlayLayer(ov) {
  return {
    name: 'panel-overlay',
    draw(ctx) {
      const x = ov.x, y = ov.y, w = ov.w || 360;
      const pad = 16;
      const titleH = ov.title ? 42 : 0;
      const lineH = 30;
      ctx.font = '600 22px "Segoe UI", Arial, sans-serif';
      const lines = wrapLines(ctx, ov.text, w - pad * 2);
      const bodyH = lines.length ? lines.length * lineH : 0;
      const h = titleH + (ov.title ? 0 : pad) + bodyH + pad;
      // panel
      roundRect(ctx, x, y, w, h, 8);
      ctx.fillStyle = 'rgba(20,28,40,0.86)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.stroke();
      // title bar
      if (ov.title) {
        roundRect(ctx, x, y, w, titleH, 8);
        ctx.fillStyle = ov.accent || '#5a1d22';
        ctx.fill();
        ctx.fillStyle = '#ffd24a';
        ctx.font = '900 22px "Segoe UI", Arial Black, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(String(ov.title).toUpperCase(), x + 14, y + titleH / 2 + 1);
      }
      // body
      ctx.fillStyle = '#f1f4fa';
      ctx.font = '600 22px "Segoe UI", Arial, sans-serif';
      ctx.textBaseline = 'alphabetic';
      let ty = y + titleH + (ov.title ? 0 : pad) + 22;
      for (const ln of lines) { ctx.fillText(ln, x + pad, ty); ty += lineH; }
      ov._rect = { x, y, w, h };
    },
  };
}

// Name plate overlay: a bold name with an optional subtitle and accent bar.
// ov: { name, subtitle, x, y, accent }
export function nameOverlayLayer(ov) {
  return {
    name: 'name-overlay',
    draw(ctx) {
      const x = ov.x, y = ov.y;
      const name = ov.name || 'Name';
      const sub = ov.subtitle || '';
      ctx.textAlign = 'left';
      ctx.font = '900 44px "Segoe UI", Arial Black, sans-serif';
      const nameW = ctx.measureText(name).width;
      ctx.font = '600 26px "Segoe UI", Arial, sans-serif';
      const subW = sub ? ctx.measureText(sub).width : 0;
      const w = Math.max(nameW, subW) + 28 + 24;
      const h = sub ? 104 : 72;
      roundRect(ctx, x, y, w, h, 10);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#10233f');
      g.addColorStop(1, '#081627');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = ov.accent || '#4c8dff';
      ctx.fillRect(x, y, 12, h);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 44px "Segoe UI", Arial Black, sans-serif';
      ctx.fillText(name, x + 28, y + (sub ? 52 : h / 2 + 15));
      if (sub) {
        ctx.fillStyle = '#9db8de';
        ctx.font = '600 26px "Segoe UI", Arial, sans-serif';
        ctx.fillText(sub, x + 28, y + 88);
      }
      ov._rect = { x, y, w, h };
    },
  };
}
