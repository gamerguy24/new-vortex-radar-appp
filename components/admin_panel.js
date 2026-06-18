/*
 * components/admin_panel.js
 * In-app admin panel. Lists users and lets an admin reset passwords,
 * lock/unlock, delete, or create accounts, and fulfill password-reset requests.
 *
 * (c) 2026 Twistcaster Live Media LLC.
 */

export const adminPanelStyles = `
.admin-panel { display: flex; flex-direction: column; gap: 12px; }
.admin-panel-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.admin-panel-toolbar input[type="search"] {
    flex: 1; min-width: 180px;
    padding: 8px 10px;
    background: rgba(0,0,0,0.35);
    border: 1px solid var(--border-color);
    color: white; border-radius: 8px; font-family: inherit; font-size: 0.95em;
}
.admin-panel-toolbar button {
    padding: 8px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--border-color);
    background: rgba(0,0,0,0.35); color: white;
    font-family: inherit; font-size: 0.9em;
    width: auto; height: auto;
}
.admin-panel-toolbar button.primary {
    background: var(--primary-color); color: #001022;
    border-color: transparent; font-weight: 700;
}
.admin-panel-whoami { font-size: 0.85em; color: rgba(255,255,255,0.6); }
.admin-panel-whoami a { color: var(--primary-color); margin-left: 10px; cursor: pointer; }

.admin-panel-table {
    width: 100%; border-collapse: collapse;
    background: rgba(0,0,0,0.25);
    border: 1px solid var(--border-color);
    border-radius: 10px; overflow: hidden;
    font-size: 0.88em;
}
.admin-panel-table th, .admin-panel-table td {
    padding: 8px 10px; text-align: left;
    border-bottom: 1px solid var(--border-color);
}
.admin-panel-table th { background: rgba(0,0,0,0.35); color: rgba(255,255,255,0.7); font-weight: 600; }
.admin-panel-table tr:last-child td { border-bottom: none; }
.admin-panel-table .actions { display: flex; gap: 4px; flex-wrap: wrap; }
.admin-panel-table .actions button {
    padding: 4px 8px; font-size: 0.78em;
    background: rgba(0,0,0,0.4); color: white;
    border: 1px solid var(--border-color); border-radius: 6px;
    cursor: pointer; width: auto; height: auto;
}
.admin-panel-table .actions button:hover { background: rgba(255,255,255,0.08); }
.admin-panel-table .actions button.danger:hover {
    background: rgba(248,113,113,0.18);
    border-color: #f87171; color: #f87171;
}
.admin-panel-badge {
    display: inline-block; padding: 1px 7px; border-radius: 999px;
    font-size: 0.72em; font-weight: 700; margin-right: 4px;
}
.admin-panel-badge.admin { background: rgba(39,190,255,0.2); color: var(--primary-color); }
.admin-panel-badge.super { background: rgba(124,58,237,0.28); color: #c4b5fd; }
.admin-panel-badge.locked { background: rgba(248,113,113,0.2); color: #f87171; }
.admin-panel-badge.must-change { background: rgba(250,204,21,0.18); color: #facc15; }
.admin-panel-empty { text-align: center; padding: 30px; color: rgba(255,255,255,0.5); }

.admin-panel-pending {
    border: 1px solid rgba(250,204,21,0.4);
    background: rgba(250,204,21,0.07);
    border-radius: 10px;
    padding: 12px;
}
.admin-panel-pending h4 {
    margin: 0 0 8px;
    color: #facc15;
    font-size: 0.95em;
    display: flex; align-items: center; gap: 6px;
}
.admin-panel-pending-empty {
    color: rgba(255,255,255,0.5); font-size: 0.85em;
}
.admin-panel-pending-row {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 0;
    border-top: 1px dashed rgba(255,255,255,0.08);
}
.admin-panel-pending-row:first-of-type { border-top: none; }
.admin-panel-pending-row .who { flex: 1; min-width: 0; }
.admin-panel-pending-row .who .email { font-weight: 600; }
.admin-panel-pending-row .who .when {
    font-size: 0.8em; color: rgba(255,255,255,0.5);
}
.admin-panel-pending-row button {
    padding: 5px 10px; font-size: 0.82em;
    background: rgba(0,0,0,0.4); color: white;
    border: 1px solid var(--border-color); border-radius: 6px;
    cursor: pointer; width: auto; height: auto;
}
.admin-panel-pending-row button.primary {
    background: #facc15; color: #1a1300;
    border-color: transparent; font-weight: 700;
}
.admin-panel-pending-row button.primary:hover { background: #fde047; }

.admin-panel-modal-bg {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6); z-index: 9999;
    display: none; align-items: center; justify-content: center;
}
.admin-panel-modal-bg.show { display: flex; }
.admin-panel-modal {
    background: rgba(15,23,35,0.92);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border-color);
    border-radius: 12px; padding: 22px;
    width: min(420px, 92vw); color: white;
}
.admin-panel-modal h3 { margin: 0 0 6px; font-size: 1.15em; }
.admin-panel-modal p { color: rgba(255,255,255,0.6); margin: 0 0 12px; font-size: 0.88em; }
.admin-panel-modal label { display: block; font-size: 0.82em; color: rgba(255,255,255,0.6); margin: 8px 0 4px; }
.admin-panel-modal input[type="text"],
.admin-panel-modal input[type="email"] {
    width: 100%; padding: 9px 10px; border-radius: 8px;
    background: rgba(0,0,0,0.4); border: 1px solid var(--border-color);
    color: white; font-family: inherit; font-size: 1em;
}
.admin-panel-modal-actions {
    display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;
}
.admin-panel-modal-actions button {
    padding: 7px 13px; border-radius: 8px;
    border: 1px solid var(--border-color);
    background: rgba(0,0,0,0.4); color: white;
    cursor: pointer; font-family: inherit;
    width: auto; height: auto;
}
.admin-panel-modal-actions button.primary {
    background: var(--primary-color); color: #001022;
    border-color: transparent; font-weight: 700;
}
`;

