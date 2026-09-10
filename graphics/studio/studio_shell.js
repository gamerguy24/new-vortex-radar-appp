/*
 * studio_shell.js — the broadcast-graphics shell around the Studio.
 *
 * The Studio did its job but looked like a web page: an app bar with text
 * buttons, a list of templates down one side, a properties column down the
 * other. Captivate and Title Live — what this is actually competing with —
 * look like applications: a menu bar, a ribbon of icon buttons, and a
 * workspace of titled panels that can be collapsed and closed.
 *
 * WHAT THIS FILE DOES NOT DO
 * It does not touch studio.js. That file is eleven hundred lines that find
 * their controls by id, and every one of those ids still exists in the markup.
 * The ribbon and the menus FORWARD to the original buttons rather than
 * duplicating a line of their behaviour — Export PNG is still the same button
 * with the same handler, it is simply no longer the thing you click.
 *
 * What it adds that is genuinely new:
 *   · thumbnails in the project list, so the templates can be recognised
 *     rather than read
 *   · a program monitor with a take, which is the distinction every broadcast
 *     tool makes and this one did not: what you are editing versus what is on
 *     air
 */

const $ = (id) => document.getElementById(id);

/* ── forwarding ───────────────────────────────────────────────────────────── */

/*
 * Ribbon and menu actions map to the original controls. Keeping the mapping in
 * one table means a renamed button breaks in one obvious place rather than in
 * four scattered handlers.
 */
const FORWARD = {
  open: 'btn-open',
  save: 'btn-save',
  psd: 'btn-psd',
  reset: 'btn-reset',
  export: 'btn-export',
};

function forward(act) {
  const id = FORWARD[act];
  if (!id) return false;
  const el = $(id);
  if (!el) return false;
  el.click();
  return true;
}

/* ── menu bar ─────────────────────────────────────────────────────────────── */

function closeMenus() {
  for (const m of document.querySelectorAll('.vgs-menu.open')) m.classList.remove('open');
}

function wireMenus() {
  for (const menu of document.querySelectorAll('.vgs-menu')) {
    menu.addEventListener('click', (e) => {
      // A click on a row inside the popup is handled by the delegate below.
      if (e.target !== menu) return;
      const open = menu.classList.contains('open');
      closeMenus();
      if (!open) menu.classList.add('open');
    });
    // Once one menu is open, moving across the bar opens the next — the way a
    // real menu bar behaves.
    menu.addEventListener('mouseenter', () => {
      if (document.querySelector('.vgs-menu.open')) {
        closeMenus();
        menu.classList.add('open');
      }
    });
  }
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest || !e.target.closest('.vgs-menubar')) closeMenus();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
}

/* ── panels ───────────────────────────────────────────────────────────────── */

const panelOf = (name) => document.querySelector('.vgs-panel[data-panel="' + name + '"]');

function togglePanel(name) {
  const p = panelOf(name);
  if (!p) return;
  p.hidden = !p.hidden;
  syncRibbon();
  reflow();
}

function collapsePanel(p) {
  p.classList.toggle('collapsed');
  reflow();
}

function syncRibbon() {
  for (const b of document.querySelectorAll('.vgs-rib[data-panel]')) {
    const p = panelOf(b.dataset.panel);
    b.classList.toggle('on', !!p && !p.hidden);
  }
}

/*
 * The canvas is sized by studio.js against its container. Changing which
 * panels are visible changes that container, and nothing tells it — so nudge
 * the same resize path the window uses.
 */
function reflow() {
  setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
}

function wirePanels() {
  for (const p of document.querySelectorAll('.vgs-panel')) {
    const head = p.querySelector('.vgs-ph');
    if (!head) continue;
    head.addEventListener('click', (e) => {
      const ctl = e.target.closest('[data-ctl]');
      if (!ctl) return;
      if (ctl.dataset.ctl === 'close') { p.hidden = true; syncRibbon(); reflow(); }
      else collapsePanel(p);
    });
  }
}

/* ── tool belt: docked by default ─────────────────────────────────────────── */

