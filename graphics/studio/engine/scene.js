// Scene compositor. Holds an ordered list of layers and renders them to a
// canvas at full broadcast resolution. Supports hit-testing (for click-to-paint
// editing) and PNG export. Layers are plain objects: { name, draw(ctx, scene) }.

export class Scene {
  constructor(canvas, { width = 1920, height = 1080 } = {}) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.layers = [];
    this.hitAreas = []; // { path2d, data, onClick }
    this.projection = null;
    this.path = null;    // d3.geoPath bound to a canvas context at render time
    this.config = {};
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  clearLayers() {
    this.layers = [];
    this.hitAreas = [];
  }

  add(layer) {
    this.layers.push(layer);
    return this;
  }

  // Register a clickable region for the editor's paint tool.
  registerHit(path2d, data, onClick) {
    this.hitAreas.push({ path2d, data, onClick });
  }

  render() {
    const ctx = this.canvas.getContext('2d');
    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    for (const layer of this.layers) {
      ctx.save();
      try {
        layer.draw(ctx, this);
      } catch (err) {
        console.error('Layer failed:', layer.name, err);
      }
      ctx.restore();
    }
    ctx.restore();
    return this;
  }

  // Topmost hit area containing canvas-space point (x, y).
  pick(x, y) {
    const ctx = this.canvas.getContext('2d');
    for (let i = this.hitAreas.length - 1; i >= 0; i--) {
      const h = this.hitAreas[i];
      if (ctx.isPointInPath(h.path2d, x, y)) return h;
    }
    return null;
  }

  async exportPNG(filename = 'graphic.png') {
    const blob = await new Promise((res) => this.canvas.toBlob(res, 'image/png'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

// Small drawing helpers shared by layers/templates.
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Fit text into a max width by shrinking font size (deterministic).
export function fitFont(ctx, text, font, maxWidth) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  let size = m ? parseFloat(m[1]) : 32;
  let f = font;
  ctx.font = f;
  while (ctx.measureText(text).width > maxWidth && size > 8) {
    size -= 1;
    f = font.replace(/\d+(?:\.\d+)?px/, `${size}px`);
    ctx.font = f;
  }
  return f;
}
