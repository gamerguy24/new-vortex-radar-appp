/*
 * components/pro_radar.js
 * The radar-analysis furniture for the professional interface.
 *
 * pro_skin.js builds the frame — dock, top strip, status bar. This adds the
 * things that make it read as an ANALYSIS TOOL rather than a viewer with a
 * dark theme, taking GRLevel3 as the reference:
 *
 *   · a moment bar, where the products ARE the menu (BR, BV, SRV, CC, ...)
 *   · the colour scale stood on its end at the left edge of the image
 *   · corner annotations burned into the map: site and VCP, product and
 *     elevation, scan time
 *   · range rings at 50/100/150/200 nm from the antenna
 *   · a status bar that answers "what is under my cursor" in radar terms:
 *     azimuth and range from the site, beam height, and the image scale
 *
 * NOTHING HERE RE-IMPLEMENTS PRODUCT LOADING.
 * The moment buttons find the matching row in the app's own product menu and
 * click it. That row already carries the handler that resolves the tilt,
 * updates the footer, resets the animation loop and calls the right loader —
 * several hundred lines of behaviour that would be wrong to duplicate and
 * worse to fork. If a product is added to the menu, adding its code to MOMENTS
 * below is the whole integration.
 */

/*
 * The moments, in GRLevel3's own order and abbreviations. `value` matches the
 * value attribute on the app's product rows.
 *
 * The abbreviations are the point: an operator who has used GR3, GR2Analyst or
 * a WSR-88D console reads BR/BV/SRV without thinking, and "Super-Res Storm
 * Relative Velocity" is four words they have to parse first. The full name is
 * still there as the tooltip and in the top strip readout.
 */
const MOMENTS = [
  { code: 'BR',  value: 'ref',   name: 'Base Reflectivity' },
  { code: 'BV',  value: 'vel',   name: 'Base Velocity' },
  { code: 'SRV', value: 'srvel', name: 'Storm Relative Velocity' },
  { code: 'CC',  value: 'rho',   name: 'Correlation Coefficient' },
  { code: 'ZDR', value: 'zdr',   name: 'Differential Reflectivity' },
  { code: 'KDP', value: 'kdp',   name: 'Specific Differential Phase' },
  { code: 'HCA', value: 'hyc',   name: 'Hydrometeor Classification' },
  { code: 'VIL', value: 'vil',   name: 'Vertically Integrated Liquid' },
];


/*
 * The menus, and what goes in each.
 *
 * GRLevel3 has NO left sidebar. Its whole interface is a menu bar, the colour
 * scale against the image, and a status bar — which is why a 234px dock of
 * icon-and-label rows was the last thing making this read as a web app, no
 * matter how the rows were styled.
 *
 * Every entry here is an element id from the app's own tool rail. The nodes are
 * MOVED into these dropdowns, so each keeps the click handler, tier gate and
 * active-state class it already had. Anything in the rail that is not listed
 * lands in Tools, so a tool added later appears in a menu rather than vanishing
 * with the dock.
 */
const MENUS = [
  { label: 'Site', items: ['stationMenuItemDiv', 'vortexLocateBtn', 'vortexLocationsBtn'] },
  { label: 'View', items: ['alertMenuItemDiv', 'metarStationMenuItemDiv', 'colorPickerItemDiv', 'drawMenuItemDiv'] },
  { label: 'Tools', items: ['mstMenuItemDiv', 'vortexSplitBtn', 'soundingMenuItemDiv', 'vortexModelsBtn'] },
  { label: 'Graphics', items: ['vortexGraphicsBtn', 'warnGraphicBtn'] },
  { label: 'Comms', items: ['streamHubMenuItemDiv', 'vortexScannerBtn', 'vortexFeaturedBtn'] },
  {
    label: 'Window',
    // The desk is the other half of this licence and nothing else points at it.
    links: [{ label: 'Warning Desk', href: '/pro', icon: 'fa-table-columns' }],
    items: ['settingsItemDiv'],
  },
];

