// Radar site markers — the blue station pills from the radar page, drawn on a
// studio scene.
//
// The site list comes from /api/graphics/radar-sites, which serves the app's own
// NEXRAD_LOCATIONS table. The studio therefore never carries a second copy of
// the site list that could drift out of date when a station moves or is added.
//
// Styling mirrors the radar page: a rounded pill with the 4-letter id, blue for
// WSR-88D, amber for TDWR, so a graphic reads the same way the live map does.

let sitesPromise = null;
let sites = null;

/** Load (once) and cache the station list. */
export function loadRadarSites() {
  if (sites) return Promise.resolve(sites);
  if (!sitesPromise) {
    sitesPromise = fetch('/api/graphics/radar-sites')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((j) => {
        sites = Array.isArray(j.sites) ? j.sites : [];
        return sites;
      })
      .catch((e) => {
        console.warn('[studio] radar sites unavailable:', e.message);
        sites = [];
        return sites;
      });
  }
  return sitesPromise;
}

function pill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Scene layer drawing the station pills.
 * @param {object} o
 * @param {Array}  o.sites      from loadRadarSites()
 * @param {number} o.fontSize
 * @param {string} o.highlight  a site id to emphasise (e.g. the one supplying the radar)
 * @param {boolean} o.tdwr      include TDWR sites
 */
export function radarSitesLayer({ sites: list, fontSize = 15, highlight = null, tdwr = true, labels = true } = {}) {
  return {
    name: 'radar-sites',
    draw(ctx, scene) {
      if (!list || !list.length) return;
      const p = scene.projection;
      if (!p) return;

      const padX = 6, padY = 4;
      ctx.save();
      ctx.font = `800 ${fontSize}px "Roboto Condensed", "Arial Narrow", system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      for (const s of list) {
        const isTdwr = /TDWR/i.test(s.type || '');
        if (isTdwr && !tdwr) continue;

        const q = p([s.lon, s.lat]);
        if (!q) continue;
        const [x, y] = q;
        // Off-canvas sites cost nothing to skip and would otherwise pile up
        // labels just outside the frame.
        if (x < -60 || x > scene.width + 60 || y < -40 || y > scene.height + 40) continue;

        const isHi = highlight && s.id === highlight;
        const fill = isHi ? '#e8862b' : (isTdwr ? '#c98a1e' : '#2b7fd4');
        const ink = '#ffffff';

        if (!labels) {
          // Marker-only mode: a small dot, for busy/zoomed-out frames.
          ctx.beginPath();
          ctx.arc(x, y, isHi ? 5.5 : 4, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(0,0,0,0.65)';
          ctx.stroke();
          continue;
        }

        const tw = ctx.measureText(s.id).width;
        const w = tw + padX * 2;
        const h = fontSize + padY * 2;
        const bx = x - w / 2;
        const by = y - h / 2;

        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1;
        pill(ctx, bx, by, w, h, 4);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        if (isHi) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.stroke();
        }

        ctx.fillStyle = ink;
        ctx.fillText(s.id, bx + padX, y + 0.5);
      }
      ctx.restore();
    },
  };
}