/*
 * The tool belt floated over the canvas, and toolbelt_drag.js clamps it to the
 * stage — so it could be moved around the graphic but never off it. Whatever
 * you were working on, something was underneath the bar. On a 1080-wide
 * preview it also wrapped onto two rows, covering even more.
 *
 * Docked into a strip above the preview it covers nothing at all. Floating is
 * still there for anyone who prefers it — double-click the ⠿ handle to switch
 * — because the drag code is good and somebody will want the bar over the
 * canvas while they paint near the top edge.
 */
const DOCK_KEY = 'vortexStudioToolbeltDocked';
const DRAG_KEY = 'vortexStudioToolbeltPos';   // owned by toolbelt_drag.js

const wantsDock = () => {
  try { return localStorage.getItem(DOCK_KEY) !== '0'; } catch (e) { return true; }
};
const rememberDock = (on) => {
  try { localStorage.setItem(DOCK_KEY, on ? '1' : '0'); } catch (e) {}
};

/* Strip the inline geometry toolbelt_drag.js writes, so CSS governs again. */
function clearFloatStyles(bar) {
  bar.style.left = bar.style.top = bar.style.right = bar.style.bottom = bar.style.transform = '';
}

function dockToolbelt() {
  const bar = $('toolbelt');
  const dock = $('vgs-toolsdock');
  if (!bar || !dock) return;
  dock.appendChild(bar);
  bar.classList.add('vgs-docked');
  clearFloatStyles(bar);
  /*
   * Drop the remembered floating position too. toolbelt_drag.js restores it on
   * a requestAnimationFrame, which can land after this runs — leaving the bar
   * absolutely positioned inside a static strip, i.e. back over the canvas.
   */
  try { localStorage.removeItem(DRAG_KEY); } catch (e) {}
  requestAnimationFrame(() => clearFloatStyles(bar));
  rememberDock(true);
  holdDock();
  reflow();
}

/*
 * Keep it docked for the first few seconds.
 *
 * Two other pieces of code write to this element after load — toolbelt_drag.js
 * restores a saved position on a requestAnimationFrame, and studio.js reveals
 * tool groups as a template needs them — and the ordering between them and
 * this module is not something either side guarantees. Rather than reason
 * about whose frame lands last, check the outcome a few times while the page
 * settles and put it back if it escaped. It stops on its own; it is not a
 * permanent timer.
 */
function holdDock() {
  const dock = $('vgs-toolsdock');
  if (!dock) return;
  let n = 0;
  const t = setInterval(() => {
    const bar = $('toolbelt');
    if (!bar || !bar.classList.contains('vgs-docked')) { clearInterval(t); return; }
    if (bar.parentElement !== dock) dock.appendChild(bar);
    if (bar.style.left || bar.style.top || bar.style.transform) clearFloatStyles(bar);
    if (++n >= 12) clearInterval(t);      // ~3s, then leave it alone
  }, 250);
}

function floatToolbelt() {
  const bar = $('toolbelt');
  const stage = document.querySelector('.vgs-stagewrap .stage');
  if (!bar || !stage) return;
  bar.classList.remove('vgs-docked');
  stage.appendChild(bar);
  clearFloatStyles(bar);        // back to the CSS default: top-centre
  rememberDock(false);
  reflow();
}

function toggleToolbelt() {
  if ($('toolbelt') && $('toolbelt').classList.contains('vgs-docked')) floatToolbelt();
  else dockToolbelt();
}

function wireToolbelt() {
  const bar = $('toolbelt');
  const handle = $('tb-drag');
  if (!bar) return;

  if (wantsDock()) dockToolbelt();
  else bar.classList.remove('vgs-docked');

  if (handle) {
    handle.title = 'Double-click to dock or float this bar · drag to move it when floating';
    // Capture, so this runs before toolbelt_drag.js's own dblclick reset.
    handle.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleToolbelt();
    }, true);
    /*
     * Dragging a docked bar pops it out first, so the gesture does something
     * sensible instead of nothing. The drag itself is toolbelt_drag.js's job;
     * it only works on an absolutely positioned bar, which floating restores.
     */
    handle.addEventListener('pointerdown', () => {
      if (bar.classList.contains('vgs-docked')) floatToolbelt();
    }, true);
  }
}