const RINGS_NM = [50, 100, 150, 200];
const NM_TO_M = 1852;

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

/* ── moment bar ───────────────────────────────────────────────────────────── */

/*
 * The menu bar and the toolbar, as two rows, the way a Win32 application
 * stacks them.
 *
 * GRLevel3's menu bar IS the product list — File View Site BR BV SRV SW ZDR CC
 * KDP HCA — plain text items with a hover highlight and no borders. The filled
 * blue buttons this had before were the single most "web app" thing on the
 * screen; a menu bar does not have buttons in it.
 *
 * The toolbar underneath carries what you operate rather than what you choose:
 * frame transport, elevation, and the search.
 */
function buildMoments() {
  const menu = el('div');
  menu.id = 'vxpro-menu';

  // A Site item first, opening the app's own radar-site picker, so the menu
  // bar reads the way GR3's does rather than starting abruptly at BR.
  const site = el('div', 'vxpro-menuitem');
  site.textContent = 'Site';
  site.addEventListener('click', () => {
    const b2 = document.getElementById('stationMenuItemDiv');
    if (b2) b2.click();
  });
  menu.appendChild(site);

  for (const m of MOMENTS) {
    const it = el('div', 'vxpro-menuitem vxpro-moment');
    it.textContent = m.code;
    it.title = m.name;
    it.dataset.value = m.value;
    it.addEventListener('click', () => {
      /*
       * Drive the app's own product row. jQuery binds with addEventListener,
       * so a native .click() reaches its handler — and that handler tests
       * e.target against the row itself, which is why the row is clicked
       * rather than anything inside it.
       */
      const row = document.querySelector('.psmRow[value="' + m.value + '"]');
      if (!row) {
        it.classList.add('vxpro-moment-missing');
        setTimeout(() => it.classList.remove('vxpro-moment-missing'), 800);
        return;
      }
      row.click();
    });
    menu.appendChild(it);
  }

  const products = el('div', 'vxpro-menuitem');
  products.textContent = 'All Products';
  products.addEventListener('click', () => {
    const t = document.getElementById('productsDropdownTrigger');
    if (t) t.click();
  });
  menu.appendChild(products);

  // The dropdown menus that replace the dock.
  for (const def of MENUS) menu.appendChild(buildMenu(def));

  document.body.appendChild(menu);
  installMenuDismiss();

  /* ── toolbar ── */
  const bar = el('div');
  bar.id = 'vxpro-toolbar';

  // Frame transport, moved up out of the status bar: GR3 keeps its animation
  // controls on the toolbar, and a status bar is for reading, not operating.
  const transport = el('div', 'vxpro-tgroup');
  for (const id of ['vortexPlayBtn', 'vortexTimeline', 'vortexSpeedWrap']) {
    const n = document.getElementById(id);
    if (n) transport.appendChild(n);
  }
  bar.appendChild(transport);
  bar.appendChild(el('div', 'vxpro-sep'));

  const tilts = el('div', 'vxpro-tgroup');
  tilts.id = 'vxpro-tilts';
  tilts.appendChild(el('span', 'vxpro-tilt-cap', 'Tilt'));
  for (let i = 1; i <= 4; i++) {
    const t = el('button', 'vxpro-tilt');
    t.textContent = String(i);
    t.title = 'Elevation tilt ' + i;
    t.dataset.tilt = String(i);
    t.addEventListener('click', () => setTilt(i));
    tilts.appendChild(t);
  }
  bar.appendChild(tilts);

  document.body.appendChild(bar);
  sweepUnclaimed();
  return menu;
}

/*
 * One drop-down. The tools are moved into it, not copied — appendChild keeps
 * every listener attached, so a menu entry behaves exactly as the dock row did
 * and as the footer icon did before that.
 */
