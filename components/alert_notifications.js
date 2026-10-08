/*
 * components/alert_notifications.js — turning weather alert notifications on
 * ────────────────────────────────────────────────────────────────────────────
 * The user-facing half of Critical Weather Alerts: grant permission, register
 * the service worker, subscribe, and manage the places you want to be told
 * about. The server does the polling and the point-in-polygon matching; this
 * is where somebody says yes.
 *
 * WHAT MAKES THIS FIDDLY, and why the code is shaped around it: a browser
 * notification needs four separate things to be true, and failing any one of
 * them looks identical from the outside — nothing happens.
 *
 *   1. The page is on HTTPS (or localhost). Service workers are refused
 *      outright otherwise, which is silent unless you are looking.
 *   2. The user granted permission, and a DENIED permission cannot be asked
 *      for again from script — only the user can undo it in site settings.
 *   3. A service worker is registered and active.
 *   4. The subscription reached our server.
 *
 * So each is reported separately rather than as one "notifications: off",
 * because the fix is different for each and three of them are not things a
 * button can solve.
 *
 * There is also a Test button, deliberately. Permission can be granted, a
 * subscription stored, and delivery still fail at the vendor — and the first
 * time anybody should discover that is not during a tornado warning.
 */

const API = '/api/critical';

const $ = (id) => document.getElementById(id);

async function j(url, opts) {
    const res = await fetch(url, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json', ...((opts && opts.headers) || {}) },
        ...opts,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* not json */ }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
}

/* VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

/*
 * Everything that has to be true, reported one at a time.
 *
 * Collapsing these into a single boolean was the first version and it was
 * useless: "off" with no reason, when the reason is sometimes a thing only the
 * user can change in their browser settings.
 */
function capability() {
    const secure = window.isSecureContext
        || location.protocol === 'https:'
        || ['localhost', '127.0.0.1'].indexOf(location.hostname) !== -1;
    return {
        secure,
        hasSW: 'serviceWorker' in navigator,
        hasPush: 'PushManager' in window,
        permission: (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported',
    };
}

async function registration() {
    if (!('serviceWorker' in navigator)) return null;
    // Root scope: the worker is served from / so it can control the whole app.
    return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

async function currentSubscription() {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return null;
    return reg.pushManager.getSubscription();
}

/** Ask, register, subscribe, and tell the server. Throws with a readable why. */
async function enableNotifications() {
    const cap = capability();
    if (!cap.secure) {
        throw new Error('Notifications need a secure connection. Open the site over https.');
    }
    if (!cap.hasSW || !cap.hasPush) {
        throw new Error('This browser cannot do push notifications.');
    }
    if (cap.permission === 'denied') {
        throw new Error('Notifications are blocked for this site. Allow them in your browser '
            + 'settings for this page, then try again — a blocked site cannot ask again by itself.');
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Permission was not granted.');

    const reg = await registration();
    // ready, not the register() promise: a worker that is registered but not
    // yet active cannot be subscribed against.
    await navigator.serviceWorker.ready;

    const { publicKey } = await j(`${API}/push/key`);
    if (!publicKey) throw new Error('This server has no push key configured.');

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            // Required by every browser now: a push that shows nothing is not
            // allowed, which suits a weather warning exactly.
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
    }

    const out = await j(`${API}/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub }),
    });
    return out;
}

async function disableNotifications() {
    const sub = await currentSubscription();
    if (!sub) return { ok: true };
    try {
        await j(`${API}/push/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
        });
    } catch (e) { /* tell the server if we can; unsubscribe locally regardless */ }
    await sub.unsubscribe();
    return { ok: true };
}

/*
 * The component brings its own stylesheet.
 *
 * These rules lived in components/layers.css, which is loaded with a
 * version in the URL — so a browser holding the old file rendered this
 * dialog with no styling at all: an invisible div under a full-screen map,
 * which reads exactly like a button that does nothing. Styles that arrive
 * with the code that needs them cannot be cached apart from it.
 *
 * Same approach as components/layers_menu.js.
 */
