/*
 * components/vortex_account.js
 * Front-end glue for the Vortex Radar account system. Loaded as a plain ES
 * module (no bundling needed). It:
 *   - mounts the in-app admin panel as a full-screen overlay
 *   - opens it when the URL hash is #admin (and the user is an admin)
 *   - reveals the "Admin Panel" menu row for admins and wires "Sign Out"
 */

import { adminPanelStyles, createAdminPanelHTML, initAdminPanel } from './admin_panel.js';

// --- styles ------------------------------------------------------------------
const style = document.createElement('style');
style.textContent = `
.vr-admin-overlay {
    position: fixed; inset: 0; z-index: 100000;
    background: rgba(4, 8, 16, 0.72);
    backdrop-filter: blur(6px);
    display: none; align-items: flex-start; justify-content: center;
    overflow: auto; padding: 32px 16px;
    /* CSS vars the admin panel styles rely on */
    --primary-color: #27beff;
    --border-color: rgba(255,255,255,0.12);
    font-family: 'Onest', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.vr-admin-overlay.show { display: flex; }
.vr-admin-card {
    width: min(900px, 96vw);
    background: rgba(11, 18, 32, 0.96);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 22px;
    box-shadow: 0 24px 70px rgba(0,0,0,0.55);
    color: #e7eef7;
}
.vr-admin-card-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 16px;
}
.vr-admin-card-header h2 { margin: 0; font-size: 1.3em; display: flex; align-items: center; gap: 8px; }
.vr-admin-card-header h2 .ti { color: var(--primary-color); }
.vr-admin-close {
    background: rgba(0,0,0,0.4); color: #fff; cursor: pointer;
    border: 1px solid var(--border-color); border-radius: 8px;
    width: 34px; height: 34px; font-size: 1.1em; line-height: 1;
}
.vr-admin-close:hover { background: rgba(255,255,255,0.08); }
${adminPanelStyles}
`;
document.head.appendChild(style);

// --- overlay -----------------------------------------------------------------
let overlay = null;

function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'vr-admin-overlay';
    overlay.innerHTML = `
        <div class="vr-admin-card" role="dialog" aria-modal="true">
            <div class="vr-admin-card-header">
                <h2><i class="ti ti-user-shield"></i> Admin Panel</h2>
                <button class="vr-admin-close" title="Close">&times;</button>
            </div>
            <div class="vr-admin-content"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.vr-admin-close').addEventListener('click', closeAdmin);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAdmin(); });
}

function openAdmin() {
    if (!overlay) buildOverlay();
    const content = overlay.querySelector('.vr-admin-content');
    content.innerHTML = createAdminPanelHTML();
    initAdminPanel(content);
    overlay.classList.add('show');
}

function closeAdmin() {
    if (overlay) overlay.classList.remove('show');
    if (location.hash === '#admin') {
        history.replaceState(null, '', location.pathname + location.search);
    }
}

window.openVortexAdmin = openAdmin;

// --- session-aware wiring ----------------------------------------------------
async function getMe() {
    try {
        const res = await fetch('/auth/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!res.ok) return null;
        const data = await res.json();
        return data.user || null;
    } catch { return null; }
}

function wireMenu(user) {
    const adminBtn = document.getElementById('armrAdminPanelBtn');
    if (adminBtn && user && user.isAdmin) {
        adminBtn.style.display = '';
        adminBtn.addEventListener('click', () => {
            const menu = document.getElementById('atticRadarMenu');
            if (menu) menu.style.display = 'none';
            openAdmin();
        });
    }

    const signOut = document.getElementById('armrSignOutBtn');
    const label = document.getElementById('armrSignOutLabel');
    if (label && user && user.email) label.textContent = `Sign Out (${user.email})`;
    if (signOut) {
        signOut.addEventListener('click', async () => {
            try {
                await fetch('/auth/logout', { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin' });
            } catch {}
            window.location.href = '/login.html';
        });
    }
}

function maybeOpenFromHash(user) {
    if (location.hash === '#admin') {
        if (user && user.isAdmin) openAdmin();
        else window.location.href = '/login.html';
    }
}

(async function init() {
    const user = await getMe();
    wireMenu(user);
    maybeOpenFromHash(user);
    window.addEventListener('hashchange', () => {
        if (location.hash === '#admin') maybeOpenFromHash(user);
    });
})();