function buildMenu(def) {
  const root = el('div', 'vxpro-menuitem vxpro-hasmenu');
  root.textContent = def.label;

  const pop = el('div', 'vxpro-popup');
  // Entries that are not app tools but pages of our own.
  for (const extra of def.links || []) {
    const row = el('div', 'vxpro-mi');
    row.innerHTML = '<span class="fa ' + extra.icon + '"></span>';
    const t = el('span', 'vxpro-mi-label');
    t.textContent = extra.label;
    row.appendChild(t);
    row.addEventListener('click', () => { window.location.href = extra.href; });
    pop.appendChild(row);
  }
  for (const id of def.items) {
    const node = document.getElementById(id);
    if (!node) continue;
    node.classList.add('vxpro-mi');
    labelFor(node);
    pop.appendChild(node);
  }
  root.appendChild(pop);

  root.addEventListener('click', (e) => {
    // A click on an item inside must not re-toggle the menu it came from.
    if (e.target !== root) { closeMenus(); return; }
    const open = root.classList.contains('vxpro-open');
    closeMenus();
    if (!open) root.classList.add('vxpro-open');
  });
  // Once one menu is open, sliding across the bar opens the next, the way a
  // real menu bar behaves.
  root.addEventListener('mouseenter', () => {
    if (document.querySelector('.vxpro-open') && !root.classList.contains('vxpro-open')) {
      closeMenus();
      root.classList.add('vxpro-open');
    }
  });
  return root;
}

/* Give a moved tool a text label, from its title or the explicit name table. */
function labelFor(node) {
  if (node.querySelector('.vxpro-mi-label')) return;
  const name = MENU_NAMES[node.id] || (node.getAttribute('title') || '').trim() || node.id;
  node.removeAttribute('title');
  const t = el('span', 'vxpro-mi-label');
  t.textContent = name;
  node.appendChild(t);
}

const MENU_NAMES = {
  stationMenuItemDiv: 'Radar Sites…',
  vortexLocateBtn: 'Go to My Location',
  vortexLocationsBtn: 'My Locations…',
  alertMenuItemDiv: 'Warnings & Watches',
  metarStationMenuItemDiv: 'Surface Observations',
  colorPickerItemDiv: 'Colour Tables…',
  drawMenuItemDiv: 'Draw',
  mstMenuItemDiv: 'Manual Storm Track',
  vortexSplitBtn: 'Split Screen',
  soundingMenuItemDiv: 'Sounding',
  vortexModelsBtn: 'Models & Forecast…',
  vortexGraphicsBtn: 'Vortex Graphics…',
  warnGraphicBtn: 'Warning Graphic…',
  streamHubMenuItemDiv: 'Chase Stream Hub…',
  vortexScannerBtn: 'Global PTT',
  vortexFeaturedBtn: 'Featured Streams…',
  settingsItemDiv: 'Settings…',
};

function closeMenus() {
  for (const m of document.querySelectorAll('.vxpro-open')) m.classList.remove('vxpro-open');
}

function installMenuDismiss() {
  if (installMenuDismiss.done) return;
  installMenuDismiss.done = true;
  // Anywhere outside the bar closes it, as does Escape.
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest || !e.target.closest('#vxpro-menu')) closeMenus();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
}

/*
 * Anything in the rail that no menu claimed still needs a home, or a tool
 * added later would disappear when the dock went. They are appended to Tools.
 */
function sweepUnclaimed() {
  const rail = document.getElementById('vortexBarIcons');
  if (!rail || !rail.children.length) return;
  const tools = [...document.querySelectorAll('.vxpro-hasmenu')]
    .find((m) => m.firstChild && m.firstChild.textContent === 'Tools');
  const pop = tools ? tools.querySelector('.vxpro-popup') : null;
  if (!pop) return;
  for (const node of [...rail.children]) {
    node.classList.add('vxpro-mi');
    labelFor(node);
    pop.appendChild(node);
  }
}

