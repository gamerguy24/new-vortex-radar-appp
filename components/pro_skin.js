/*
 * components/pro_skin.js
 * The professional interface, for accounts holding a Vortex Pro organisation
 * licence. Everyone else gets the consumer radar exactly as before.
 *
 * THE IDEA
 * Not a second radar app. The same app, re-framed: the floating rounded
 * controls are MOVED — the actual DOM nodes, not copies — into a docked
 * workstation frame in the GRLevel3 idiom. A tool dock down the left, a status
 * strip along the bottom with live readouts, square corners, dense type.
 *
 * WHY MOVE NODES INSTEAD OF REBUILDING CONTROLS
 * Every one of these buttons already carries its own click handlers, tier
 * gates, tooltips and active-state classes, wired up by a dozen other modules.
 * Rebuilding them in a new shell would mean re-wiring all of that and would
 * silently break the moment any of those modules changed. appendChild moves a
 * live node and keeps every listener attached to it, so the dock is a new
 * arrangement of the existing app rather than a fork of it.
 *
 * ORDERING
 * This runs after the app has built its UI (it waits for the footer to exist),
 * because it can only re-home controls that are already on the page.
 */

const CLASS = 'vx-pro';
const REMEMBER = 'vortex_pro_ui';     // last known answer, to avoid a flash

/* ── who is looking ───────────────────────────────────────────────────────── */

async function licensed() {
  try {
    const r = await fetch('/auth/me', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j.user && j.user.proUi);
  } catch (e) {
    return false;
  }
}

/*
 * Apply the remembered answer immediately, then correct it once the server
 * replies. Without this a licensed operator watches the consumer interface
 * paint and then rearrange itself on every single load, which looks broken
 * even though it is only late. The remembered value is a display preference,
 * never an access decision — the licence itself is enforced on the server.
 */
function rememberedGuess() {
  try { return localStorage.getItem(REMEMBER) === '1'; } catch (e) { return false; }
}
function remember(on) {
  try { on ? localStorage.setItem(REMEMBER, '1') : localStorage.removeItem(REMEMBER); } catch (e) {}
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

function field(id, key, value) {
  const f = el('div', 'vxpro-field');
  if (id) f.id = id;
  f.innerHTML = '<span class="k"></span><span class="v"></span>';
  f.querySelector('.k').textContent = key;
  f.querySelector('.v').textContent = value == null ? '—' : value;
  return f;
}
const setField = (id, v) => {
  const n = document.querySelector('#' + id + ' .v');
  if (n && n.textContent !== v) n.textContent = v;
};

function waitFor(test, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (test()) return resolve(true);
    const started = Date.now();
    const t = setInterval(() => {
      if (test()) { clearInterval(t); resolve(true); }
      else if (Date.now() - started > timeoutMs) { clearInterval(t); resolve(false); }
    }, 120);
  });
}

/* ── the frame ────────────────────────────────────────────────────────────── */

function buildTop() {
  const top = el('div');
  top.id = 'vxpro-top';

  const brand = el('div', null, 'VORTEX <b>PRO</b><span class="vxpro-org" id="vxpro-org"></span>');
  brand.id = 'vxpro-brand';
  top.appendChild(brand);

  const meta = el('div');
  meta.id = 'vxpro-topmeta';
  meta.appendChild(field('vxpro-site', 'Site', '—'));
  meta.appendChild(field('vxpro-vcp', 'VCP', '—'));
  meta.appendChild(field('vxpro-elev', 'Elev', '—'));
  meta.appendChild(field('vxpro-product', 'Product', '—'));
  const grow = field('vxpro-loc', 'Location', '');
  grow.classList.add('grow');
  meta.appendChild(grow);
  top.appendChild(meta);

  document.body.appendChild(top);

  // The alert counter belongs in the top strip, not floating over the map.
  const pill = document.getElementById('vortexAlertPill');
  if (pill) top.appendChild(pill);

  return top;
}

