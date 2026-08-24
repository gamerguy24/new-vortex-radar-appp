/*
 * menu_accordion.js
 * Turns the main menu's section headers into collapsible groups so the (long)
 * menu is short and scannable — click a header to expand/collapse the rows
 * under it. The big layer groups start collapsed; state is remembered per device.
 *
 * Carefully preserves rows that are intentionally hidden (e.g. the admin / Pro
 * rows use inline display:none) by only restoring display it previously hid.
 */

const SCREEN_ID = 'vortexRadarMenuMainScreen';
const KEY = 'vortexMenuAccordion';

// Groups collapsed by default (the bulk of the length). Everything else stays open.
const DEFAULT_COLLAPSED = new Set([
    'IMAGERY & RADAR', 'SEVERE & FIRE', 'TROPICAL', 'SURFACE & MARINE',
    'REPORTS & SPOTTERS', 'CAMERAS', 'MORE', 'TOOLS',
]);

function loadState() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function saveState(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

function apply(header, members, collapsed) {
    header.classList.toggle('armr-collapsed', collapsed);
    members.forEach((m) => {
        if (collapsed) {
            if (!('accPrev' in m.dataset)) m.dataset.accPrev = m.style.display || '';
            m.style.display = 'none';
        } else if ('accPrev' in m.dataset) {
            m.style.display = m.dataset.accPrev;   // restore exactly what we hid
            delete m.dataset.accPrev;
        }
        // never-collapsed members are left untouched (keeps admin/Pro rows hidden)
    });
}

// ── section activity counts ───────────────────────────────────────────────────
// Each section header shows how many of its layers are currently on, so a
// collapsed group still tells you whether anything under it is running. The
// count element is created here rather than in a separate module on purpose:
// the accordion derives its saved-state key from the header's textContent, so
// anything injected into a header before that read would corrupt the key.
function countMembers(header) {
    let on = 0, total = 0;
    let n = header.nextElementSibling;
    while (n && !n.classList.contains('armrHeader')) {
        const boxes = n.querySelectorAll ? n.querySelectorAll('input[type="checkbox"]') : [];
        boxes.forEach((b) => { total++; if (b.checked) on++; });
        n = n.nextElementSibling;
    }
    return { on, total };
}

function refreshCounts(root) {
    if (!root) return;
    root.querySelectorAll('.armrHeader').forEach((h) => {
        const { on, total } = countMembers(h);
        let el = h.querySelector('.armr-acc-count');
        if (!total) { if (el) el.textContent = ''; return; }
        if (!el) {
            el = document.createElement('span');
            el.className = 'armr-acc-count';
            const chev = h.querySelector('.armr-acc-chev');
            if (chev) h.insertBefore(el, chev); else h.appendChild(el);
        }
        // Empty string collapses the chip (`:empty` in the stylesheet).
        el.textContent = on ? on + ' ON' : '';
    });
}

// Recount after anything the user does in the menu. A click covers the cases a
// change event misses — a switch reset programmatically after a blocked click.
function watchCounts(root) {
    if (!root || root.dataset.countsWatched) return;
    root.dataset.countsWatched = '1';
    const run = () => refreshCounts(root);
    root.addEventListener('change', run, true);
    root.addEventListener('click', () => setTimeout(run, 0), true);
    run();
}

function init() {
    const screen = document.getElementById(SCREEN_ID);
    if (!screen) return;
    const state = loadState();
    const headers = Array.prototype.slice.call(screen.querySelectorAll('.armrHeader'));

    headers.forEach((h) => {
        if (h.dataset.accInit) return;
        h.dataset.accInit = '1';
        const title = (h.textContent || '').trim();

        // Group members = siblings after the header, up to the next header.
        const members = [];
        let n = h.nextElementSibling;
        while (n && !n.classList.contains('armrHeader')) { members.push(n); n = n.nextElementSibling; }

        h.classList.add('armr-acc-header');
        h.setAttribute('role', 'button');
        const chev = document.createElement('span');
        chev.className = 'armr-acc-chev';
        chev.textContent = '▸'; // ▸
        h.appendChild(chev);

        const collapsed = Object.prototype.hasOwnProperty.call(state, title)
            ? !!state[title]
            : DEFAULT_COLLAPSED.has(title);
        apply(h, members, collapsed);

        h.addEventListener('click', () => {
            const nowCollapsed = !h.classList.contains('armr-collapsed');
            apply(h, members, nowCollapsed);
            state[title] = nowCollapsed;
            saveState(state);
        });
    });
}

init();
// Counts run on the main menu (after the accordion has read its titles) and on
// the Settings sub-screen, which has its own layer groups but no accordion.
watchCounts(document.getElementById(SCREEN_ID));
watchCounts(document.getElementById('vortexRadarMenuSettingsScreen'));

module.exports = { init, refreshCounts };