/* Switch the loaded product to a different tilt, through the app's own row. */
function setTilt(n) {
  const active = document.querySelector('.vxpro-moment-on');
  const value = active ? active.dataset.value : 'ref';
  const row = document.querySelector('.psmRow[value="' + value + '"]');
  if (!row) return;
  const sel = row.querySelector('.psmRowTiltSelect');
  if (!sel) return;
  sel.textContent = 'Tilt ' + n;
  row.click();
}

/* Light the tilt actually in use, read back from the product row. */
function syncTilts() {
  const active = document.querySelector('.vxpro-moment-on');
  const value = active ? active.dataset.value : null;
  const row = value ? document.querySelector('.psmRow[value="' + value + '"]') : null;
  const sel = row ? row.querySelector('.psmRowTiltSelect') : null;
  const cur = sel ? (sel.textContent || '').split(' ')[1] : null;
  for (const b of document.querySelectorAll('.vxpro-tilt')) {
    b.classList.toggle('vxpro-tilt-on', !!cur && b.dataset.tilt === cur);
  }
}

/*
 * The warning search floats over the middle of the map in the consumer UI. In
 * a docked frame a box hanging in mid-air is the one thing that still looks
 * like a web page, so it is moved into the strip and given a fixed width.
 */
function dockSearch() {
  const box = document.getElementById('vwsearch');
  const bar = document.getElementById('vxpro-toolbar');
  if (!box || !bar || box.dataset.vxproDocked) return !!box;
  box.dataset.vxproDocked = '1';
  bar.appendChild(box);
  return true;
}

/*
 * Light the button matching whatever product is actually loaded, rather than
 * whichever button was last pressed. They differ: the product can change from
 * the app's own menu, from a saved setting, or from a failed load falling back,
 * and a moment bar that highlights a product you are not looking at is worse
 * than one that highlights nothing.
 */
function syncMoments() {
  const shown = (document.getElementById('headerProductName') || {}).textContent || '';
  const s = shown.toLowerCase();
  for (const b of document.querySelectorAll('.vxpro-moment')) {
    const m = MOMENTS.find((x) => x.value === b.dataset.value);
    if (!m) continue;
    // Match on the distinctive words of the product name, so "Super-Res Base
    // Reflectivity" lights BR while "Storm Relative Velocity" does not.
    const key = m.name.toLowerCase();
    let on = s.includes(key);
    if (!on && m.value === 'ref') on = /reflectivity/.test(s) && !/differential/.test(s);
    if (!on && m.value === 'vel') on = /velocity/.test(s) && !/storm relative/.test(s);
    if (!on && m.value === 'srvel') on = /storm relative/.test(s);
    b.classList.toggle('vxpro-moment-on', !!on);
  }
}

/* ── vertical colour scale ────────────────────────────────────────────────── */

/*
 * GRLevel3 stands its colour scale on end against the left edge of the image,
 * and that is not decoration: a radar operator reads a value by eye off the
 * bar beside the pixel they are looking at, and both the bar and the storm are
 * then in the same glance. A horizontal bar under the map is a legend; a
 * vertical one at the edge is an instrument.
 *
 * The app's canvas is drawn horizontally, low value at the left. Rotating it a
 * quarter turn anticlockwise puts high at the top, which is the convention.
 */
function buildColourBar() {
  const wrap = el('div');
  wrap.id = 'vxpro-cbar';
  // The ticks live INSIDE the track. As a sibling they were positioned
  // against the whole strip, so the top number sat on top of the unit label.
  wrap.innerHTML =
    '<div id="vxpro-cbar-title"></div>' +
    '<div id="vxpro-cbar-track">' +
      '<div id="vxpro-cbar-canvas"></div>' +
      '<div id="vxpro-cbar-ticks"></div>' +
    '</div>';
  document.body.appendChild(wrap);

  const canvas = document.getElementById('mapColorScale');
  if (canvas) document.getElementById('vxpro-cbar-canvas').appendChild(canvas);

  sizeColourBar();
  window.addEventListener('resize', sizeColourBar);
  return wrap;
}