function injectStyles() {
    if (document.getElementById('vr-al-styles')) return;
    const el = document.createElement('style');
    el.id = 'vr-al-styles';
    el.textContent = [
        ".vr-al-backdrop{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;",
        "  justify-content:center;padding:18px;background:rgba(0,0,0,.55)}",
        ".vr-al-panel{width:min(560px,100%);max-height:88vh;overflow:auto;",
        "  background:var(--vx-surface,#11151c);border:1px solid rgba(255,255,255,.12);",
        "  border-radius:var(--vx-r-3,10px);box-shadow:var(--vx-shadow-lg,0 18px 44px rgba(0,0,0,.55));",
        "  color:var(--vx-text,#eef4fb);font-family:var(--vx-font,system-ui,sans-serif)}",
        ".vr-al-head{display:flex;align-items:center;gap:10px;padding:14px 16px;font-size:16px;",
        "  border-bottom:1px solid rgba(255,255,255,.09)}",
        ".vr-al-head b{flex:1 1 auto}",
        ".vr-al-x{background:rgba(255,255,255,.07);color:inherit;cursor:pointer;width:28px;height:28px;",
        "  border:1px solid rgba(255,255,255,.14);border-radius:var(--vx-r-2,6px);font-size:16px;",
        "  line-height:1;font-family:inherit}",
        ".vr-al-body{padding:14px 16px 18px}",
        ".vr-al-blurb{margin:0 0 12px;font-size:13px;line-height:1.5;color:#a8bace}",
        ".vr-al-state{font-size:13px;line-height:1.7;padding:10px 12px;background:rgba(0,0,0,.28);",
        "  border:1px solid rgba(255,255,255,.08);border-radius:var(--vx-r-2,6px)}",
        ".vr-al-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}",
        ".vr-al-actions button{padding:9px 13px;border-radius:var(--vx-r-2,6px);cursor:pointer;",
        "  font-family:inherit;font-size:13px;font-weight:700;color:var(--vx-text,#eef4fb);",
        "  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14)}",
        ".vr-al-actions button:disabled{opacity:.45;cursor:default}",
        ".vr-al-primary:not(:disabled){background:var(--vx-accent,#e8862b);",
        "  border-color:var(--vx-accent,#e8862b);color:#0b0f14}",
        ".vr-al-sub{margin:18px 0 8px;font-size:11px;font-weight:800;letter-spacing:.12em;",
        "  text-transform:uppercase;color:#8fa6bd}",
        ".vr-al-locs{display:flex;flex-direction:column;gap:7px}",
        ".vr-al-loc{display:flex;align-items:center;gap:10px;padding:9px 11px;",
        "  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);",
        "  border-radius:var(--vx-r-2,6px)}",
        ".vr-al-loc-main{flex:1 1 auto;display:flex;flex-direction:column;gap:2px;min-width:0}",
        ".vr-al-loc-main b{font-size:13.5px}",
        ".vr-al-loc-main span{font-size:12px;color:#a8bace}",
        ".vr-al-loc-main i{font-style:normal;font-size:11px;color:#7f93a8}",
        ".vr-al-del{flex:0 0 auto;padding:6px 10px;cursor:pointer;font-family:inherit;font-size:12px;",
        "  color:#ff9183;background:rgba(209,64,47,.14);border:1px solid rgba(209,64,47,.4);",
        "  border-radius:var(--vx-r-2,6px)}",
        ".vr-al-empty{font-size:13px;color:#8fa6bd;padding:6px 2px}",
        ".vr-al-add{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}",
        ".vr-al-add input{flex:1 1 140px;min-width:0;padding:9px 11px;font-family:inherit;",
        "  font-size:13px;color:var(--vx-text,#eef4fb);background:rgba(0,0,0,.3);",
        "  border:1px solid rgba(255,255,255,.14);border-radius:var(--vx-r-2,6px)}",
        ".vr-al-add button{flex:0 0 auto;padding:9px 16px;cursor:pointer;font-family:inherit;",
        "  font-size:13px;font-weight:700;color:var(--vx-text,#eef4fb);",
        "  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);",
        "  border-radius:var(--vx-r-2,6px)}",
        ".vr-al-msg{margin-top:10px;font-size:12.5px;min-height:17px;color:#a8bace}",
        ".vr-al-msg.ok{color:#7ce8a8}",
        ".vr-al-msg.warn{color:var(--vx-accent,#e8862b)}",
    ].join('');
    document.head.appendChild(el);
}

