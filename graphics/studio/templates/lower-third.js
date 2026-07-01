// Template: Lower-Thirds / Title Banners — broadcast name strips and title
// slabs with no map. Supports a transparent background for chroma/alpha keying
// in OBS or a switcher. Several styles approximate the reference banner sheet.
import { roundRect } from '../engine/scene.js';
import { flagHeaderLayer, titleBarLayer } from '../engine/chrome.js';

export default {
  id: 'lower-third',
  label: 'Lower-Third / Title Banner',
  scale: null,

  defaultConfig() {
    return {
      style: 'angled-blue',
      title: 'FORT WAYNE',
      subtitle: 'Severe Thunderstorm Warning',
      accent: '#1769d6',
      transparent: true,
    };
  },

  fields() {
    return [
      { key: 'style', label: 'Style', type: 'select', options: [
        { value: 'angled-blue', label: 'Angled blue/white' },
        { value: 'flag', label: 'Red flag + title' },
        { value: 'title-bar', label: 'Top title bar' },
        { value: 'name-strip', label: 'Name strip' },
      ] },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      { key: 'accent', label: 'Accent color', type: 'color' },
      { key: 'transparent', label: 'Transparent background', type: 'toggle' },
    ];
  },

  build(scene, geo, config) {
    scene.clearLayers();
    if (!config.transparent) {
      scene.add({ name: 'bg', draw(ctx, s) {
        const g = ctx.createLinearGradient(0, 0, 0, s.height);
        g.addColorStop(0, '#0b1622'); g.addColorStop(1, '#04121f');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s.width, s.height);
      } });
    }

    switch (config.style) {
      case 'flag':
        scene.add(flagHeaderLayer({ flag: 'Alert', title: config.title, subtitle: config.subtitle, rect: { x: 80, y: 760, w: 1760, h: 140 }, flagColor: '#c20012' }));
        break;
      case 'title-bar':
        scene.add(titleBarLayer({ title: config.title, subtitle: config.subtitle, rect: { x: 80, y: 80, w: 1760, h: 180 } }));
        break;
      case 'name-strip':
        scene.add(nameStrip(config));
        break;
      case 'angled-blue':
      default:
        scene.add(angledBlue(config));
        break;
    }
  },
};

function angledBlue(config) {
  return {
    name: 'lt-angled',
    draw(ctx, s) {
      const y = 800, h = 150, skew = 70;
      const left = 90, blockW = 520;
      // blue block
      const bg = ctx.createLinearGradient(left, y, left, y + h);
      bg.addColorStop(0, config.accent);
      bg.addColorStop(1, shade(config.accent, 0.7));
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(left, y); ctx.lineTo(left + blockW, y);
      ctx.lineTo(left + blockW - skew, y + h); ctx.lineTo(left, y + h); ctx.closePath();
      ctx.fill();
      // gold seam
      ctx.fillStyle = '#e7b53b';
      ctx.beginPath();
      ctx.moveTo(left + blockW, y); ctx.lineTo(left + blockW + 16, y);
      ctx.lineTo(left + blockW + 16 - skew, y + h); ctx.lineTo(left + blockW - skew, y + h); ctx.closePath();
      ctx.fill();
      // white slab
      const wx = left + blockW + 16;
      ctx.fillStyle = '#f6f8fb';
      ctx.beginPath();
      ctx.moveTo(wx, y); ctx.lineTo(s.width - 90, y);
      ctx.lineTo(s.width - 90, y + h); ctx.lineTo(wx - skew, y + h); ctx.closePath();
      ctx.fill();
      // text: title in blue block, subtitle in white slab
      ctx.fillStyle = '#fff';
      ctx.font = '900 56px "Segoe UI", Arial Black, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(config.title, left + 36, y + h / 2);
      ctx.fillStyle = '#10203a';
      ctx.font = '700 44px "Segoe UI", Arial, sans-serif';
      ctx.fillText(config.subtitle, wx + 30, y + h / 2);
    },
  };
}

function nameStrip(config) {
  return {
    name: 'lt-name',
    draw(ctx, s) {
      const y = 820, h = 130, x = 120, w = s.width - 240;
      roundRect(ctx, x, y, w, h, 10);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#10233f'); g.addColorStop(1, '#081627');
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = config.accent; ctx.fillRect(x, y, 16, h);
      ctx.fillStyle = '#fff'; ctx.font = '900 52px "Segoe UI", Arial Black, sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(config.title, x + 50, y + 62);
      ctx.fillStyle = '#9db8de'; ctx.font = '600 34px "Segoe UI", Arial, sans-serif';
      ctx.fillText(config.subtitle, x + 50, y + 104);
    },
  };
}

function shade(hex, f) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}