/*
 * The rotated canvas is laid out by its unrotated box, so its CSS width has to
 * be set to the height of the strip it is standing in. That is a measurement,
 * not a constant, so it is redone whenever the window changes.
 */
function sizeColourBar() {
  const track = document.getElementById('vxpro-cbar-track');
  const canvas = document.getElementById('mapColorScale');
  if (!track || !canvas) return;
  const h = track.clientHeight;
  if (h > 0) canvas.style.width = h + 'px';
}

function syncColourBar() {
  const title = document.getElementById('vxpro-cbar-title');
  const src = document.getElementById('vortexLegendTitle');
  if (title && src) {
    // "SUPER-RES BASE REFLECTIVITY (DBZ)" -> "DBZ" where a unit is given,
    // because the product name is already in the top strip and on the map.
    const t = (src.textContent || '').trim();
    const unit = (t.match(/\(([^)]+)\)\s*$/) || [])[1];
    title.textContent = unit || t.split(' ').pop() || '';
  }

  const ticks = document.getElementById('vxpro-cbar-ticks');
  const scale = document.getElementById('vortexLegendScale');
  if (!ticks || !scale) return;
  // Bottom-to-top, so the numbers run the same way as the rotated bar.
  const vals = [...scale.children].map((s) => (s.textContent || '').trim());
  const want = vals.slice().reverse().join('|');
  if (ticks.dataset.sig === want) return;
  ticks.dataset.sig = want;
  ticks.innerHTML = '';
  for (const v of vals.slice().reverse()) {
    const t = el('span');
    t.textContent = v;
    ticks.appendChild(t);
  }
}

/* ── on-image annotation ──────────────────────────────────────────────────── */

/*
 * The corner text GRLevel3 burns into each panel. It duplicates what the top
 * strip says, deliberately: an operator watching a storm is looking at the
 * middle of the image, and making them travel to the window chrome to find out
 * which tilt they are on is how the wrong tilt gets read out on air.
 */
function buildOverlay() {
  const o = el('div');
  o.id = 'vxpro-overlay';
  o.innerHTML =
    '<div class="vxpro-ov vxpro-ov-tl"><b id="vxpro-ov-site"></b><span id="vxpro-ov-vcp"></span></div>' +
    '<div class="vxpro-ov vxpro-ov-tr"><span id="vxpro-ov-vt"></span></div>' +
    '<div class="vxpro-ov vxpro-ov-bl"><span id="vxpro-ov-prod"></span></div>';
  document.body.appendChild(o);
  return o;
}

function syncOverlay() {
  const txt = (id) => {
    const n = document.getElementById(id);
    return n ? (n.textContent || '').trim() : '';
  };
  const set = (id, v) => {
    const n = document.getElementById(id);
    if (n && n.textContent !== v) n.textContent = v;
  };

  set('vxpro-ov-site', txt('radarStation'));
  const vcp = txt('radarVCP');
  set('vxpro-ov-vcp', vcp ? vcp : '');
  set('vxpro-ov-vt', txt('top-right'));

  // "HR BR 0.5°" in GR3 terms: the moment code plus the elevation angle.
  const prodName = txt('headerProductName');
  const moment = MOMENTS.find((m) => {
    const s = prodName.toLowerCase();
    if (m.value === 'ref') return /reflectivity/.test(s) && !/differential/.test(s);
    if (m.value === 'vel') return /velocity/.test(s) && !/storm relative/.test(s);
    if (m.value === 'srvel') return /storm relative/.test(s);
    return s.includes(m.name.toLowerCase());
  });
  const info = document.getElementById('extraProductInfo');
  const elev = ((info ? info.textContent : '') || '').match(/([-\d.]+)\s*°/);
  set('vxpro-ov-prod', (moment ? moment.code : prodName) + (elev ? '  ' + elev[1] + '°' : ''));
}