export function createAdminPanelHTML() {
    return `
        <div class="admin-panel">
            <div class="admin-panel-whoami">
                <span id="admin-panel-who">Loading…</span>
                <a id="admin-panel-logout">Sign out</a>
            </div>
            <div class="admin-panel-pending">
                <h4><i class="ti ti-key"></i> Pending password resets</h4>
                <div id="admin-panel-pending-list">
                    <div class="admin-panel-pending-empty">Loading…</div>
                </div>
            </div>
            <div class="admin-panel-toolbar">
                <input type="search" id="admin-panel-search" placeholder="Search by email…" autocomplete="off" />
                <button id="admin-panel-refresh" title="Refresh"><i class="ti ti-refresh"></i></button>
                <button id="admin-panel-new" class="primary"><i class="ti ti-plus"></i> New user</button>
            </div>
            <table class="admin-panel-table">
                <thead>
                    <tr>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Last sign-in</th>
                        <th style="width:1%; white-space:nowrap;">Actions</th>
                    </tr>
                </thead>
                <tbody id="admin-panel-rows">
                    <tr><td colspan="5" class="admin-panel-empty">Loading…</td></tr>
                </tbody>
            </table>
        </div>
        <div class="admin-panel-modal-bg" id="admin-panel-modal-bg">
            <div class="admin-panel-modal" role="dialog" aria-modal="true">
                <h3 id="admin-panel-modal-title"></h3>
                <p id="admin-panel-modal-desc"></p>
                <div id="admin-panel-modal-fields"></div>
                <div class="admin-panel-modal-actions">
                    <button id="admin-panel-modal-cancel">Cancel</button>
                    <button id="admin-panel-modal-confirm" class="primary">Confirm</button>
                </div>
            </div>
        </div>
    `;
}