// ── the dialog ──────────────────────────────────────────────────────────────
function closeDialog() {
    const el = $('vr-alerts-dialog');
    if (el) el.remove();
}

function row(loc) {
    const where = [loc.city, loc.state].filter(Boolean).join(', ') || loc.address || '—';
    const coords = (loc.lat != null && loc.lon != null)
        ? `${Number(loc.lat).toFixed(3)}, ${Number(loc.lon).toFixed(3)}`
        : 'no position — cannot be matched';
    return `<div class="vr-al-loc" data-id="${loc.id}">
        <div class="vr-al-loc-main">
            <b>${escapeHtml(loc.name || 'Location')}</b>
            <span>${escapeHtml(where)}</span>
            <i>${escapeHtml(coords)}</i>
        </div>
        <button class="vr-al-del" data-id="${loc.id}" title="Remove this location">Remove</button>
    </div>`;
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function openDialog() {
    injectStyles();
    closeDialog();
    const wrap = document.createElement('div');
    wrap.id = 'vr-alerts-dialog';
    wrap.className = 'vr-al-backdrop';
    wrap.innerHTML = `
      <div class="vr-al-panel" role="dialog" aria-label="Weather alert notifications">
        <div class="vr-al-head">
          <i class="fa-solid fa-bell"></i>
          <b>Alert Notifications</b>
          <button class="vr-al-x" id="vr-al-close" aria-label="Close">×</button>
        </div>
        <div class="vr-al-body">
          <p class="vr-al-blurb">Be told when a warning is issued for somewhere you care about —
            matched to the exact warning polygon, not the county, so it only fires when it
            should. Works with the app closed.</p>

          <div class="vr-al-state" id="vr-al-state">Checking…</div>
          <div class="vr-al-actions">
            <button class="vr-al-primary" id="vr-al-enable">Turn on notifications</button>
            <button class="vr-al-ghost" id="vr-al-test">Send a test</button>
            <button class="vr-al-ghost" id="vr-al-off">Turn off</button>
          </div>

          <div class="vr-al-sub">Places to watch</div>
          <div id="vr-al-locs" class="vr-al-locs">Loading…</div>
          <div class="vr-al-add">
            <input id="vr-al-name" placeholder="Name (Home, Work…)" maxlength="60" />
            <input id="vr-al-addr" placeholder="Address, city or ZIP" maxlength="160" />
            <button id="vr-al-save">Add</button>
          </div>
          <div class="vr-al-msg" id="vr-al-msg"></div>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const msg = (t, kind) => {
        const el = $('vr-al-msg');
        el.textContent = t || '';
        el.className = 'vr-al-msg' + (kind ? ' ' + kind : '');
    };

    $('vr-al-close').onclick = closeDialog;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeDialog(); });

    async function refreshState() {
        const cap = capability();
        const sub = await currentSubscription().catch(() => null);
        let server = null;
        try { server = await j(`${API}/status`); } catch (e) { /* not fatal */ }

        const lines = [];
        if (!cap.secure) lines.push('⚠ This page is not on a secure connection, so notifications cannot be used.');
        else if (!cap.hasSW || !cap.hasPush) lines.push('⚠ This browser does not support push notifications.');
        else if (cap.permission === 'denied') lines.push('⚠ Blocked in your browser settings for this site.');
        else if (!sub) lines.push('Not on for this device yet.');
        else lines.push('✓ On for this device.');

        if (server && server.push === false) lines.push('⚠ The server has push turned off.');
        if (server && server.poller) {
            const p = server.poller;
            lines.push(p.error
                ? `⚠ The warning poller last failed: ${p.error}`
                : `Watching ${p.alerts} active alerts nationally.`);
        }
        $('vr-al-state').innerHTML = lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
        $('vr-al-test').disabled = !sub;
        $('vr-al-off').disabled = !sub;
        $('vr-al-enable').disabled = !!sub || !cap.secure || cap.permission === 'denied';
    }

    async function refreshLocs() {
        try {
            const { locations } = await j(`${API}/locations`);
            const host = $('vr-al-locs');
            host.innerHTML = (locations && locations.length)
                ? locations.map(row).join('')
                : '<div class="vr-al-empty">No places yet. Add one below.</div>';
            host.querySelectorAll('.vr-al-del').forEach((b) => {
                b.onclick = async () => {
                    try {
                        await j(`${API}/locations/${encodeURIComponent(b.dataset.id)}`, { method: 'DELETE' });
                        refreshLocs();
                    } catch (e) { msg(e.message, 'warn'); }
                };
            });
        } catch (e) {
            $('vr-al-locs').innerHTML = `<div class="vr-al-empty">Could not load: ${escapeHtml(e.message)}</div>`;
        }
    }

    $('vr-al-enable').onclick = async () => {
        msg('Asking your browser…');
        try {
            const out = await enableNotifications();
            msg(`On for this device (${out.devices} registered).`, 'ok');
        } catch (e) { msg(e.message, 'warn'); }
        refreshState();
    };

    $('vr-al-off').onclick = async () => {
        msg('Turning off…');
        try { await disableNotifications(); msg('Off for this device.', 'ok'); }
        catch (e) { msg(e.message, 'warn'); }
        refreshState();
    };

    $('vr-al-test').onclick = async () => {
        msg('Sending…');
        try {
            const out = await j(`${API}/push/test`, { method: 'POST' });
            msg(out.sent
                ? `Sent to ${out.sent} device(s). If nothing appeared, check your system notification settings.`
                : 'The server accepted it but nothing could be delivered.', out.sent ? 'ok' : 'warn');
        } catch (e) { msg(e.message, 'warn'); }
    };

    $('vr-al-save').onclick = async () => {
        const name = $('vr-al-name').value.trim();
        const address = $('vr-al-addr').value.trim();
        if (!address) { msg('Give an address, city or ZIP.', 'warn'); return; }
        msg('Looking that up…');
        try {
            /*
             * push is switched on for a place added here, since that is plainly
             * what was meant. The server still geocodes it, and a place it
             * cannot find keeps no position — which the list says outright,
             * because a location with no position can never be matched.
             */
            await j(`${API}/locations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name || 'Location', address, methods: { push: true } }),
            });
            $('vr-al-name').value = '';
            $('vr-al-addr').value = '';
            msg('Added.', 'ok');
            refreshLocs();
        } catch (e) { msg(e.message, 'warn'); }
    };

    refreshState();
    refreshLocs();
}

function init() {
    const btn = document.getElementById('armrAlertNotifyBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            const m = document.getElementById('vortexRadarMenu');
            if (m) m.style.display = 'none';
            openDialog();
        });
    }
    /*
     * Register the worker on load when permission is already granted, so a
     * device that said yes once keeps working after an update without anybody
     * reopening this dialog.
     */
    try {
        if ('serviceWorker' in navigator && typeof Notification !== 'undefined'
            && Notification.permission === 'granted') {
            registration().catch(() => {});
        }
    } catch (e) { /* nothing to do */ }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