/* ── range rings ──────────────────────────────────────────────────────────── */

let SITES = null;
async function sites() {
  if (SITES) return SITES;
  try {
    const r = await fetch('/api/graphics/radar-sites', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    SITES = {};
    for (const s of j.sites || []) SITES[s.id] = s;
  } catch (e) {
    console.warn('[PRO] radar site table unavailable:', e.message);
    SITES = {};
  }
  return SITES;
}

function currentSite(table) {
  const id = window.vortexData && window.vortexData.currentStation;
  if (!id) return null;
  return table[id] || table[String(id).toUpperCase()] || null;
}

/* A circle of `nm` nautical miles around a point, as a GeoJSON ring. */
function ringAround(lat, lon, nm, steps = 180) {
  const R = 6371008.8;                       // mean Earth radius, metres
  const d = (nm * NM_TO_M) / R;              // angular distance
  const la1 = (lat * Math.PI) / 180;
  const lo1 = (lon * Math.PI) / 180;
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const brg = (i / steps) * 2 * Math.PI;
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg));
    const lo2 = lo1 + Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * Math.sin(la2));
    coords.push([(lo2 * 180) / Math.PI, (la2 * 180) / Math.PI]);
  }
  return coords;
}

function installRings(map) {
  const empty = { type: 'FeatureCollection', features: [] };
  if (map.getSource('vxpro-rings')) return;
  map.addSource('vxpro-rings', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'vxpro-rings-line',
    type: 'line',
    source: 'vxpro-rings',
    paint: {
      'line-color': '#7f8c9b',
      'line-width': 1,
      // Rings are reference, not data. They fade out when zoomed in far
      // enough that they would cross the storm being looked at.
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.28, 11, 0.1],
    },
  });
  map.addLayer({
    id: 'vxpro-rings-label',
    type: 'symbol',
    source: 'vxpro-rings',
    layout: {
      'symbol-placement': 'line',
      'text-field': ['get', 'label'],
      'text-size': 10,
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#93a1b0', 'text-halo-color': 'rgba(0,0,0,0.7)', 'text-halo-width': 1.2 },
  });
}

async function drawRings(map) {
  const table = await sites();
  const site = currentSite(table);
  const src = map.getSource('vxpro-rings');
  if (!src) return;
  if (!site) { src.setData({ type: 'FeatureCollection', features: [] }); return; }

  src.setData({
    type: 'FeatureCollection',
    features: RINGS_NM.map((nm) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: ringAround(site.lat, site.lon, nm) },
      properties: { label: nm + ' nm' },
    })),
  });
}

/* ── cursor readouts ──────────────────────────────────────────────────────── */

/*
 * Great-circle bearing and distance from the antenna to the cursor. This is
 * how a radar image is actually described — "a cell at 240 at 65 miles" — and
 * it is the readout the frame was missing to be usable for anything but
 * looking at.
 */
function azimuthRange(site, lat, lon) {
  const toRad = (d) => (d * Math.PI) / 180;
  const la1 = toRad(site.lat);
  const la2 = toRad(lat);
  const dLo = toRad(lon - site.lon);

  const y = Math.sin(dLo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo);
  let brg = (Math.atan2(y, x) * 180) / Math.PI;
  if (brg < 0) brg += 360;

  const R = 6371008.8;
  const dLa = la2 - la1;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  const metres = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));

  return { azimuth: brg, nm: metres / NM_TO_M, metres };
}

/*
 * Height of the beam centre at that range, for the elevation angle in use.
 *
 * The 4/3 earth model: the standard atmosphere refracts the beam downward, and
 * treating the earth as 4/3 its real radius reproduces that with straight-line
 * geometry. Without it the beam is reported too high — by roughly 3,000 ft at
 * 100 nm — which matters, because whether an operator is looking at a
 * mid-level rotation signature or at cloud depends on this number.
 */