export function initAdminPanel(root) {
    const fmtDate = (iso) => iso ? new Date(iso).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    }) : '—';

    const escapeHtml = (s) =>
        String(s).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));

    const $ = (sel) => root.querySelector(sel);

    async function api(method, url, body) {
        const opts = {
            method,
            headers: { 'Accept': 'application/json' },
            credentials: 'same-origin'
        };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        let data = null;
        try { data = await res.json(); } catch {}
        if (!res.ok) {
            const err = new Error(data?.error || res.statusText);
            err.status = res.status;
            throw err;
        }
        return data;
    }

    function flash(msg, kind = 'info') {
        const colors = { info: '#27beff', error: '#f87171', success: '#4ade80' };
        const div = document.createElement('div');
        div.style.cssText = `
            position: fixed; bottom: 24px; right: 24px;
            background: rgba(15,23,35,0.92); backdrop-filter: blur(12px);
            border: 1px solid ${colors[kind] || colors.info};
            color: ${colors[kind] || colors.info};
            padding: 10px 14px; border-radius: 8px; font-family: inherit;
            font-size: 0.9em; z-index: 99999;
        `;
        div.textContent = msg;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 3500);
    }

    async function loadUsers() {
        const search = $('#admin-panel-search').value.trim();
        const tbody = $('#admin-panel-rows');
        tbody.innerHTML = '<tr><td colspan="5" class="admin-panel-empty">Loading…</td></tr>';
        try {
            const url = search
                ? `/admin/users?search=${encodeURIComponent(search)}`
                : '/admin/users';
            const data = await api('GET', url);
            renderUsers(data.users);
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="5" class="admin-panel-empty">Error: ${escapeHtml(err.message)}</td></tr>`;
        }
    }

    function renderUsers(users) {
        const tbody = $('#admin-panel-rows');
        if (!users.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="admin-panel-empty">No users found.</td></tr>';
            return;
        }
        tbody.innerHTML = '';
        users.forEach((u) => {
            const tr = document.createElement('tr');
            const badges = [];
            if (u.isSuperAdmin) badges.push('<span class="admin-panel-badge super">super admin</span>');
            else if (u.isAdmin) badges.push('<span class="admin-panel-badge admin">admin</span>');
            if (u.isLocked) badges.push('<span class="admin-panel-badge locked">locked</span>');
            if (u.mustChangePassword) badges.push('<span class="admin-panel-badge must-change">must reset</span>');
            const actions = u.isSuperAdmin
                ? '<span style="color: rgba(255,255,255,0.4); font-size: 0.85em;">Protected</span>'
                : `
                    <button data-action="${u.isAdmin ? 'revoke-admin' : 'make-admin'}" data-id="${u.id}" data-email="${escapeHtml(u.email)}">${u.isAdmin ? 'Revoke admin' : 'Make admin'}</button>
                    <button data-action="${u.isLocked ? 'unlock' : 'lock'}" data-id="${u.id}" data-email="${escapeHtml(u.email)}">${u.isLocked ? 'Unlock' : 'Lock'}</button>
                    <button data-action="delete" data-id="${u.id}" data-email="${escapeHtml(u.email)}" class="danger">Delete</button>
                `;
            tr.innerHTML = `
                <td>${escapeHtml(u.email)}</td>
                <td>${badges.join(' ') || '—'}</td>
                <td>${fmtDate(u.createdAt)}</td>
                <td>${fmtDate(u.lastLoginAt)}</td>
                <td class="actions">${actions}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // --- Modal -------------------------------------------------------------
    const modalBg = $('#admin-panel-modal-bg');
    const modalTitle = $('#admin-panel-modal-title');
    const modalDesc = $('#admin-panel-modal-desc');
    const modalFields = $('#admin-panel-modal-fields');
    const modalConfirm = $('#admin-panel-modal-confirm');
    const modalCancel = $('#admin-panel-modal-cancel');
    let modalSubmit = null;

    function openModal({ title, desc, fields, onSubmit }) {
        modalTitle.textContent = title;
        modalDesc.textContent = desc || '';
        modalFields.innerHTML = fields;
        modalSubmit = onSubmit;
        modalBg.classList.add('show');
        const firstInput = modalFields.querySelector('input');
        if (firstInput) firstInput.focus();
    }
    function closeModal() {
        modalBg.classList.remove('show');
        modalSubmit = null;
        modalFields.innerHTML = '';
    }
    modalCancel.addEventListener('click', closeModal);
    modalBg.addEventListener('click', (e) => { if (e.target === modalBg) closeModal(); });
    modalConfirm.addEventListener('click', async () => {
        if (!modalSubmit) return;
        try {
            await modalSubmit();
            closeModal();
        } catch (err) {
            flash(err.message, 'error');
        }
    });

    // --- Row actions -------------------------------------------------------
    $('#admin-panel-rows').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const { action, id, email } = btn.dataset;

        if (action === 'make-admin' || action === 'revoke-admin') {
            const makeAdmin = action === 'make-admin';
            if (!confirm(`${makeAdmin ? 'Grant admin to' : 'Revoke admin from'} ${email}?`)) return;
            try {
                await api('POST', `/admin/users/${id}/admin`, { admin: makeAdmin });
                flash(
                    makeAdmin
                        ? `${email} is now an admin — they must sign out and back in to see the Admin tab.`
                        : `Admin revoked from ${email}.`,
                    'success'
                );
                loadUsers();
            } catch (err) {
                flash(err.message, 'error');
            }
        } else if (action === 'lock' || action === 'unlock') {
            if (!confirm(`${action === 'lock' ? 'Lock' : 'Unlock'} ${email}?`)) return;
            try {
                await api('POST', `/admin/users/${id}/lock`, { lock: action === 'lock' });
                flash(`${email} ${action === 'lock' ? 'locked' : 'unlocked'}`, 'success');
                loadUsers();
            } catch (err) {
                flash(err.message, 'error');
            }
        } else if (action === 'delete') {
            if (!confirm(`Permanently delete ${email}? This cannot be undone.`)) return;
            try {
                await api('DELETE', `/admin/users/${id}`);
                flash(`${email} deleted`, 'success');
                loadUsers();
                loadPending();
            } catch (err) {
                flash(err.message, 'error');
            }
        }
    });

    // --- Pending password reset requests -----------------------------------
    async function loadPending() {
        const list = $('#admin-panel-pending-list');
        list.innerHTML = '<div class="admin-panel-pending-empty">Loading…</div>';
        try {
            const data = await api('GET', '/admin/reset-requests');
            renderPending(data.requests || []);
        } catch (err) {
            list.innerHTML = `<div class="admin-panel-pending-empty">Error: ${escapeHtml(err.message)}</div>`;
        }
    }

    function renderPending(requests) {
        const list = $('#admin-panel-pending-list');
        if (!requests.length) {
            list.innerHTML = '<div class="admin-panel-pending-empty">No pending reset requests.</div>';
            return;
        }
        list.innerHTML = '';
        requests.forEach((r) => {
            const row = document.createElement('div');
            row.className = 'admin-panel-pending-row';
            row.innerHTML = `
                <div class="who">
                    <div class="email">${escapeHtml(r.email)}</div>
                    <div class="when">Requested ${fmtDate(r.requestedAt)}</div>
                </div>
                <button data-pending-action="fulfill" data-id="${r.id}" data-email="${escapeHtml(r.email)}" class="primary">Issue temp password</button>
                <button data-pending-action="dismiss" data-id="${r.id}" data-email="${escapeHtml(r.email)}">Dismiss</button>
            `;
            list.appendChild(row);
        });
    }

    $('#admin-panel-pending-list').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-pending-action]');
        if (!btn) return;
        const { id, email } = btn.dataset;
        const action = btn.dataset.pendingAction;

        if (action === 'fulfill') {
            openModal({
                title: `Issue temp password for ${email}`,
                desc: 'Enter a temporary password (10+ chars). The user will be required to change it on next sign-in. Share it with them privately — it is not shown again.',
                fields: `<label>Temporary password</label><input id="ap-new-pw" type="text" autocomplete="off" minlength="10" />`,
                onSubmit: async () => {
                    const pw = root.querySelector('#ap-new-pw').value;
                    if (pw.length < 10) throw new Error('Password must be at least 10 characters.');
                    await api('POST', `/admin/reset-requests/${id}/fulfill`, { newPassword: pw });
                    flash(`Temp password issued for ${email}`, 'success');
                    loadPending();
                    loadUsers();
                }
            });
        } else if (action === 'dismiss') {
            if (!confirm(`Dismiss the reset request from ${email}? They'll need to click "Forgot password" again to request another.`)) return;
            try {
                await api('POST', `/admin/reset-requests/${id}/dismiss`);
                flash(`Dismissed reset request from ${email}`, 'success');
                loadPending();
            } catch (err) {
                flash(err.message, 'error');
            }
        }
    });

    // --- Toolbar -----------------------------------------------------------
    let searchTimer = null;
    $('#admin-panel-search').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadUsers, 250);
    });
    $('#admin-panel-refresh').addEventListener('click', () => {
        loadUsers();
        loadPending();
    });

    $('#admin-panel-new').addEventListener('click', () => {
        openModal({
            title: 'Create user',
            desc: 'Account is created immediately. The user must change the password on first sign-in.',
            fields: `
                <label>Email</label>
                <input id="ap-nu-email" type="email" autocomplete="off" />
                <label>Temporary password (10+ chars)</label>
                <input id="ap-nu-pw" type="text" autocomplete="off" minlength="10" />
                <label style="display:flex;align-items:center;gap:8px;margin-top:10px;">
                    <input id="ap-nu-admin" type="checkbox" /> Grant admin access
                </label>
            `,
            onSubmit: async () => {
                const email = root.querySelector('#ap-nu-email').value.trim();
                const password = root.querySelector('#ap-nu-pw').value;
                const isAdmin = root.querySelector('#ap-nu-admin').checked;
                if (!email) throw new Error('Email required.');
                if (password.length < 10) throw new Error('Password must be at least 10 characters.');
                await api('POST', '/admin/users', { email, password, isAdmin });
                flash(`${email} created`, 'success');
                loadUsers();
            }
        });
    });

    $('#admin-panel-logout').addEventListener('click', async (e) => {
        e.preventDefault();
        try { await api('POST', '/auth/logout'); } catch {}
        window.location.href = '/login.html';
    });

    // Populate "signed in as" label
    api('GET', '/auth/me')
        .then((data) => {
            const who = root.querySelector('#admin-panel-who');
            if (who && data?.user?.email) {
                who.textContent = `Signed in as ${data.user.email}`;
            }
        })
        .catch(() => {});

    loadPending();
    loadUsers();
}
