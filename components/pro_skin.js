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

import { installRadarFurniture } from './pro_radar.js?v=proui4';

const CLASS = 'vx-pro';
const REMEMBER = 'vortex_pro_ui';     // last known answer, to avoid a flash

/*
 * Labels for the tools the consumer UI never had to name, because they were
 * icons in a row with a tooltip at most. In a written list they need words.
 * Keyed by element id so this survives the icons being restyled.
 */
const TOOL_NAMES = {
  stationMenuItemDiv: 'Radar Sites',
  alertMenuItemDiv: 'Warnings & Watches',
  metarStationMenuItemDiv: 'Surface Observations',
  colorPickerItemDiv: 'Colour Tables',
  drawMenuItemDiv: 'Draw',
  settingsItemDiv: 'Settings',
};


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

const setField = (id, v) => {
  const n = document.querySelector('#' + id + ' .v');
  if (!n) return;
  if (n.textContent !== v) n.textContent = v;
  // Dim a readout that has nothing in it yet, so a waiting instrument does not
  // look like a broken one.
  n.classList.toggle('vxpro-empty', !v || v === '—');
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

/*
 * The title bar.
 *
 * GRLevel3 puts the site and its location in the window title — "KEWX San
 * Antonio, TX - GRLevel3" — not in a strip of captioned readout cells. The
 * captions were the thing that made this read as a web dashboard: five
 * uppercase micro-labels across the top is a design language from analytics
 * pages, and no radar console has ever had one. The same facts are already
 * burned into the corners of the image, which is where an operator reads them.
 */
function buildTop() {
  const top = el('div');
  top.id = 'vxpro-title';

  const name = el('div');
  name.id = 'vxpro-titletext';
  name.innerHTML = '<b id="vxpro-tsite"></b><span id="vxpro-tloc"></span>' +
    '<span class="vxpro-tapp">Vortex Pro</span>';
  top.appendChild(name);

  const right = el('div');
  right.id = 'vxpro-titleright';
  right.innerHTML = '<span class="vxpro-org" id="vxpro-org"></span>';
  top.appendChild(right);

  document.body.appendChild(top);

  // The alert counter is a title-bar indicator, not a floating pill.
  const pill = document.getElementById('vortexAlertPill');
  if (pill) right.appendChild(pill);

  return top;
}

function buildDock() {
  const dock = el('div');
  dock.id = 'vxpro-dock';

  const section = (caption, grows, cls) => {
    const s = el('div', 'vxpro-sec' + (grows ? ' grow' : '') + (cls ? ' ' + cls : ''));
    const c = el('div', 'vxpro-cap');
    c.textContent = caption;
    const b = el('div', 'vxpro-body');
    s.appendChild(c);
    s.appendChild(b);
    dock.appendChild(s);
    return b;
  };

  const source = section('Radar', false, 'vxpro-sec-radar');
  const tools = section('Tools', true, 'vxpro-sec-tools');
  const scale = section('Colour Scale', false, 'vxpro-sec-scale');

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
   * The tool rail, relabelled.
   *
   * Most buttons carry a title attribute and that is the label. Six do not —
   * they were only ever meant to be icons in a row — and they came through as
   * blank rows, two of them showing as a bare coloured blob because the app
   * marks them active. Those six are named here. A tool added later without a
   * title lands in this same gap, so it falls back to its element id rather
   * than to nothing, which is ugly but findable.
   */
  const rail = document.getElementById('vortexBarIcons');
  if (rail) {
    for (const item of [...rail.children]) {
      const named = TOOL_NAMES[item.id];
      const label = (named || item.getAttribute('title') || item.textContent || item.id || '').trim();
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

/*
 * The status bar.
 *
 * GRLevel3's is a row of sunken Win32 cells carrying values and nothing else:
 * "304.2° / 144.8 nm", "21609 ft", "912 meters/pixel". No captions — the
 * operator knows what an azimuth looks like, and a caption on every cell is
 * six words of chrome competing with the six numbers that matter. Each cell
 * carries its label as a tooltip instead.
 */
function buildStatus() {
  const bar = el('div');
  bar.id = 'vxpro-status';

  bar.appendChild(cell('vxpro-frame-n', 'Frame', 86));
  bar.appendChild(cell('vxpro-scan', 'Time since scan', 96));

  const spacer = el('div');
  spacer.id = 'vxpro-spacer';
  bar.appendChild(spacer);

  document.body.appendChild(bar);
  return bar;
}

/*
 * One sunken readout cell. Fixed width, monospaced and tabular, so a value
 * that changes every frame does not shuffle its neighbours along the bar.
 */
function cell(id, title, width) {
  const c = el('div', 'vxpro-cell');
  c.id = id;
  c.title = title;
  if (width) c.style.width = width + 'px';
  const v = el('span', 'v');
  v.textContent = '—';
  c.appendChild(v);
  return c;
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
    return t;
  };

  // Title bar: "KFFC  Atlanta   Vortex Pro", the way a console names its window.
  const site = text('radarStation');
  const loc = text('radarLocation');
  const ts = document.getElementById('vxpro-tsite');
  const tl = document.getElementById('vxpro-tloc');
  if (ts && ts.textContent !== site) ts.textContent = site;
  if (tl && tl.textContent !== loc) tl.textContent = loc;

  setField('vxpro-frame-n', frameText());
  setField('vxpro-scan', text('top-right') || '—');

  const pill = document.getElementById('vortexAlertPill');
  const count = document.getElementById('vortexAlertCount');
  if (pill && count) {
    const n = parseInt((count.textContent || '').replace(/[^0-9]/g, ''), 10);
    pill.classList.toggle('vxpro-hot', Number.isFinite(n) && n > 0);
  }
}

/* "4 / 10" — how far through the loop, not what percent the slider is at. */
function frameText() {
  const slider = document.getElementById('vortexTimeline');
  if (!slider) return '—';
  const max = Number(slider.max) || 0;
  const val = Number(slider.value) || 0;
  return max > 0 ? (val + 1) + ' / ' + (max + 1) : '—';
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
  link.href = './components/pro_skin.css?v=proui4';
  document.head.appendChild(link);

  // The radar furniture's own sheet, loaded after so its re-cut of the frame
  // geometry (it takes height for the moment strip and width for the colour
  // bar) lands on top of pro_skin.css rather than under it.
  const radar = document.createElement('link');
  radar.id = 'vxpro-radar-css';
  radar.rel = 'stylesheet';
  radar.href = './components/pro_radar.css?v=proui4';
  document.head.appendChild(radar);

  // The window chrome, last: it supersedes the header and status styling in
  // both sheets above with the Win32 idiom a radar console actually uses.
  const chrome = document.createElement('link');
  chrome.id = 'vxpro-chrome-css';
  chrome.rel = 'stylesheet';
  chrome.href = './components/pro_chrome.css?v=proui4';
  document.head.appendChild(chrome);
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

  /*
   * The radar furniture — moment bar, vertical colour scale, on-image
   * annotation, range rings, azimuth/range readouts. Kept in its own module
   * because it is about reading a radar, while everything above is about
   * framing a window. Guarded: a failure there must leave the frame standing
   * rather than take the whole interface down with it.
   */
  try {
    installRadarFurniture({ setField, cell });
  } catch (e) {
    console.error('[PRO] radar furniture failed to install:', e);
  }

  pumpReadouts();
  pumpClock();
  setInterval(pumpReadouts, 1000);
  setInterval(pumpClock, 1000);

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
    for (const id of ['vxpro-css', 'vxpro-radar-css', 'vxpro-chrome-css']) {
      const n2 = document.getElementById(id);
      if (n2) n2.remove();
    }
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