function beamHeightFt(rangeMetres, elevDeg, siteElevM = 0) {
  const R = (4 / 3) * 6371008.8;
  const th = (elevDeg * Math.PI) / 180;
  const h = Math.sqrt(rangeMetres ** 2 + R ** 2 + 2 * rangeMetres * R * Math.sin(th)) - R;
  return (h + siteElevM) * 3.280839895;
}

/** Ground resolution of the display, the way GR3 reports it. */
function metresPerPixel(map) {
  const c = map.getCenter();
  return (156543.03392 * Math.cos((c.lat * Math.PI) / 180)) / Math.pow(2, map.getZoom());
}

function currentElevation() {
  const info = document.getElementById('extraProductInfo');
  const m = ((info ? info.textContent : '') || '').match(/([-\d.]+)\s*°/);
  return m ? parseFloat(m[1]) : 0.5;
}

function wireCursor(map, setField) {
  let table = {};
  sites().then((t) => { table = t; });

  map.on('mousemove', (e) => {
    const { lat, lng } = e.lngLat;
    setField('vxpro-latlon', lat.toFixed(5) + ', ' + lng.toFixed(5));

    const site = currentSite(table);
    if (!site) {
      setField('vxpro-azran', '—');
      setField('vxpro-beam', '—');
      return;
    }
    const ar = azimuthRange(site, lat, lng);
    setField('vxpro-azran', ar.azimuth.toFixed(1) + '° / ' + ar.nm.toFixed(1) + ' nm');
    setField('vxpro-beam', Math.round(beamHeightFt(ar.metres, currentElevation())).toLocaleString() + ' ft');
  });

  map.on('mouseout', () => {
    setField('vxpro-latlon', '—');
    setField('vxpro-azran', '—');
    setField('vxpro-beam', '—');
  });

  const scale = () => setField('vxpro-scale', Math.round(metresPerPixel(map)) + ' m/pixel');
  map.on('zoom', scale);
  map.on('move', scale);
  scale();
}

/* ── entry point ──────────────────────────────────────────────────────────── */

export function installRadarFurniture({ setField, cell }) {
  buildMoments();
  buildColourBar();
  buildOverlay();

  // Status-bar readouts that belong to the radar rather than the frame.
  /*
   * The cursor readouts, in the order GRLevel3 puts them: what is under the
   * pointer relative to the antenna, then how high the beam is there, then
   * where it is on the earth, then the scale of the image.
   */
  const status = document.getElementById('vxpro-status');
  if (status) {
    for (const [id, title, w] of [
      ['vxpro-azran', 'Azimuth / range from the radar', 132],
      ['vxpro-beam', 'Height of the beam centre', 84],
      ['vxpro-latlon', 'Cursor latitude, longitude', 150],
      ['vxpro-scale', 'Image scale', 106],
      ['vxpro-clock', 'UTC', 84],
    ]) {
      status.appendChild(cell(id, title, w));
    }
  }

  const tick = () => { syncMoments(); syncTilts(); syncColourBar(); syncOverlay(); sizeColourBar(); dockSearch(); };
  tick();
  setInterval(tick, 1000);

  const attach = () => {
    const map = window.vortexMap && window.vortexMap.map;
    if (!map) return false;
    const go = () => {
      installRings(map);
      drawRings(map);
      wireCursor(map, setField);
      // The site changes without any event of its own, so the rings are
      // reconciled on a slow timer rather than left pointing at the last one.
      let last = null;
      setInterval(() => {
        const id = window.vortexData && window.vortexData.currentStation;
        if (id !== last) { last = id; drawRings(map); }
      }, 2000);
    };
    if (map.isStyleLoaded()) go();
    else map.once('load', go);
    return true;
  };
  if (!attach()) {
    const t = setInterval(() => { if (attach()) clearInterval(t); }, 200);
    setTimeout(() => clearInterval(t), 30000);
  }
}

export { MOMENTS, azimuthRange, beamHeightFt, ringAround, metresPerPixel };
