/*
 * components/admin_panel.js
 * In-app admin panel. Lists users and lets an admin reset passwords,
 * lock/unlock, delete, or create accounts, and fulfill password-reset requests.
 *
 * (c) 2026 Twistcaster Live Media LLC.
 */

import { nwsxAdminHTML, initNwsxAdmin } from './nws_bluesky_admin.js';

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
.admin-panel-badge.tier { background: rgba(52,211,153,0.18); color: #34d399; }
.admin-panel-badge.stream { background: rgba(255,59,48,0.18); color: #ff8f88; }
.admin-panel-badge.stream-pending { background: rgba(250,204,21,0.16); color: #facc15; }
.admin-panel-tier {
    background: rgba(255,255,255,0.06); color: #e8edf3;
    border: 1px solid rgba(255,255,255,0.14); border-radius: 6px;
    padding: 3px 6px; font-size: 0.85em; margin-right: 4px; cursor: pointer;
}
.admin-panel-tier option { background: #12151c; color: #e8edf3; }
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
                <div style="margin:0 0 10px;">
                    <button id="admin-panel-require-reset" class="danger" title="Invalidate every user's password (except the super admin) so returning users must reset via the approved-reset flow. Use after moving hosts.">Require ALL users to reset password</button>
                </div>
                <div id="admin-panel-pending-list">
                    <div class="admin-panel-pending-empty">Loading…</div>
                </div>
            </div>
            <div class="admin-panel-pending">
                <h4><i class="ti ti-broadcast"></i> Streaming access (chase stream hub)</h4>
                <div id="admin-panel-stream-list">
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
            ${nwsxAdminHTML()}
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
            const TIER_LABELS = { free: 'Free', tier1: 'Tier One', tier2: 'Tier Two', tier3: 'Tier Three' };
            const curTier = (u.tier === 'pro' ? 'tier3' : (u.tier || 'free'));
            if (curTier !== 'free') badges.push(`<span class="admin-panel-badge tier">${TIER_LABELS[curTier] || curTier}</span>`);
            if (u.streamApproved) badges.push('<span class="admin-panel-badge stream">can stream</span>');
            else if (u.streamRequest && u.streamRequest.status === 'pending') badges.push('<span class="admin-panel-badge stream-pending">stream requested</span>');
            const tierSelect = `<select class="admin-panel-tier" data-id="${u.id}" data-email="${escapeHtml(u.email)}" title="Subscription tier">
                    ${['free', 'tier1', 'tier2', 'tier3'].map((t) => `<option value="${t}"${t === curTier ? ' selected' : ''}>${TIER_LABELS[t]}</option>`).join('')}
                </select>`;
            const actions = u.isSuperAdmin
                ? '<span style="color: rgba(255,255,255,0.4); font-size: 0.85em;">Protected</span>'
                : `
                    ${tierSelect}
                    <button data-action="reset-password" data-id="${u.id}" data-email="${escapeHtml(u.email)}">Reset password</button>
                    <button data-action="${u.isAdmin ? 'revoke-admin' : 'make-admin'}" data-id="${u.id}" data-email="${escapeHtml(u.email)}">${u.isAdmin ? 'Revoke admin' : 'Make admin'}</button>
                    <button data-action="${u.streamApproved ? 'stream-revoke' : 'stream-approve'}" data-id="${u.id}" data-email="${escapeHtml(u.email)}">${u.streamApproved ? 'Revoke stream' : 'Allow stream'}</button>
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

    /**
     * Shows a generated temporary password once, with a copy button, and says
     * whether the server managed to email it. Stays on screen until dismissed —
     * a toast would vanish before the admin could copy it.
     */
    function showTempPassword(email, data) {
        const pw = data && data.tempPassword;
        if (!pw) { flash(`Password reset for ${email}`, 'success'); return; }

        const emailed = !!(data && data.emailed);
        const bg = document.createElement('div');
        bg.style.cssText = `
            position: fixed; inset: 0; background: rgba(4,10,18,0.72);
            backdrop-filter: blur(6px); z-index: 100000;
            display: flex; align-items: center; justify-content: center; padding: 20px;
        `;
        bg.innerHTML = `
            <div style="background:#0f1723;border:1px solid #27beff55;border-radius:12px;
                        padding:20px;max-width:460px;width:100%;font-family:inherit;color:#e6edf5;">
                <div style="font-weight:600;margin-bottom:6px;">Temporary password for ${email}</div>
                <div style="font-size:.86em;opacity:.75;margin-bottom:14px;">
                    ${emailed
                        ? 'Emailed to them. Shown here too in case you need to relay it.'
                        : 'Not emailed — no mail configured or delivery failed, so you will need to pass this on.'}
                    They must change it at next sign-in.
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <code style="flex:1;background:#060c14;border:1px solid #ffffff1a;border-radius:8px;
                                 padding:10px 12px;font-size:1.1em;letter-spacing:.06em;">${pw}</code>
                    <button id="ap-copy-pw" class="primary" style="white-space:nowrap;">Copy</button>
                </div>
                <div style="margin-top:16px;text-align:right;">
                    <button id="ap-close-pw">Done</button>
                </div>
            </div>
        `;
        document.body.appendChild(bg);
        bg.querySelector('#ap-copy-pw').addEventListener('click', async (ev) => {
            try {
                await navigator.clipboard.writeText(pw);
                ev.target.textContent = 'Copied';
                setTimeout(() => { ev.target.textContent = 'Copy'; }, 1800);
            } catch (e) { flash('Could not copy — select it manually.', 'error'); }
        });
        const close = () => bg.remove();
        bg.querySelector('#ap-close-pw').addEventListener('click', close);
        bg.addEventListener('click', (ev) => { if (ev.target === bg) close(); });
    }

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

    // Change a user's subscription tier from the row dropdown.
    $('#admin-panel-rows').addEventListener('change', async (e) => {
        const sel = e.target.closest('select.admin-panel-tier');
        if (!sel) return;
        const { id, email } = sel.dataset;
        const tier = sel.value;
        try {
            await api('POST', `/admin/users/${id}/tier`, { tier });
            flash(`${email} set to ${sel.options[sel.selectedIndex].text}.`, 'success');
            loadUsers();
        } catch (err) {
            flash(err.message, 'error');
            loadUsers(); // revert the dropdown to the stored value
        }
    });

    // --- Row actions -------------------------------------------------------
    $('#admin-panel-rows').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const { action, id, email } = btn.dataset;

        if (action === 'reset-password') {
            openModal({
                title: `Reset password for ${email}`,
                desc: 'Leave blank to have a strong temporary password generated and emailed to the user. The user must change it on next sign-in, and any active sessions are signed out.',
                fields: `<label>Temporary password <span style="opacity:.7;font-weight:400;">(optional — blank generates one)</span></label><input id="ap-reset-pw" type="text" autocomplete="off" placeholder="Leave blank to generate" />`,
                onSubmit: async () => {
                    const pw = root.querySelector('#ap-reset-pw').value.trim();
                    if (pw && pw.length < 10) throw new Error('Password must be at least 10 characters.');
                    const data = await api('POST', `/admin/users/${id}/reset-password`, pw ? { newPassword: pw } : {});
                    showTempPassword(email, data);
                    loadUsers();
                    loadPending();
                }
            });
        } else if (action === 'make-admin' || action === 'revoke-admin') {
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
        } else if (action === 'stream-approve' || action === 'stream-revoke') {
            const approve = action === 'stream-approve';
            if (!confirm(`${approve ? 'Allow' : 'Revoke'} streaming access for ${email}?`)) return;
            try {
                await api('POST', `/admin/users/${id}/stream`, { approved: approve });
                flash(`${email} ${approve ? 'can now go live' : 'streaming access revoked'}.`, 'success');
                loadUsers();
                loadStreamRequests();
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
            const approved = r.status === 'approved';
            row.innerHTML = `
                <div class="who">
                    <div class="email">${escapeHtml(r.email)}${approved ? ' <span style="color:#34d399;font-size:.82em;">✓ approved</span>' : ''}</div>
                    <div class="when">Requested ${fmtDate(r.requestedAt)}</div>
                </div>
                ${approved
                    ? '<button disabled title="Approved — waiting for the user to set their password">Waiting for user…</button>'
                    : `<button data-pending-action="approve" data-id="${r.id}" data-email="${escapeHtml(r.email)}" class="primary">Approve reset</button>`}
                <button data-pending-action="fulfill" data-id="${r.id}" data-email="${escapeHtml(r.email)}">Temp password…</button>
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

        if (action === 'approve') {
            try {
                await api('POST', `/admin/reset-requests/${id}/approve`);
                flash(`Approved — ${email} can now set their own new password.`, 'success');
                loadPending();
            } catch (err) { flash(err.message, 'error'); }
            return;
        }

        if (action === 'fulfill') {
            openModal({
                title: `Issue temp password for ${email}`,
                desc: 'Leave blank to have a strong temporary password generated and emailed to the user. They will be required to change it on next sign-in.',
                fields: `<label>Temporary password <span style="opacity:.7;font-weight:400;">(optional — blank generates one)</span></label><input id="ap-new-pw" type="text" autocomplete="off" placeholder="Leave blank to generate" />`,
                onSubmit: async () => {
                    const pw = root.querySelector('#ap-new-pw').value.trim();
                    if (pw && pw.length < 10) throw new Error('Password must be at least 10 characters.');
                    const data = await api('POST', `/admin/reset-requests/${id}/fulfill`, pw ? { newPassword: pw } : {});
                    showTempPassword(email, data);
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

    // --- Streaming access requests -----------------------------------------
    async function loadStreamRequests() {
        const list = $('#admin-panel-stream-list');
        if (!list) return;
        list.innerHTML = '<div class="admin-panel-pending-empty">Loading…</div>';
        try {
            const data = await api('GET', '/admin/stream/requests');
            renderStreamRequests(data.requests || []);
        } catch (err) {
            list.innerHTML = `<div class="admin-panel-pending-empty">Error: ${escapeHtml(err.message)}</div>`;
        }
    }

    function renderStreamRequests(requests) {
        const list = $('#admin-panel-stream-list');
        if (!requests.length) {
            list.innerHTML = '<div class="admin-panel-pending-empty">No streaming requests or approved chasers yet.</div>';
            return;
        }
        // pending first (already sorted server-side)
        list.innerHTML = '';
        requests.forEach((r) => {
            const row = document.createElement('div');
            row.className = 'admin-panel-pending-row';
            const statusLabel = r.approved
                ? '<span style="color:#34d399;font-size:.82em;">✓ approved</span>'
                : (r.status === 'pending'
                    ? '<span style="color:#facc15;font-size:.82em;">● pending</span>'
                    : `<span style="color:rgba(255,255,255,.5);font-size:.82em;">${escapeHtml(r.status)}</span>`);
            const when = r.status === 'pending'
                ? `Requested ${fmtDate(r.requestedAt)}`
                : (r.decidedAt ? `Decided ${fmtDate(r.decidedAt)}` : '');
            const btns = r.approved
                ? `<button data-stream-action="revoke" data-id="${r.id}" data-email="${escapeHtml(r.email)}" class="danger">Revoke</button>`
                : `<button data-stream-action="approve" data-id="${r.id}" data-email="${escapeHtml(r.email)}" class="primary">Approve</button>
                   <button data-stream-action="deny" data-id="${r.id}" data-email="${escapeHtml(r.email)}">Deny</button>`;
            const links = Array.isArray(r.links) ? r.links : [];
            const linksHtml = links.length
                ? `<div class="when" style="margin-top:3px;">Links: ${links.map((u) =>
                    `<a href="${escapeHtml(u)}" target="_blank" rel="noopener" style="color:#27beff;word-break:break-all;">${escapeHtml(u)}</a>`
                  ).join(' · ')}</div>`
                : '';
            row.innerHTML = `
                <div class="who">
                    <div class="email">${escapeHtml(r.email)} ${statusLabel}</div>
                    ${when ? `<div class="when">${when}</div>` : ''}
                    ${linksHtml}
                    ${r.note ? `<div class="when">“${escapeHtml(r.note)}”</div>` : ''}
                </div>
                ${btns}
            `;
            list.appendChild(row);
        });
    }

    $('#admin-panel-stream-list').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-stream-action]');
        if (!btn) return;
        const { id, email } = btn.dataset;
        const action = btn.dataset.streamAction;
        try {
            if (action === 'approve') {
                await api('POST', `/admin/stream/requests/${id}/approve`);
                flash(`${email} approved to go live.`, 'success');
            } else if (action === 'deny') {
                if (!confirm(`Deny streaming access for ${email}?`)) return;
                await api('POST', `/admin/stream/requests/${id}/deny`);
                flash(`Denied streaming access for ${email}.`, 'success');
            } else if (action === 'revoke') {
                if (!confirm(`Revoke streaming access for ${email}?`)) return;
                await api('POST', `/admin/users/${id}/stream`, { approved: false });
                flash(`Revoked streaming access for ${email}.`, 'success');
            }
            loadStreamRequests();
            loadUsers();
        } catch (err) { flash(err.message, 'error'); }
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
        loadStreamRequests();
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

    const requireResetBtn = $('#admin-panel-require-reset');
    if (requireResetBtn) requireResetBtn.addEventListener('click', async () => {
        if (!confirm('This will log out ALL users and invalidate their passwords (except the super admin). Each user must then request a reset and set a new password (which you approve). Continue?')) return;
        requireResetBtn.disabled = true;
        try {
            const d = await api('POST', '/admin/users/require-reset');
            flash(`Done — ${d.count} user(s) must now reset their password.`, 'success');
        } catch (err) { flash(err.message, 'error'); }
        finally { requireResetBtn.disabled = false; }
    });

    loadPending();
    loadStreamRequests();
    loadUsers();

    // Automatic Warning Posts (NWS → Bluesky) section.
    try { initNwsxAdmin(root); } catch (e) { console.warn('[nwsx-admin] init failed', e); }
}