function buildDock() {
  const dock = el('div');
  dock.id = 'vxpro-dock';

  const section = (caption, grows) => {
    const s = el('div', 'vxpro-sec' + (grows ? ' grow' : ''));
    const c = el('div', 'vxpro-cap');
    c.textContent = caption;
    const b = el('div', 'vxpro-body');
    s.appendChild(c);
    s.appendChild(b);
    dock.appendChild(s);
    return b;
  };

  const source = section('Radar');
  const tools = section('Tools', true);
  const scale = section('Colour Scale');

  document.body.appendChild(dock);

  /*
   * Site and product pickers. These live inside the floating footer in the
   * consumer UI; here they become the top of the dock, which is where an
   * operator looks first — what am I pointed at, and at what.
   */
  const trigger = document.getElementById('productsDropdownTrigger');
  if (trigger) {
    trigger.classList.add('vxpro-pick');
    source.appendChild(trigger);
  }
  const dateTime = document.getElementById('radarDateTime');
  if (dateTime) {
    dateTime.classList.add('vxpro-pick');
    source.appendChild(dateTime);
  }

  /*
   * The tool rail, relabelled. Each button's own title attribute is the label
   * — the app already wrote a good one for every icon, and reusing it means a
   * tool added later shows up here correctly with no change to this file.
   */
  const rail = document.getElementById('vortexBarIcons');
  if (rail) {
    for (const item of [...rail.children]) {
      const label = (item.getAttribute('title') || item.textContent || '').trim();
      item.removeAttribute('title');           // the row now says it in words
      item.classList.add('vxpro-tool');
      if (label) {
        const t = el('span', 'vxpro-tool-label');
        t.textContent = label;
        item.appendChild(t);
      }
      tools.appendChild(item);
    }
  }

  /*
   * The warning desk at /pro is the other half of this licence, and nothing in
   * the radar app pointed at it — an operator had to be told the URL. It goes
   * at the foot of the tool list, styled as a tool because that is what it is.
   */
  const desk = el('div', 'vxpro-tool vxpro-desk',
    '<span class="fa fa-table-columns"></span><span class="vxpro-tool-label">Warning Desk</span>');
  desk.title = '';
  desk.addEventListener('click', () => { window.location.href = '/pro'; });
  tools.appendChild(desk);

  const legend = document.getElementById('vortexLegend');
  if (legend) scale.appendChild(legend);

  return dock;
}

function buildStatus() {
  const bar = el('div');
  bar.id = 'vxpro-status';

  const transport = el('div');
  transport.id = 'vxpro-transport';
  bar.appendChild(transport);

  for (const id of ['vortexPlayBtn', 'vortexTimeline', 'vortexSpeedWrap']) {
    const n = document.getElementById(id);
    if (n) transport.appendChild(n);
  }

  bar.appendChild(field('vxpro-frame-n', 'Frame', '—'));
  bar.appendChild(field('vxpro-scan', 'Scan', '—'));
  const spacer = el('div');
  spacer.id = 'vxpro-spacer';
  bar.appendChild(spacer);
  bar.appendChild(field('vxpro-cursor', 'Cursor', '—'));
  bar.appendChild(field('vxpro-clock', 'UTC', '—'));

  document.body.appendChild(bar);
  return bar;
}

/* ── live readouts ────────────────────────────────────────────────────────── */

/*
 * The status and top strips are fed from the DOM the consumer header already
 * maintains, rather than from the radar modules directly. That header is
 * updated by whichever module owns each fact — station, VCP, product, scan
 * time — so reading it means this skin cannot fall out of step with them, and
 * needs no hooks into code that does not know it exists.
 */
function pumpReadouts() {
  const text = (id) => {
    const n = document.getElementById(id);
    const t = n ? (n.textContent || '').trim() : '';
    return t || '—';
  };

  setField('vxpro-site', text('radarStation'));
  setField('vxpro-loc', text('radarLocation') === '—' ? '' : text('radarLocation'));
  setField('vxpro-vcp', text('radarVCP'));
  setField('vxpro-product', text('headerProductName'));

  // Elevation is written into the footer's product info as "ELEVATION: 0.5°".
  const info = document.getElementById('extraProductInfo');
  const raw = info ? (info.textContent || '') : '';
  const m = raw.match(/([-\d.]+)\s*°/);
  setField('vxpro-elev', m ? m[1] + '°' : '—');

  setField('vxpro-scan', text('top-right'));

  const pill = document.getElementById('vortexAlertPill');
  const count = document.getElementById('vortexAlertCount');
  if (pill && count) {
    const n = parseInt((count.textContent || '').replace(/[^0-9]/g, ''), 10);
    pill.classList.toggle('vxpro-hot', Number.isFinite(n) && n > 0);
  }
}

function pumpClock() {
  const d = new Date();
  setField('vxpro-clock',
    String(d.getUTCHours()).padStart(2, '0') + ':' +
    String(d.getUTCMinutes()).padStart(2, '0') + ':' +
    String(d.getUTCSeconds()).padStart(2, '0') + 'Z');
}