/* ── program monitor ──────────────────────────────────────────────────────── */

/*
 * Take: copy what is in the preview to the program monitor.
 *
 * Every broadcast tool separates the two — what you are building from what is
 * currently on air — and the Studio had no such idea, which is why its
 * "preview" was really just "the canvas". A take is a snapshot rather than a
 * live mirror: that is the point. Editing after a take must not change what is
 * already out.
 */
function take() {
  const canvas = $('stage-canvas');
  const img = $('vgs-program-img');
  const empty = $('vgs-program-empty');
  if (!canvas || !img) return;
  try {
    img.src = canvas.toDataURL('image/png');
    img.hidden = false;
    if (empty) empty.hidden = true;
    const meta = $('vgs-program-meta');
    if (meta) {
      meta.textContent = '[' + canvas.width + ' × ' + canvas.height + ']  ' +
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    const tally = $('vgs-tally');
    if (tally) { tally.textContent = 'ON AIR'; tally.classList.add('live'); }
  } catch (e) {
    console.warn('[studio] take failed:', e.message);
  }
}

function clearProgram() {
  const img = $('vgs-program-img');
  const empty = $('vgs-program-empty');
  if (img) { img.hidden = true; img.removeAttribute('src'); }
  if (empty) empty.hidden = false;
  const meta = $('vgs-program-meta');
  if (meta) meta.textContent = '[no source]';
  const tally = $('vgs-tally');
  if (tally) { tally.textContent = 'OFF AIR'; tally.classList.remove('live'); }
}

/* ── project list thumbnails ──────────────────────────────────────────────── */

/*
 * A thumbnail per project row.
 *
 * Rendering all nine templates up front would mean driving the scene through
 * nine full builds before the operator can touch anything, and the scene is
 * shared mutable state — doing that at startup risks leaving it somewhere
 * unexpected. So a row's thumbnail is captured from the real canvas the first
 * time that template is selected, which costs nothing extra and is always an
 * accurate picture of what the template currently produces. Rows not yet
 * visited show their monogram, which is what the list showed before anyway.
 *
 * Refresh previews (in the panel footer) walks every template deliberately,
 * for an operator who wants the whole board populated.
 */
const thumbs = new Map();          // template id -> data URL

function activeRow() {
  return document.querySelector('#template-rail .rail-item.active');
}

function idOfRow(row) {
  // studio.js does not stamp the id on the row, but the order matches
  // TEMPLATES, so the index is the link.
  const rows = [...document.querySelectorAll('#template-rail .rail-item')];
  return String(rows.indexOf(row));
}

function captureActive() {
  const canvas = $('stage-canvas');
  const row = activeRow();
  if (!canvas || !row || !canvas.width) return;
  try {
    const t = document.createElement('canvas');
    t.width = 96; t.height = 54;
    const ctx = t.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, t.width, t.height);
    const url = t.toDataURL('image/png');
    thumbs.set(idOfRow(row), url);
    paintThumb(row, url);
  } catch (e) { /* a tainted canvas is not worth breaking the shell over */ }
}

function paintThumb(row, url) {
  let slot = row.querySelector('.vgs-thumb');
  if (!slot) {
    slot = document.createElement('span');
    slot.className = 'vgs-thumb';
    row.appendChild(slot);
  }
  slot.style.backgroundImage = 'url(' + url + ')';
  slot.classList.add('has');
}

/*
 * Give every row its thumbnail slot and take button. studio.js rebuilds the
 * list whenever the template changes, so this runs again each time — hence the
 * cache, and hence appending only what is missing.
 */
