/*
 * components/support.js
 * In-app support help desk. A signed-in user can open a ticket and hold a
 * threaded conversation with the admins; admins get an "All tickets" view to
 * triage, reply, and change status. Opened from the "Support" row in the
 * settings menu. Mirrors the overlay pattern used by vortex_account.js.
 *
 * ES module, loaded via a <script type="module"> tag on the main page.
 * (c) 2026 Twistcaster Live Media LLC.
 */

const API = '/api/support';
const CATEGORIES = ['Bug', 'Billing', 'Feature request', 'Account', 'Other'];

let overlay = null;
let me = null;              // current user ({ id, email, isAdmin }) or null
let adminMode = false;      // admins can flip to the all-tickets view
let currentTicketId = null; // open thread, or null on the list view
let unreadTimer = null;

// ─── styles ───────────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
.vrsup-overlay{position:fixed;inset:0;z-index:100000;background:rgba(4,8,16,.72);
  backdrop-filter:blur(6px);display:none;align-items:flex-start;justify-content:center;
  overflow:auto;padding:32px 16px;font-family:'Onest',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.vrsup-overlay.show{display:flex}
.vrsup-card{width:min(720px,96vw);background:rgba(11,18,32,.96);border:1px solid rgba(255,255,255,.12);
  border-radius:16px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.55);color:#e7eef7}
.vrsup-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.vrsup-head h2{margin:0;font-size:1.3em;display:flex;align-items:center;gap:8px}
.vrsup-head h2 i{color:#27beff}
.vrsup-close{background:rgba(0,0,0,.4);color:#fff;cursor:pointer;border:1px solid rgba(255,255,255,.12);
  border-radius:8px;width:34px;height:34px;font-size:1.1em;line-height:1}
.vrsup-close:hover{background:rgba(255,255,255,.08)}
.vrsup-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.vrsup-toolbar input[type=search],.vrsup-toolbar select{padding:8px 10px;background:rgba(0,0,0,.35);
  border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:8px;font-family:inherit;font-size:.9em}
.vrsup-toolbar input[type=search]{flex:1;min-width:160px}
.vrsup-btn{padding:8px 12px;border-radius:8px;cursor:pointer;border:1px solid rgba(255,255,255,.12);
  background:rgba(0,0,0,.35);color:#fff;font-family:inherit;font-size:.9em;width:auto;height:auto}
.vrsup-btn:hover{background:rgba(255,255,255,.08)}
.vrsup-btn.primary{background:#27beff;color:#04121f;border-color:transparent;font-weight:700}
.vrsup-btn.primary:hover{background:#59cfff}
.vrsup-btn:disabled{opacity:.5;cursor:default}
.vrsup-seg{display:flex;gap:6px;margin-bottom:14px}
.vrsup-seg button{flex:1;padding:8px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:.88em;
  border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.3);color:#9db0d0}
.vrsup-seg button.active{background:#132238;color:#7fdcff;border-color:#27beff;font-weight:700}
.vrsup-list{display:flex;flex-direction:column;gap:8px}
.vrsup-item{display:flex;align-items:center;gap:10px;padding:11px 13px;background:rgba(0,0,0,.25);
  border:1px solid rgba(255,255,255,.1);border-radius:11px;cursor:pointer}
.vrsup-item:hover{background:rgba(255,255,255,.05)}
.vrsup-item .body{flex:1;min-width:0}
.vrsup-item .subj{font-weight:700;font-size:.98em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vrsup-item .meta{font-size:.78em;color:rgba(255,255,255,.5);margin-top:2px}
.vrsup-dot{width:8px;height:8px;border-radius:50%;background:#27beff;flex:0 0 auto}
.vrsup-badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.72em;font-weight:700;text-transform:capitalize}
.vrsup-badge.open{background:rgba(39,190,255,.2);color:#27beff}
.vrsup-badge.answered{background:rgba(74,222,128,.18);color:#4ade80}
.vrsup-badge.closed{background:rgba(148,163,184,.2);color:#94a3b8}
.vrsup-cat{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.72em;font-weight:600;
  background:rgba(255,255,255,.08);color:rgba(255,255,255,.7)}
.vrsup-empty{text-align:center;padding:34px;color:rgba(255,255,255,.5);font-size:.92em}
.vrsup-field{margin-bottom:12px;display:flex;flex-direction:column}
.vrsup-field label{font-size:12px;color:#9db0d0;margin-bottom:4px}
.vrsup-field input,.vrsup-field select,.vrsup-field textarea{background:#0f1830;border:1px solid #26324c;
  border-radius:9px;color:#fff;padding:9px 11px;font-size:14px;font-family:inherit}
.vrsup-field textarea{resize:vertical;min-height:120px}
.vrsup-field input:focus,.vrsup-field select:focus,.vrsup-field textarea:focus{outline:none;border-color:#27beff}
.vrsup-thread{display:flex;flex-direction:column;gap:10px;margin:6px 0 14px;max-height:46vh;overflow:auto;padding-right:4px}
.vrsup-msg{max-width:82%;padding:10px 13px;border-radius:12px;font-size:.94em;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
.vrsup-msg.them{align-self:flex-start;background:#0f1830;border:1px solid #1e2a44}
.vrsup-msg.mine{align-self:flex-end;background:#123048;border:1px solid #1c4763}
.vrsup-msg .who{font-size:.74em;font-weight:700;color:#7fdcff;margin-bottom:3px;display:flex;gap:6px;align-items:center}
.vrsup-msg.them .who{color:#9db0d0}
.vrsup-msg .staff{background:rgba(39,190,255,.2);color:#27beff;border-radius:999px;padding:0 6px;font-size:.9em}
.vrsup-msg .when{font-size:.72em;color:rgba(255,255,255,.4);margin-top:4px}
.vrsup-thread-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}
.vrsup-thread-head .subj{font-weight:800;font-size:1.05em}
.vrsup-thread-head .sub{font-size:.8em;color:rgba(255,255,255,.55);margin-top:3px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vrsup-reply{display:flex;flex-direction:column;gap:8px}
.vrsup-reply textarea{background:#0f1830;border:1px solid #26324c;border-radius:9px;color:#fff;
  padding:10px 11px;font-size:14px;font-family:inherit;resize:vertical;min-height:70px}
.vrsup-reply textarea:focus{outline:none;border-color:#27beff}
.vrsup-reply-actions{display:flex;justify-content:space-between;gap:8px}
.vrsup-link{background:none;border:none;color:#7fdcff;cursor:pointer;font-family:inherit;font-size:.9em;padding:4px 0}
.vrsup-link:hover{text-decoration:underline}
#armrSupportBtn .vrsup-menu-badge{display:none;background:#ff3b30;color:#fff;font-size:.7em;font-weight:800;
  border-radius:999px;padding:0 6px;margin-left:6px;vertical-align:middle}
`;
document.head.appendChild(style);

// ─── api helper ───────────────────────────────────────────────────────────────
async function api(method, endpoint, body) {
    const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(API + endpoint, opts);
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => iso ? new Date(iso).toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

function toast(msg, kind) {
    const colors = { info: '#27beff', ok: '#34d399', error: '#f87171' };
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `position:fixed;bottom:96px;left:50%;transform:translateX(-50%);
        background:rgba(11,18,32,.97);color:${colors[kind] || colors.info};
        border:1px solid ${colors[kind] || colors.info};padding:10px 15px;border-radius:10px;
        font-family:'Onest',system-ui,sans-serif;font-size:13px;z-index:100060;
        box-shadow:0 10px 30px rgba(0,0,0,.5);max-width:82vw;text-align:center`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3800);
}

// ─── overlay shell ─────────────────────────────────────────────────────────────
function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'vrsup-overlay';
    overlay.innerHTML = `
        <div class="vrsup-card" role="dialog" aria-modal="true">
            <div class="vrsup-head">
                <h2><i class="fa-solid fa-life-ring"></i> Support</h2>
                <button class="vrsup-close" title="Close">&times;</button>
            </div>
            <div class="vrsup-content"></div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.vrsup-close').addEventListener('click', closeSupport);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSupport(); });
}

function content() { return overlay.querySelector('.vrsup-content'); }

async function openSupport() {
    if (!me) me = await getMe();
    if (!overlay) buildOverlay();
    currentTicketId = null;
    overlay.classList.add('show');
    renderList();
}

function closeSupport() {
    if (overlay) overlay.classList.remove('show');
    refreshBadge();
}

// ─── list view ─────────────────────────────────────────────────────────────────
async function renderList() {
    const c = content();
    const seg = (me && me.isAdmin) ? `
        <div class="vrsup-seg">
            <button data-mode="mine" class="${adminMode ? '' : 'active'}">My tickets</button>
            <button data-mode="all" class="${adminMode ? 'active' : ''}">All tickets (admin)</button>
        </div>` : '';
    const adminTools = (me && me.isAdmin && adminMode) ? `
        <div class="vrsup-toolbar">
            <input type="search" id="vrsup-search" placeholder="Search email or subject…" autocomplete="off" />
            <select id="vrsup-filter">
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="answered">Answered</option>
                <option value="closed">Closed</option>
            </select>
        </div>` : `
        <div class="vrsup-toolbar">
            <div style="flex:1"></div>
            <button class="vrsup-btn primary" id="vrsup-new"><i class="fa-solid fa-plus"></i> New ticket</button>
        </div>`;
    c.innerHTML = seg + adminTools + '<div class="vrsup-list" id="vrsup-list"><div class="vrsup-empty">Loading…</div></div>';

    if (me && me.isAdmin) {
        c.querySelectorAll('.vrsup-seg button').forEach((b) =>
            b.addEventListener('click', () => { adminMode = b.dataset.mode === 'all'; renderList(); }));
    }
    const newBtn = c.querySelector('#vrsup-new');
    if (newBtn) newBtn.addEventListener('click', renderCompose);
    const search = c.querySelector('#vrsup-search');
    const filter = c.querySelector('#vrsup-filter');
    if (search) { let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadList, 250); }); }
    if (filter) filter.addEventListener('change', loadList);

    loadList();
}

async function loadList() {
    const list = content().querySelector('#vrsup-list');
    if (!list) return;
    try {
        let tickets;
        if (me && me.isAdmin && adminMode) {
            const search = content().querySelector('#vrsup-search');
            const filter = content().querySelector('#vrsup-filter');
            const qs = new URLSearchParams();
            if (search && search.value.trim()) qs.set('search', search.value.trim());
            if (filter && filter.value) qs.set('status', filter.value);
            tickets = (await api('GET', '/admin/tickets?' + qs.toString())).tickets;
        } else {
            tickets = (await api('GET', '/tickets')).tickets;
        }
        renderRows(tickets);
    } catch (err) {
        list.innerHTML = `<div class="vrsup-empty">Error: ${esc(err.message)}</div>`;
    }
}

function renderRows(tickets) {
    const list = content().querySelector('#vrsup-list');
    if (!tickets.length) {
        list.innerHTML = `<div class="vrsup-empty">${adminMode && me.isAdmin
            ? 'No tickets match.' : "You haven't opened any tickets yet."}</div>`;
        return;
    }
    list.innerHTML = '';
    tickets.forEach((t) => {
        const row = document.createElement('div');
        row.className = 'vrsup-item';
        const who = (me && me.isAdmin && adminMode) ? ` · ${esc((t.email || '').split('@')[0])}` : '';
        row.innerHTML = `
            ${t.unread ? '<span class="vrsup-dot"></span>' : '<span style="width:8px;flex:0 0 auto"></span>'}
            <div class="body">
                <div class="subj">${esc(t.subject)}</div>
                <div class="meta">
                    <span class="vrsup-cat">${esc(t.category)}</span>
                    &nbsp;${t.messageCount} msg${t.messageCount === 1 ? '' : 's'} · ${fmt(t.updatedAt)}${who}
                </div>
            </div>
            <span class="vrsup-badge ${t.status}">${t.status}</span>`;
        row.addEventListener('click', () => openThread(t.id));
        list.appendChild(row);
    });
}

// ─── compose view ──────────────────────────────────────────────────────────────
function renderCompose() {
    const c = content();
    c.innerHTML = `
        <button class="vrsup-link" id="vrsup-back">← Back to my tickets</button>
        <div class="vrsup-field">
            <label>Subject</label>
            <input type="text" id="vrsup-subj" maxlength="140" placeholder="Short summary of your issue" autocomplete="off" />
        </div>
        <div class="vrsup-field">
            <label>Category</label>
            <select id="vrsup-cat">${CATEGORIES.map((x) => `<option>${x}</option>`).join('')}</select>
        </div>
        <div class="vrsup-field">
            <label>How can we help?</label>
            <textarea id="vrsup-msg" maxlength="5000" placeholder="Describe what's happening, steps to reproduce, and anything you've tried."></textarea>
        </div>
        <div class="vrsup-reply-actions">
            <button class="vrsup-btn" id="vrsup-cancel">Cancel</button>
            <button class="vrsup-btn primary" id="vrsup-submit"><i class="fa-solid fa-paper-plane"></i> Submit ticket</button>
        </div>`;
    c.querySelector('#vrsup-back').addEventListener('click', renderList);
    c.querySelector('#vrsup-cancel').addEventListener('click', renderList);
    c.querySelector('#vrsup-subj').focus();
    c.querySelector('#vrsup-submit').addEventListener('click', async () => {
        const subject = c.querySelector('#vrsup-subj').value.trim();
        const category = c.querySelector('#vrsup-cat').value;
        const body = c.querySelector('#vrsup-msg').value.trim();
        if (!subject) return toast('A subject is required.', 'error');
        if (!body) return toast('Please describe your issue.', 'error');
        const btn = c.querySelector('#vrsup-submit');
        btn.disabled = true;
        try {
            const { ticket } = await api('POST', '/tickets', { subject, category, body });
            toast('Ticket submitted — we\'ll get back to you.', 'ok');
            openThread(ticket.id);
        } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
        }
    });
}

// ─── thread view ───────────────────────────────────────────────────────────────
async function openThread(id) {
    currentTicketId = id;
    const c = content();
    c.innerHTML = '<div class="vrsup-empty">Loading…</div>';
    try {
        const { ticket } = await api('GET', '/tickets/' + id);
        renderThread(ticket);
    } catch (err) {
        c.innerHTML = `<div class="vrsup-empty">Error: ${esc(err.message)}</div>`;
    }
}

function renderThread(t) {
    const c = content();
    const isClosed = t.status === 'closed';
    const backLabel = (me && me.isAdmin && adminMode) ? '← All tickets' : '← My tickets';
    const owner = (me && me.isAdmin && adminMode) ? `<span class="vrsup-cat">${esc((t.email || '').split('@')[0])}</span>` : '';
    c.innerHTML = `
        <button class="vrsup-link" id="vrsup-back">${backLabel}</button>
        <div class="vrsup-thread-head">
            <div>
                <div class="subj">${esc(t.subject)}</div>
                <div class="sub">
                    <span class="vrsup-cat">${esc(t.category)}</span>
                    ${owner}
                    <span>Opened ${fmt(t.createdAt)}</span>
                </div>
            </div>
            <span class="vrsup-badge ${t.status}">${t.status}</span>
        </div>
        <div class="vrsup-thread" id="vrsup-thread"></div>
        <div class="vrsup-reply">
            <textarea id="vrsup-replybox" maxlength="5000" placeholder="${isClosed ? 'Reply to reopen this ticket…' : 'Write a reply…'}"></textarea>
            <div class="vrsup-reply-actions">
                <button class="vrsup-btn" id="vrsup-toggle-status">${isClosed ? 'Reopen ticket' : 'Close ticket'}</button>
                <button class="vrsup-btn primary" id="vrsup-send"><i class="fa-solid fa-paper-plane"></i> Send reply</button>
            </div>
        </div>`;

    const thread = c.querySelector('#vrsup-thread');
    thread.innerHTML = '';
    t.messages.forEach((m) => {
        const div = document.createElement('div');
        div.className = 'vrsup-msg ' + (m.mine ? 'mine' : 'them');
        div.innerHTML = `
            <div class="who">${esc(m.author)}${m.isAdmin ? '<span class="staff">STAFF</span>' : ''}</div>
            ${esc(m.body)}
            <div class="when">${fmt(m.time)}</div>`;
        thread.appendChild(div);
    });
    thread.scrollTop = thread.scrollHeight;

    c.querySelector('#vrsup-back').addEventListener('click', renderList);
    c.querySelector('#vrsup-send').addEventListener('click', async () => {
        const box = c.querySelector('#vrsup-replybox');
        const body = box.value.trim();
        if (!body) return toast('Reply cannot be empty.', 'error');
        const btn = c.querySelector('#vrsup-send');
        btn.disabled = true;
        try {
            const { ticket } = await api('POST', `/tickets/${t.id}/reply`, { body });
            renderThread(ticket);
        } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
        }
    });
    c.querySelector('#vrsup-toggle-status').addEventListener('click', async () => {
        try {
            const { ticket } = await api('POST', `/tickets/${t.id}/status`, { status: isClosed ? 'open' : 'closed' });
            toast(isClosed ? 'Ticket reopened.' : 'Ticket closed.', 'ok');
            renderThread(ticket);
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

// ─── session + menu wiring ─────────────────────────────────────────────────────
async function getMe() {
    try {
        const res = await fetch('/auth/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!res.ok) return null;
        return (await res.json()).user || null;
    } catch { return null; }
}

async function refreshBadge() {
    const badge = document.querySelector('#armrSupportBtn .vrsup-menu-badge');
    if (!badge) return;
    try {
        const { count } = await api('GET', '/unread');
        if (count > 0) { badge.textContent = count; badge.style.display = 'inline-block'; }
        else badge.style.display = 'none';
    } catch { badge.style.display = 'none'; }
}

function wireMenu() {
    const btn = document.getElementById('armrSupportBtn');
    if (!btn) return;
    if (!btn.querySelector('.vrsup-menu-badge')) {
        const b = document.createElement('span');
        b.className = 'vrsup-menu-badge';
        // place the badge right after the label text, before the chevron
        const chevron = btn.querySelector('.armrIconArrowRight');
        if (chevron) btn.insertBefore(b, chevron); else btn.appendChild(b);
    }
    btn.addEventListener('click', () => {
        const menu = document.getElementById('vortexRadarMenu');
        if (menu) menu.style.display = 'none';
        openSupport();
    });
}

window.openVortexSupport = openSupport;

(async function init() {
    me = await getMe();
    if (!me) return; // support is only for signed-in users
    wireMenu();
    refreshBadge();
    // keep the badge fresh while the app is open
    unreadTimer = setInterval(refreshBadge, 60000);
    window.addEventListener('focus', refreshBadge);
})();