/*
 * Cursor position, the readout that most marks this out as an analysis tool
 * rather than a viewer. Degrees to three places is about 100 m, which is the
 * useful limit for reading a feature off a radar image; more digits would just
 * be noise that never settles.
 */
function wireCursor() {
  const m = window.vortexMap && window.vortexMap.map;
  if (!m) return false;
  const fmt = (v, pos, neg) =>
    Math.abs(v).toFixed(3) + '° ' + (v >= 0 ? pos : neg);
  m.on('mousemove', (e) => {
    setField('vxpro-cursor', fmt(e.lngLat.lat, 'N', 'S') + '  ' + fmt(e.lngLat.lng, 'E', 'W'));
  });
  m.on('mouseout', () => setField('vxpro-cursor', '—'));
  return true;
}

/*
 * Frame counter, read off the timeline the player already drives. Told as
 * "4 / 10" because during a loop the question is how far through it is, not
 * what percentage the slider is at.
 */
function wireFrames() {
  const slider = document.getElementById('vortexTimeline');
  if (!slider) return;
  const show = () => {
    const max = Number(slider.max) || 0;
    const val = Number(slider.value) || 0;
    setField('vxpro-frame-n', max > 0 ? (val + 1) + ' / ' + (max + 1) : '—');
  };
  slider.addEventListener('input', show);
  slider.addEventListener('change', show);
  // The player moves the slider programmatically, which fires no event.
  setInterval(show, 500);
  show();
}

/*
 * Mapbox measures its canvas when the window resizes. The frame changes the
 * map's rectangle without a resize event, so it has to be told, or the canvas
 * keeps its full-screen size and the right-hand edge of the radar is drawn
 * underneath the dock.
 */
function resizeMap() {
  const m = window.vortexMap && window.vortexMap.map;
  if (m && m.resize) m.resize();
  const d = window.vortexMap && window.vortexMap.dualMap;
  if (d && d.resize) d.resize();
}

/* ── boot ─────────────────────────────────────────────────────────────────── */

function loadStylesheet() {
  if (document.getElementById('vxpro-css')) return;
  const link = document.createElement('link');
  link.id = 'vxpro-css';
  link.rel = 'stylesheet';
  // Appended to head last, so it lands after index.css and can override the
  // mobile geometry rules at the end of that file.
  link.href = './components/pro_skin.css?v=proui1';
  document.head.appendChild(link);
}

let built = false;
async function build(orgName) {
  if (built) return;
  built = true;

  // The controls this skin re-homes are created by the app's own boot. There
  // is nothing to move until they exist.
  await waitFor(() => document.getElementById('vortexBarIcons') && document.getElementById('vortexPlayBtn'));

  buildTop();
  buildDock();
  buildStatus();

  const org = document.getElementById('vxpro-org');
  if (org && orgName) org.textContent = orgName;

  pumpReadouts();
  pumpClock();
  setInterval(pumpReadouts, 1000);
  setInterval(pumpClock, 1000);
  wireFrames();

  // The map may not be constructed yet when this runs.
  if (!wireCursor()) waitFor(() => window.vortexMap && window.vortexMap.map).then(wireCursor);

  resizeMap();
  // Split screen re-divides the map, and the dock changes what "half" means.
  window.addEventListener('vortexsplitchange', () => {
    document.documentElement.classList.toggle('vx-pro-split', document.body.classList.contains('vortex-split'));
    setTimeout(resizeMap, 60);
  });
  setTimeout(resizeMap, 400);
}

async function init() {
  const guess = rememberedGuess();
  if (guess) { document.documentElement.classList.add(CLASS); loadStylesheet(); }

  let org = null;
  let ok = false;
  try {
    const r = await fetch('/auth/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (r.ok) {
      const j = await r.json();
      // proUi, not org: an administrator holds no licence of their own
      // but must still see the interface they hand out.
      ok = !!(j.user && j.user.proUi);
      org = ok ? j.user.proUi.name : null;
    }
  } catch (e) { ok = guess; }   // offline: keep whatever we optimistically applied

  remember(ok);
  if (!ok) {
    // Not licensed (or no longer): make sure nothing from the guess is left.
    document.documentElement.classList.remove(CLASS);
    const css = document.getElementById('vxpro-css');
    if (css) css.remove();
    return;
  }

  document.documentElement.classList.add(CLASS);
  loadStylesheet();
  build(org);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

export { licensed };