function decorateRows() {
  const rows = [...document.querySelectorAll('#template-rail .rail-item')];
  rows.forEach((row, i) => {
    if (!row.querySelector('.vgs-thumb')) {
      const slot = document.createElement('span');
      slot.className = 'vgs-thumb';
      row.appendChild(slot);
    }
    const cached = thumbs.get(String(i));
    if (cached) paintThumb(row, cached);

    if (!row.querySelector('.vgs-take-row')) {
      const b = document.createElement('button');
      b.className = 'vgs-take-row';
      b.title = 'Select this graphic and take it to program';
      b.textContent = '▶';
      b.addEventListener('click', (e) => {
        // The row's own click selects the template; let it, then take once the
        // render has settled.
        e.stopPropagation();
        row.click();
        setTimeout(take, 700);
      });
      row.appendChild(b);
    }
  });
  const status = $('vgs-status-template');
  const act = activeRow();
  if (status && act) {
    const t = act.querySelector('.ri-title');
    status.textContent = t ? t.textContent : '—';
  }
}

/*
 * Walk every template, letting each render, and capture its thumbnail. The
 * operator's selection is restored at the end.
 */
async function refreshAllThumbs(btn) {
  const rows = [...document.querySelectorAll('#template-rail .rail-item')];
  if (!rows.length) return;
  const startIndex = rows.indexOf(activeRow());
  if (btn) { btn.disabled = true; btn.textContent = 'Rendering…'; }

  for (let i = 0; i < rows.length; i++) {
    // The list is rebuilt on every selection, so re-query each time.
    const fresh = [...document.querySelectorAll('#template-rail .rail-item')][i];
    if (!fresh) continue;
    fresh.click();
    await new Promise((r) => setTimeout(r, 900));   // let the scene settle
    captureActive();
  }
  if (startIndex >= 0) {
    const back = [...document.querySelectorAll('#template-rail .rail-item')][startIndex];
    if (back) back.click();
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Refresh previews'; }
}

/* ── wiring ───────────────────────────────────────────────────────────────── */

function runAction(act, srcEl) {
  if (act === 'take') return take();
  if (act === 'clearprogram') return clearProgram();
  if (act === 'thumbs') return refreshAllThumbs(srcEl);
  if (act === 'fit') return reflow();
  if (act === 'about') {
    window.alert('Vortex Graphics Studio\n\nBroadcast graphics rendered from official data, ' +
      'deterministically — the same numbers the radar page uses.');
    return;
  }
  forward(act);
}

function wireActions() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act], .vgs-rib[data-panel], .vgs-mi[data-panel]');
    if (!el) return;
    if (el.dataset.act) {
      closeMenus();
      runAction(el.dataset.act, el);
      return;
    }
    if (el.dataset.panel) {
      closeMenus();
      togglePanel(el.dataset.panel);
    }
  });
}

/* Mirror the stage hint into the status bar, where a status line belongs. */
function wireHint() {
  const src = $('stage-hint');
  const dst = $('stage-hint-mirror');
  if (!src || !dst) return;
  const copy = () => {
    const t = (src.textContent || '').trim();
    if (dst.textContent !== t) dst.textContent = t;
  };
  new MutationObserver(copy).observe(src, { childList: true, characterData: true, subtree: true });
  copy();
}

/* Show the output raster in the preview header, the way a monitor names it. */
function wirePreviewMeta() {
  const sel = $('canvas-size');
  const meta = $('vgs-preview-meta');
  if (!sel || !meta) return;
  const show = () => { meta.textContent = '[' + sel.value.replace('x', ' × ') + ']'; };
  sel.addEventListener('change', () => { show(); reflow(); });
  show();
}

/*
 * studio.js rebuilds the project list on every template change, which wipes
 * the decorations. Watching the list is how we put them back without asking
 * studio.js to know we exist.
 */
function watchRail() {
  const rail = $('template-rail');
  if (!rail) return;
  let settle = null;
  new MutationObserver(() => {
    decorateRows();
    clearTimeout(settle);
    settle = setTimeout(captureActive, 800);   // capture once the render lands
  }).observe(rail, { childList: true });
  decorateRows();
  setTimeout(captureActive, 1200);
}

function boot() {
  wireMenus();
  wirePanels();
  wireToolbelt();
  wireActions();
  wireHint();
  wirePreviewMeta();
  watchRail();
  syncRibbon();
  clearProgram();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

export { take, clearProgram, dockToolbelt, floatToolbelt };
