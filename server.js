/*
 * Vortex Radar backend.
 *
 * Serves the radar app behind authentication and provides the /auth/* and
 * /admin/* endpoints that login.html, admin.html and components/admin_panel.js
 * expect. Intentionally dependency-light:
 *   - users / reset requests are stored as JSON under ./server_data
 *   - passwords are hashed with Node's built-in scrypt (no native modules)
 *   - sessions are signed-token cookies tracked server-side in memory
 *
 * Run with `npm start`. Configure via env: PORT, SUPPORT_EMAIL, SESSION_TTL_DAYS.
 */

// Load .env (Stripe/DB secrets) if present. Safe no-op when the file/module
// is absent, so the app still boots without billing configured.
try { require('dotenv').config(); } catch (e) {}

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createBilling } = require('./billing');

const ROOT = __dirname;
// Where users/sessions/reports are stored. Override with DATA_DIR to point at a
// persistent volume (e.g. a Render Disk mounted at /var/data) so accounts and
// data survive deploys and restarts. Defaults to ./server_data for local dev.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'server_data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RESETS_FILE = path.join(DATA_DIR, 'reset_requests.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const LOGOS_FILE = path.join(DATA_DIR, 'logos.json');
const PUSH_FILE = path.join(DATA_DIR, 'push_tokens.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const STREAM_FILE = path.join(DATA_DIR, 'stream_configs.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');

const PORT = process.env.PORT || 3333;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@vortexradar.app';
// A protected super admin that is always present, always an admin, and cannot
// be locked, demoted, or deleted by other admins.
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'admin@twistcasterlivemedia.com').trim().toLowerCase();
const SESSION_TTL_MS = (parseInt(process.env.SESSION_TTL_DAYS, 10) || 30) * 24 * 60 * 60 * 1000;
const COOKIE = 'vr_session';

// ─── Persistence ────────────────────────────────────────────────────────────
function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
}
function writeJson(file, value) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

let users = readJson(USERS_FILE, []);
let resetRequests = readJson(RESETS_FILE, []);
let reports = readJson(REPORTS_FILE, []);
let logos = readJson(LOGOS_FILE, {}); // userId -> { dataUrl, corner, size, opacity }
let pushTokens = readJson(PUSH_FILE, {}); // userId -> [{ token, platform, updatedAt }]
let userSettings = readJson(SETTINGS_FILE, {}); // userId -> { switches: { id: bool } }
let streamConfigs = readJson(STREAM_FILE, {}); // userId -> { discordWebhook, obs, titleTemplate, ... }
let tickets = readJson(TICKETS_FILE, []); // [{ id, userId, email, subject, category, status, messages: [...], ... }]
const saveUsers = () => writeJson(USERS_FILE, users);
const saveResets = () => writeJson(RESETS_FILE, resetRequests);
const saveReports = () => writeJson(REPORTS_FILE, reports);
const saveLogos = () => writeJson(LOGOS_FILE, logos);
const savePushTokens = () => writeJson(PUSH_FILE, pushTokens);
const saveUserSettings = () => writeJson(SETTINGS_FILE, userSettings);
const saveStreamConfigs = () => writeJson(STREAM_FILE, streamConfigs);
const saveTickets = () => writeJson(TICKETS_FILE, tickets);

// Currently-live chasers, kept in memory only (ephemeral by nature). Keyed by
// userId -> { lat, lng, place, title, url, startedAt, updatedAt }. Powers the
// live location markers other users see on their map.
const liveSessions = new Map();
const LIVE_STALE_MS = 3 * 60 * 1000; // drop a session we haven't heard from in 3 min
function pruneLiveSessions() {
    const now = Date.now();
    for (const [uid, s] of liveSessions) {
        if (now - (s.updatedAt || 0) > LIVE_STALE_MS) liveSessions.delete(uid);
    }
}

// ─── Sessions (persisted to disk so restarts don't sign everyone out) ─────────
const sessions = new Map(); // token -> { userId, created }

// Load saved sessions, dropping any that have already expired.
(function loadSessions() {
    const saved = readJson(SESSIONS_FILE, []);
    const now = Date.now();
    for (const [token, s] of saved) {
        if (s && now - s.created <= SESSION_TTL_MS) sessions.set(token, s);
    }
})();

const saveSessions = () => writeJson(SESSIONS_FILE, [...sessions.entries()]);

function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId, created: Date.now() });
    saveSessions();
    return token;
}
function destroySession(token) {
    if (token && sessions.delete(token)) saveSessions();
}
function destroySessionsForUser(userId) {
    let changed = false;
    for (const [token, s] of sessions) {
        if (s.userId === userId) { sessions.delete(token); changed = true; }
    }
    if (changed) saveSessions();
}

// ─── Password hashing (scrypt) ───────────────────────────────────────────────
function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const dk = crypto.scryptSync(password, salt, 64);
    return salt.toString('hex') + ':' + dk.toString('hex');
}
function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [saltHex, hashHex] = stored.split(':');
    const hash = Buffer.from(hashHex, 'hex');
    const dk = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    return hash.length === dk.length && crypto.timingSafeEqual(hash, dk);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e) => String(e || '').trim().toLowerCase();
const findByEmail = (e) => users.find((u) => u.email === normEmail(e));
const findById = (id) => users.find((u) => u.id === id);
const adminCount = () => users.filter((u) => u.isAdmin).length;

// ─── Billing (Stripe) — wired to the JSON user store ─────────────────────────
const billing = createBilling({
    store: {
        getById: (id) => findById(id),
        getByStripeCustomer: (cid) => users.find((u) => u.stripeCustomerId === cid),
        update: (user, fields) => { Object.assign(user, fields); saveUsers(); },
    },
});

function publicUser(u) {
    return {
        id: u.id,
        email: u.email,
        isAdmin: !!u.isAdmin,
        isSuperAdmin: !!u.isSuperAdmin,
        isLocked: !!u.isLocked,
        mustChangePassword: !!u.mustChangePassword,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt || null,
    };
}

/**
 * Make sure the super admin account exists and is fully privileged. Promotes
 * the account if it already exists; otherwise seeds it (password from
 * SUPER_ADMIN_PASSWORD, or a random one printed to the console on first run).
 */
function ensureSuperAdmin() {
    const existing = findByEmail(SUPER_ADMIN_EMAIL);
    if (existing) {
        let changed = false;
        if (!existing.isSuperAdmin) { existing.isSuperAdmin = true; changed = true; }
        if (!existing.isAdmin) { existing.isAdmin = true; changed = true; }
        if (existing.isLocked) { existing.isLocked = false; changed = true; }
        if (changed) { saveUsers(); console.log(`Promoted ${SUPER_ADMIN_EMAIL} to super admin.`); }
        return;
    }
    const envPw = process.env.SUPER_ADMIN_PASSWORD;
    const usingEnvPw = typeof envPw === 'string' && envPw.length >= 10;
    const password = usingEnvPw ? envPw : crypto.randomBytes(12).toString('base64url');
    users.push({
        id: crypto.randomUUID(),
        email: SUPER_ADMIN_EMAIL,
        passwordHash: hashPassword(password),
        isAdmin: true,
        isSuperAdmin: true,
        isLocked: false,
        mustChangePassword: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
    });
    saveUsers();
    console.log('------------------------------------------------------------');
    console.log(` Seeded super admin: ${SUPER_ADMIN_EMAIL}`);
    if (usingEnvPw) {
        console.log(' Password: taken from SUPER_ADMIN_PASSWORD.');
    } else {
        console.log(` Temporary password: ${password}`);
        console.log(' Set SUPER_ADMIN_PASSWORD (10+ chars) and restart to control it.');
    }
    console.log('------------------------------------------------------------');
}

function setSessionCookie(res, token) {
    res.cookie(COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_MS,
    });
}

// ─── App ─────────────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');

// Stripe webhook needs the RAW request body for signature verification, so it
// MUST be mounted before express.json parses it.
app.use('/api/billing', billing.webhookRouter());

app.use(express.json({ limit: '4mb' })); // room for uploaded brand-logo data URLs

// Parse cookies + attach the current user/session to the request.
app.use((req, res, next) => {
    req.cookies = {};
    (req.headers.cookie || '').split(';').forEach((part) => {
        const i = part.indexOf('=');
        if (i > -1) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
    const token = req.cookies[COOKIE];
    const sess = token && sessions.get(token);
    if (sess && Date.now() - sess.created > SESSION_TTL_MS) {
        destroySession(token);
        req.user = null;
    } else {
        req.user = sess ? findById(sess.userId) : null;
    }
    req.sessionToken = token;
    next();
});

// Billing JSON API (status/checkout/portal) — after the middleware above so
// req.user is populated. /status is public; checkout/portal require sign-in.
app.use('/api/billing', billing.apiRouter());

function requireAuth(req, res, next) {
    if (req.user && !req.user.isLocked) return next();
    if ((req.headers.accept || '').includes('text/html')) return res.redirect('/login.html');
    return res.status(401).json({ error: 'Not authenticated' });
}
function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.isLocked) return res.status(403).json({ error: 'Account locked' });
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    next();
}

// ─── Auth API (public) ───────────────────────────────────────────────────────
app.post('/auth/register', (req, res) => {
    const email = normEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    if (findByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists.' });

    const firstUser = users.length === 0; // first account bootstraps an admin
    const user = {
        id: crypto.randomUUID(),
        email,
        passwordHash: hashPassword(password),
        isAdmin: firstUser,
        isLocked: false,
        mustChangePassword: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers();

    setSessionCookie(res, createSession(user.id));
    res.json({ user: publicUser(user) });
});

app.post('/auth/login', (req, res) => {
    const email = normEmail(req.body.email);
    const password = String(req.body.password || '');
    const user = findByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    if (user.isLocked) return res.status(403).json({ error: 'This account is locked. Contact an admin.' });

    user.lastLoginAt = new Date().toISOString();
    saveUsers();
    setSessionCookie(res, createSession(user.id));
    res.json({ user: publicUser(user) });
});

app.post('/auth/logout', (req, res) => {
    destroySession(req.sessionToken);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
});

app.get('/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user: publicUser(req.user) });
});

app.post('/auth/forgot', (req, res) => {
    const email = normEmail(req.body.email);
    const user = findByEmail(email);
    // Only act if the account exists, but always respond ok so we don't leak
    // which emails are registered.
    if (user) {
        // Keep the lightweight reset-request record so the admin panel's one-click
        // "issue a temporary password" fulfill flow still works.
        if (!resetRequests.some((r) => r.email === email)) {
            resetRequests.push({ id: crypto.randomUUID(), email, requestedAt: new Date().toISOString() });
            saveResets();
        }
        // And open a support ticket so it lands in the help desk and the user has
        // a conversation thread waiting once they regain access.
        try { openPasswordResetTicket(user, req.body.message); } catch (e) { /* non-fatal */ }
    }
    res.json({ ok: true });
});

app.get('/auth/support', (req, res) => {
    res.json({ supportEmail: SUPPORT_EMAIL });
});

// Optional: let a signed-in user change their own password (clears mustChange).
app.post('/auth/change-password', requireAuth, (req, res) => {
    const current = String(req.body.currentPassword || '');
    const next = String(req.body.newPassword || '');
    if (!verifyPassword(current, req.user.passwordHash)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    if (next.length < 10) return res.status(400).json({ error: 'New password must be at least 10 characters.' });
    req.user.passwordHash = hashPassword(next);
    req.user.mustChangePassword = false;
    saveUsers();
    res.json({ ok: true });
});

// ─── Admin API ────────────────────────────────────────────────────────────────
app.get('/admin/users', requireAdmin, (req, res) => {
    const search = normEmail(req.query.search);
    let list = users;
    if (search) list = list.filter((u) => u.email.includes(search));
    list = [...list].sort((a, b) => a.email.localeCompare(b.email));
    res.json({ users: list.map(publicUser) });
});

app.post('/admin/users', requireAdmin, (req, res) => {
    const email = normEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    if (findByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists.' });

    const user = {
        id: crypto.randomUUID(),
        email,
        passwordHash: hashPassword(password),
        isAdmin: !!req.body.isAdmin,
        isLocked: false,
        mustChangePassword: true, // admin-created users must reset on first sign-in
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
    };
    users.push(user);
    saveUsers();
    res.json({ user: publicUser(user) });
});

app.post('/admin/users/:id/admin', requireAdmin, (req, res) => {
    const user = findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const makeAdmin = !!req.body.admin;
    if (!makeAdmin && user.isSuperAdmin) {
        return res.status(400).json({ error: 'Cannot revoke admin from the super admin.' });
    }
    if (!makeAdmin && user.isAdmin && adminCount() <= 1) {
        return res.status(400).json({ error: 'Cannot revoke the last remaining admin.' });
    }
    user.isAdmin = makeAdmin;
    saveUsers();
    res.json({ user: publicUser(user) });
});

app.post('/admin/users/:id/lock', requireAdmin, (req, res) => {
    const user = findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const lock = !!req.body.lock;
    if (lock && user.isSuperAdmin) {
        return res.status(400).json({ error: 'Cannot lock the super admin.' });
    }
    if (lock && user.isAdmin && adminCount() <= 1) {
        return res.status(400).json({ error: 'Cannot lock the last remaining admin.' });
    }
    user.isLocked = lock;
    if (lock) destroySessionsForUser(user.id);
    saveUsers();
    res.json({ user: publicUser(user) });
});

app.delete('/admin/users/:id', requireAdmin, (req, res) => {
    const user = findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.isSuperAdmin) {
        return res.status(400).json({ error: 'Cannot delete the super admin.' });
    }
    if (user.isAdmin && adminCount() <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last remaining admin.' });
    }
    users = users.filter((u) => u.id !== user.id);
    resetRequests = resetRequests.filter((r) => r.email !== user.email);
    destroySessionsForUser(user.id);
    if (logos[user.id]) { delete logos[user.id]; saveLogos(); }
    if (userSettings[user.id]) { delete userSettings[user.id]; saveUserSettings(); }
    if (streamConfigs[user.id]) { delete streamConfigs[user.id]; saveStreamConfigs(); }
    liveSessions.delete(user.id);
    { const a = agents.get(user.id); if (a) { try { a.res.end(); } catch {} agents.delete(user.id); } }
    saveUsers();
    saveResets();
    res.json({ ok: true });
});

// Directly reset any user's password from the admin panel (no pending request
// needed). Sets a temporary password the user must change on next sign-in, and
// signs out their active sessions so the old password stops working everywhere.
app.post('/admin/users/:id/reset-password', requireAdmin, (req, res) => {
    const user = findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    user.passwordHash = hashPassword(newPassword);
    user.mustChangePassword = true;
    user.isLocked = false;
    destroySessionsForUser(user.id);
    // Clear any pending reset request for this user now that it's handled.
    resetRequests = resetRequests.filter((r) => r.email !== user.email);
    saveUsers();
    saveResets();
    res.json({ ok: true });
});

app.get('/admin/reset-requests', requireAdmin, (req, res) => {
    const list = [...resetRequests].sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));
    res.json({ requests: list });
});

app.post('/admin/reset-requests/:id/fulfill', requireAdmin, (req, res) => {
    const reqItem = resetRequests.find((r) => r.id === req.params.id);
    if (!reqItem) return res.status(404).json({ error: 'Request not found.' });
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    const user = findByEmail(reqItem.email);
    if (!user) {
        resetRequests = resetRequests.filter((r) => r.id !== reqItem.id);
        saveResets();
        return res.status(404).json({ error: 'The user for this request no longer exists.' });
    }
    user.passwordHash = hashPassword(newPassword);
    user.mustChangePassword = true;
    user.isLocked = false;
    destroySessionsForUser(user.id);
    resetRequests = resetRequests.filter((r) => r.id !== reqItem.id);
    saveUsers();
    saveResets();
    res.json({ ok: true });
});

app.post('/admin/reset-requests/:id/dismiss', requireAdmin, (req, res) => {
    resetRequests = resetRequests.filter((r) => r.id !== req.params.id);
    saveResets();
    res.json({ ok: true });
});

// ─── Community storm reports API ─────────────────────────────────────────────
function publicReport(r, userId) {
    return {
        id: r.id,
        type: r.type,
        lat: r.lat,
        lng: r.lng,
        accuracy: r.accuracy != null ? r.accuracy : null,
        notes: r.notes || '',
        measure: r.measure || null,
        measureUnit: r.measureUnit || '',
        time: r.time,
        mine: r.userId === userId,
    };
}

app.get('/api/reports', requireAuth, (req, res) => {
    const list = [...reports].sort((a, b) => new Date(b.time) - new Date(a.time));
    res.json({ reports: list.map((r) => publicReport(r, req.user.id)) });
});

app.post('/api/reports', requireAuth, (req, res) => {
    const b = req.body || {};
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    const accuracy = Number(b.accuracy);
    if (!b.type || typeof b.type !== 'string') return res.status(400).json({ error: 'A hazard type is required.' });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'A valid location is required.' });

    const report = {
        id: crypto.randomUUID(),
        userId: req.user.id,
        type: b.type.slice(0, 40),
        lat, lng,
        accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null,
        notes: String(b.notes || '').slice(0, 500),
        measure: b.measure != null ? String(b.measure).slice(0, 20) : null,
        measureUnit: String(b.measureUnit || '').slice(0, 10),
        time: new Date().toISOString(),
    };
    reports.push(report);
    saveReports();
    res.json({ report: publicReport(report, req.user.id) });
});

app.delete('/api/reports/:id', requireAuth, (req, res) => {
    const report = reports.find((r) => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    if (report.userId !== req.user.id && !req.user.isAdmin) {
        return res.status(403).json({ error: 'You can only delete your own reports.' });
    }
    reports = reports.filter((r) => r.id !== report.id);
    saveReports();
    res.json({ ok: true });
});

app.delete('/api/reports', requireAuth, (req, res) => {
    reports = reports.filter((r) => r.userId !== req.user.id);
    saveReports();
    res.json({ ok: true });
});

// ─── Per-user brand logo overlay ─────────────────────────────────────────────
const LOGO_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

app.get('/api/logo', requireAuth, (req, res) => {
    res.json({ logo: logos[req.user.id] || null });
});

app.post('/api/logo', requireAuth, (req, res) => {
    const b = req.body || {};
    const dataUrl = String(b.dataUrl || '');
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(dataUrl)) {
        return res.status(400).json({ error: 'Please choose a valid image file.' });
    }
    if (dataUrl.length > 3500000) {
        return res.status(413).json({ error: 'That image is too large. Try a smaller logo.' });
    }
    logos[req.user.id] = {
        dataUrl,
        corner: LOGO_CORNERS.includes(b.corner) ? b.corner : 'top-right',
        size: Math.min(40, Math.max(5, Number(b.size) || 16)),     // % of viewport width
        opacity: Math.min(1, Math.max(0.1, Number(b.opacity) || 1)),
    };
    saveLogos();
    res.json({ logo: logos[req.user.id] });
});

app.delete('/api/logo', requireAuth, (req, res) => {
    delete logos[req.user.id];
    saveLogos();
    res.json({ ok: true });
});

// ─── Per-user app settings (menu toggles) ────────────────────────────────────
// The Settings menu's toggle switches are saved here per account so a user's
// configuration survives closing the app, refreshes and app updates, and
// follows them across devices. The client sends a snapshot of every toggle;
// we store a sanitized copy (switch id -> boolean) with sane caps.
const MAX_SETTING_SWITCHES = 300;

function sanitizeSettings(body) {
    const src = (body && typeof body.switches === 'object' && body.switches) || {};
    const switches = {};
    let count = 0;
    for (const key of Object.keys(src)) {
        if (count >= MAX_SETTING_SWITCHES) break;
        // Only accept the app's toggle ids, and coerce values to booleans.
        if (typeof key === 'string' && key.length <= 80 && /^armr[A-Za-z0-9_-]*SwitchElem$/.test(key)) {
            switches[key] = !!src[key];
            count++;
        }
    }
    return { switches };
}

app.get('/api/settings', requireAuth, (req, res) => {
    res.json({ settings: userSettings[req.user.id] || null });
});

// POST (not PUT) so the client can flush a final save on close via
// navigator.sendBeacon, which can only issue POST requests.
app.post('/api/settings', requireAuth, (req, res) => {
    userSettings[req.user.id] = sanitizeSettings(req.body);
    saveUserSettings();
    res.json({ settings: userSettings[req.user.id] });
});

// ─── Support tickets ─────────────────────────────────────────────────────────
// An in-app help desk. Any signed-in user can open a ticket and hold a threaded
// conversation with the admins; admins triage every ticket, reply, and change
// status. Stored as JSON like the rest of the app — no email is sent (there is
// no SMTP wired), so replies live in-app and surface via an unread badge.
const TICKET_CATEGORIES = ['Bug', 'Billing', 'Feature request', 'Account', 'Other'];
const TICKET_STATUSES = ['open', 'answered', 'closed'];
const findTicket = (id) => tickets.find((t) => t.id === id);

// Whether the ticket has a message the given viewer hasn't seen yet. A user has
// unread when the newest message came from an admin (and vice-versa), based on
// the per-role lastRead timestamp we stamp when the thread is opened.
function ticketUnreadFor(t, isAdminViewer) {
    const last = t.messages[t.messages.length - 1];
    if (!last) return false;
    if (isAdminViewer) {
        return !last.isAdmin && new Date(t.updatedAt) > new Date(t.lastReadByAdmin || 0);
    }
    return last.isAdmin && new Date(t.updatedAt) > new Date(t.lastReadByUser || 0);
}

function ticketSummary(t, viewer) {
    const isAdminViewer = !!viewer.isAdmin;
    return {
        id: t.id,
        subject: t.subject,
        category: t.category,
        kind: t.kind || null,
        status: t.status,
        email: t.email,
        mine: t.userId === viewer.id,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        messageCount: t.messages.length,
        unread: ticketUnreadFor(t, isAdminViewer),
    };
}

function ticketFull(t, viewer) {
    return {
        ...ticketSummary(t, viewer),
        messages: t.messages.map((m) => ({
            id: m.id,
            body: m.body,
            isAdmin: m.isAdmin,
            author: (m.authorEmail || '').split('@')[0],
            time: m.time,
            mine: m.authorId === viewer.id,
        })),
    };
}

// Open (or append to) the help-desk ticket that backs a password-reset request.
// A locked-out user can't sign in to use the normal ticket form, so /auth/forgot
// calls this on their behalf once it has resolved the account by email. The
// ticket is owned by that account, so the user sees the whole thread as soon as
// they're back in, and admins triage it alongside every other ticket.
function openPasswordResetTicket(user, note) {
    const now = new Date().toISOString();
    const cleanNote = clampStr(note, 2000).trim();

    // Reuse an existing, still-open password-reset ticket so repeat requests
    // don't spawn duplicates — just append the new note (if any).
    let t = tickets.find((x) => x.userId === user.id && x.kind === 'password-reset' && x.status !== 'closed');
    if (t) {
        if (cleanNote) {
            t.messages.push({ id: crypto.randomUUID(), authorId: user.id, authorEmail: user.email, isAdmin: false, body: cleanNote, time: now });
        }
        t.updatedAt = now;
        t.status = 'open';
        t.lastReadByUser = now;
        saveTickets();
        return t;
    }

    const body = cleanNote || 'I forgot my password and need help getting back into my account.';
    t = {
        id: crypto.randomUUID(),
        userId: user.id,
        email: user.email,
        subject: 'Password reset request',
        category: 'Account',
        kind: 'password-reset',
        status: 'open',
        createdAt: now,
        updatedAt: now,
        lastReadByUser: now,
        lastReadByAdmin: null,
        messages: [{ id: crypto.randomUUID(), authorId: user.id, authorEmail: user.email, isAdmin: false, body, time: now }],
    };
    tickets.push(t);
    saveTickets();
    return t;
}

// List the caller's own tickets (newest activity first).
app.get('/api/support/tickets', requireAuth, (req, res) => {
    const list = tickets
        .filter((t) => t.userId === req.user.id)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ tickets: list.map((t) => ticketSummary(t, req.user)) });
});

// Open a new ticket. The subject + first message are required.
app.post('/api/support/tickets', requireAuth, (req, res) => {
    const b = req.body || {};
    const subject = clampStr(b.subject, 140).trim();
    const body = clampStr(b.body, 5000).trim();
    const category = TICKET_CATEGORIES.includes(b.category) ? b.category : 'Other';
    if (!subject) return res.status(400).json({ error: 'A subject is required.' });
    if (!body) return res.status(400).json({ error: 'Please describe your issue.' });

    const now = new Date().toISOString();
    const ticket = {
        id: crypto.randomUUID(),
        userId: req.user.id,
        email: req.user.email,
        subject,
        category,
        status: 'open',
        createdAt: now,
        updatedAt: now,
        lastReadByUser: now,   // author has seen their own opening message
        lastReadByAdmin: null,
        messages: [{
            id: crypto.randomUUID(),
            authorId: req.user.id,
            authorEmail: req.user.email,
            isAdmin: false,
            body,
            time: now,
        }],
    };
    tickets.push(ticket);
    saveTickets();
    res.json({ ticket: ticketFull(ticket, req.user) });
});

// A single ticket with its full thread. Viewing marks it read for this role.
app.get('/api/support/tickets/:id', requireAuth, (req, res) => {
    const t = findTicket(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found.' });
    if (t.userId !== req.user.id && !req.user.isAdmin) {
        return res.status(403).json({ error: 'You can only view your own tickets.' });
    }
    if (req.user.isAdmin) t.lastReadByAdmin = new Date().toISOString();
    if (t.userId === req.user.id) t.lastReadByUser = new Date().toISOString();
    saveTickets();
    res.json({ ticket: ticketFull(t, req.user) });
});

// Add a reply to a thread. An admin reply moves the ticket to 'answered'; a
// user reply (re)opens it. Replying to a closed ticket reopens it.
app.post('/api/support/tickets/:id/reply', requireAuth, (req, res) => {
    const t = findTicket(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found.' });
    const isOwner = t.userId === req.user.id;
    if (!isOwner && !req.user.isAdmin) {
        return res.status(403).json({ error: 'You cannot reply to this ticket.' });
    }
    const body = clampStr((req.body || {}).body, 5000).trim();
    if (!body) return res.status(400).json({ error: 'Reply cannot be empty.' });

    // An admin who is not the owner replies as staff; the owner replies as a user
    // even if they happen to be an admin themselves.
    const asAdmin = req.user.isAdmin && !isOwner;
    const now = new Date().toISOString();
    t.messages.push({
        id: crypto.randomUUID(),
        authorId: req.user.id,
        authorEmail: req.user.email,
        isAdmin: asAdmin,
        body,
        time: now,
    });
    t.updatedAt = now;
    // A staff reply marks it answered; a user reply (re)opens it — even from closed.
    t.status = asAdmin ? 'answered' : 'open';
    if (asAdmin) t.lastReadByAdmin = now; else t.lastReadByUser = now;
    saveTickets();
    res.json({ ticket: ticketFull(t, req.user) });
});

// Close (or reopen) a ticket. Owner or admin.
app.post('/api/support/tickets/:id/status', requireAuth, (req, res) => {
    const t = findTicket(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found.' });
    if (t.userId !== req.user.id && !req.user.isAdmin) {
        return res.status(403).json({ error: 'You cannot change this ticket.' });
    }
    const status = String((req.body || {}).status || '');
    if (!TICKET_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    t.status = status;
    t.updatedAt = new Date().toISOString();
    saveTickets();
    res.json({ ticket: ticketFull(t, req.user) });
});

// Small badge count for the current viewer (tickets needing their attention).
app.get('/api/support/unread', requireAuth, (req, res) => {
    const isAdminViewer = !!req.user.isAdmin;
    let count = 0;
    for (const t of tickets) {
        if (isAdminViewer) {
            if (t.status !== 'closed' && ticketUnreadFor(t, true)) count++;
        } else if (t.userId === req.user.id && ticketUnreadFor(t, false)) {
            count++;
        }
    }
    res.json({ count });
});

// Admin: every ticket, newest activity first, optionally filtered.
app.get('/api/support/admin/tickets', requireAdmin, (req, res) => {
    const status = String(req.query.status || '');
    const search = normEmail(req.query.search);
    let list = [...tickets];
    if (TICKET_STATUSES.includes(status)) list = list.filter((t) => t.status === status);
    if (search) list = list.filter((t) => (t.email || '').includes(search) || (t.subject || '').toLowerCase().includes(search));
    list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ tickets: list.map((t) => ticketSummary(t, req.user)) });
});

// ─── Chase Stream Hub ────────────────────────────────────────────────────────
// Per-user streaming config (OBS connection, auto-post destinations, title
// template) plus the live-session registry that lets chasers see each other's
// live location markers on the map. Video itself is handled by the chaser's OBS
// (controlled from the browser over obs-websocket); the server stores settings,
// fans out go-live announcements, and tracks who is currently live.
const clampStr = (v, n) => String(v == null ? '' : v).slice(0, n);
const clampNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// What we hand back to the client. The Discord webhook is a shared secret, so we
// never echo it in full — just whether one is set — while OBS host/port (needed
// to reconnect) are returned. The OBS password is likewise kept write-only.
function publicStreamConfig(c) {
    c = c || {};
    return {
        titleTemplate: c.titleTemplate || '🔴 LIVE — chasing near {place} — {time}',
        obs: {
            host: (c.obs && c.obs.host) || 'localhost',
            port: (c.obs && c.obs.port) || 4455,
            overlaySource: (c.obs && c.obs.overlaySource) || '',
            // Returned to the client (not just hasPassword) because the browser
            // is what authenticates to OBS over obs-websocket on the user's LAN —
            // the server can't reach OBS. It's the user's own local password.
            password: (c.obs && c.obs.password) || '',
            hasPassword: !!(c.obs && c.obs.password),
        },
        discordConfigured: !!c.discordWebhook,
        remoteControl: !!c.remoteControl,
        // Manual RTMP destination (e.g. a persistent ingest URL + key).
        // Unlike the Discord webhook, the key is returned to the client because
        // the browser is what pushes it into OBS over obs-websocket (OBS is on
        // the user's LAN, unreachable from the server). It's the user's own key,
        // readable only by their authenticated session.
        rtmp: {
            enabled: !!(c.rtmp && c.rtmp.enabled),
            url: (c.rtmp && c.rtmp.url) || '',
            key: (c.rtmp && c.rtmp.key) || '',
        },
        facebookConfigured: !!(c.facebook && c.facebook.pageToken),
        autoPost: {
            discord: !!(c.autoPost && c.autoPost.discord),
            facebook: !!(c.autoPost && c.autoPost.facebook),
        },
    };
}

app.get('/api/stream/config', requireAuth, (req, res) => {
    res.json({ config: publicStreamConfig(streamConfigs[req.user.id]) });
});

// Save config. Secret fields (discordWebhook, obs.password) are only overwritten
// when the client actually sends a new value, so re-saving other settings
// doesn't wipe them.
app.post('/api/stream/config', requireAuth, (req, res) => {
    const b = req.body || {};
    const cur = streamConfigs[req.user.id] || {};
    const next = {
        ...cur,
        titleTemplate: b.titleTemplate != null ? clampStr(b.titleTemplate, 200) : cur.titleTemplate,
        remoteControl: b.remoteControl != null ? !!b.remoteControl : !!cur.remoteControl,
        rtmp: {
            enabled: !!(b.rtmp && b.rtmp.enabled),
            url: clampStr((b.rtmp && b.rtmp.url) != null ? b.rtmp.url : (cur.rtmp && cur.rtmp.url) || '', 300),
            // Keep the saved key unless a new non-empty one is sent (so re-saving
            // other settings doesn't wipe it). Send key:"" via a dedicated clear.
            key: (b.rtmp && typeof b.rtmp.key === 'string' && b.rtmp.key.length)
                ? clampStr(b.rtmp.key, 300)
                : (b.rtmp && b.rtmp.clearKey ? '' : (cur.rtmp && cur.rtmp.key) || ''),
        },
        obs: {
            host: clampStr((b.obs && b.obs.host) || (cur.obs && cur.obs.host) || 'localhost', 120),
            port: clampNum(b.obs && b.obs.port) || (cur.obs && cur.obs.port) || 4455,
            overlaySource: clampStr((b.obs && b.obs.overlaySource) != null ? b.obs.overlaySource : (cur.obs && cur.obs.overlaySource) || '', 120),
            password: (b.obs && typeof b.obs.password === 'string' && b.obs.password.length)
                ? clampStr(b.obs.password, 200)
                : (cur.obs && cur.obs.password) || '',
        },
        autoPost: {
            discord: !!(b.autoPost && b.autoPost.discord),
            facebook: !!(b.autoPost && b.autoPost.facebook),
        },
    };
    if (typeof b.discordWebhook === 'string' && b.discordWebhook.length) {
        // Only accept genuine Discord webhook URLs.
        if (!/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(b.discordWebhook)) {
            return res.status(400).json({ error: 'That does not look like a Discord webhook URL.' });
        }
        next.discordWebhook = clampStr(b.discordWebhook, 300);
    } else if (b.discordWebhook === null) {
        delete next.discordWebhook; // explicit clear
    }
    streamConfigs[req.user.id] = next;
    saveStreamConfigs();
    res.json({ config: publicStreamConfig(next) });
});

// Announce "I'm live" to the configured destinations. Discord is fully wired
// (webhook). Facebook is acknowledged but requires the account OAuth token to
// be connected first; until then it reports as skipped so the UI can prompt.
app.post('/api/stream/announce', requireAuth, async (req, res) => {
    const cfg = streamConfigs[req.user.id] || {};
    const b = req.body || {};
    const title = clampStr(b.title, 300) || 'LIVE now';
    const url = clampStr(b.url, 500);
    const place = clampStr(b.place, 200);
    const results = {};

    if (cfg.autoPost && cfg.autoPost.discord && cfg.discordWebhook) {
        try {
            const embed = {
                title,
                description: place ? `📍 ${place}` : undefined,
                url: /^https?:\/\//.test(url) ? url : undefined,
                color: 0xff3b30,
                timestamp: new Date().toISOString(),
                footer: { text: 'Vortex Radar — Chase Stream Hub' },
            };
            const r = await fetch(cfg.discordWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: place ? `🔴 **LIVE** near ${place}` : '🔴 **LIVE now**', embeds: [embed] }),
            });
            results.discord = r.ok ? 'posted' : ('error ' + r.status);
        } catch (e) { results.discord = 'error'; }
    } else if (cfg.autoPost && cfg.autoPost.discord) {
        results.discord = 'no-webhook';
    }

    // Facebook remains a placeholder until Phase 2.
    if (cfg.autoPost && cfg.autoPost.facebook) results.facebook = cfg.facebook ? 'unsupported' : 'not-connected';

    res.json({ results });
});

// Mark this user live (or update their moving position). Body: { lat, lng,
// place, title, url }. Stored in memory so other chasers can render the marker.
app.post('/api/stream/live', requireAuth, (req, res) => {
    const b = req.body || {};
    const lat = clampNum(b.lat), lng = clampNum(b.lng);
    liveSessions.set(req.user.id, {
        lat, lng,
        place: clampStr(b.place, 200),
        title: clampStr(b.title, 300),
        url: clampStr(b.url, 500),
        email: req.user.email,
        startedAt: (liveSessions.get(req.user.id) || {}).startedAt || Date.now(),
        updatedAt: Date.now(),
    });
    res.json({ ok: true });
});

app.post('/api/stream/offline', requireAuth, (req, res) => {
    liveSessions.delete(req.user.id);
    res.json({ ok: true });
});

// Everyone currently live (for map markers). Excludes the caller — the client
// draws its own marker locally. Coarsely public to signed-in users.
app.get('/api/stream/live', requireAuth, (req, res) => {
    pruneLiveSessions();
    const list = [];
    for (const [uid, s] of liveSessions) {
        if (uid === req.user.id) continue;
        if (s.lat == null || s.lng == null) continue;
        list.push({
            id: uid,
            lat: s.lat, lng: s.lng,
            place: s.place || '',
            title: s.title || '',
            url: s.url || '',
            name: (s.email || '').split('@')[0],
            startedAt: s.startedAt,
        });
    }
    res.json({ live: list });
});

// ─── Remote OBS control relay (operator dashboard → chaser agent) ────────────
// Chasers who opt in keep Vortex open on their streaming PC; their browser holds
// an SSE "agent" connection here and a local connection to their own OBS.
// Operators (admins) list connected agents and send commands, which we relay
// over SSE to the target agent, whose browser runs them against its local OBS.
// The agent dials OUT to us, so no chaser needs to port-forward their router.
const agents = new Map(); // userId -> { res, status, email, connectedAt, lastSeen }

function sseSend(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {}
}

// Chaser agent connects here (Server-Sent Events). Being connected = opted in.
app.get('/api/stream/agent', requireAuth, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // don't let a proxy buffer the stream
    });
    res.write('retry: 5000\n\n');
    const uid = req.user.id;
    const prev = agents.get(uid);
    if (prev && prev.res && prev.res !== res) { try { prev.res.end(); } catch {} }
    const agent = { res, status: { obsConnected: false, streaming: false }, email: req.user.email, connectedAt: Date.now(), lastSeen: Date.now() };
    agents.set(uid, agent);
    sseSend(res, 'hello', { ok: true });
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(hb); if (agents.get(uid) === agent) agents.delete(uid); });
});

// Agent reports its OBS/stream state so operators see live status.
app.post('/api/stream/agent/status', requireAuth, (req, res) => {
    const a = agents.get(req.user.id);
    if (a) {
        const b = req.body || {};
        a.status = {
            obsConnected: !!b.obsConnected,
            streaming: !!b.streaming,
            scene: clampStr(b.scene, 80),
            place: clampStr(b.place, 200),
            title: clampStr(b.title, 300),
        };
        a.lastSeen = Date.now();
    }
    res.json({ ok: true });
});

// Operator: list connected chaser agents + their status.
app.get('/api/stream/agents', requireAdmin, (req, res) => {
    const list = [];
    for (const [uid, a] of agents) {
        list.push({ id: uid, name: (a.email || '').split('@')[0], email: a.email, status: a.status, connectedAt: a.connectedAt, lastSeen: a.lastSeen });
    }
    list.sort((x, y) => x.name.localeCompare(y.name));
    res.json({ agents: list });
});

// Operator: send a command to a chaser agent, relayed over its SSE stream.
const AGENT_ACTIONS = ['start', 'stop', 'scene', 'title'];
app.post('/api/stream/agent/command', requireAdmin, (req, res) => {
    const b = req.body || {};
    const target = agents.get(String(b.targetUserId || ''));
    if (!target) return res.status(404).json({ error: 'That chaser is not connected.' });
    if (!AGENT_ACTIONS.includes(b.action)) return res.status(400).json({ error: 'Unknown action.' });
    sseSend(target.res, 'command', { action: b.action, args: b.args || {}, by: req.user.email, id: crypto.randomUUID() });
    res.json({ ok: true });
});

// ─── Push notification device tokens (weather alerts) ────────────────────────
// The Capacitor app (VortexRadarMobile) registers its FCM token here so the
// server can target this device with alert pushes. A token belongs to one
// account at a time — registering it moves it off any other user.
app.post('/api/push/register', requireAuth, (req, res) => {
    const token = String(req.body?.token || '').trim();
    const platform = String(req.body?.platform || 'android').slice(0, 16);
    if (!token || token.length > 4096) return res.status(400).json({ error: 'A valid token is required.' });

    // Remove this token from every user first (device re-assignment / re-install).
    for (const uid of Object.keys(pushTokens)) {
        pushTokens[uid] = (pushTokens[uid] || []).filter((t) => t.token !== token);
        if (!pushTokens[uid].length) delete pushTokens[uid];
    }
    const list = pushTokens[req.user.id] || (pushTokens[req.user.id] = []);
    list.push({ token, platform, updatedAt: new Date().toISOString() });
    // Cap stored tokens per user (a user may have a few devices).
    if (list.length > 10) list.splice(0, list.length - 10);
    savePushTokens();
    res.json({ ok: true });
});

app.delete('/api/push/register', requireAuth, (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (token && pushTokens[req.user.id]) {
        pushTokens[req.user.id] = pushTokens[req.user.id].filter((t) => t.token !== token);
        if (!pushTokens[req.user.id].length) delete pushTokens[req.user.id];
    } else {
        delete pushTokens[req.user.id];
    }
    savePushTokens();
    res.json({ ok: true });
});

// ─── Level-II proxy ──────────────────────────────────────────────────────────
// The archive bucket (noaa-nexrad-level2) denies anonymous listing, so we use
// the realtime chunks bucket (unidata-nexrad-level2-chunks). A volume is stored
// as ordered chunks under SITE/<volume#>/...-NNN-{S|I|E}; concatenating them in
// sequence order reproduces a full Archive-II file. Done server-side to avoid
// browser CORS.
const L2_CHUNKS = 'https://unidata-nexrad-level2-chunks.s3.amazonaws.com';

async function s3ListText(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('S3 listing failed (' + r.status + ')');
    return r.text();
}
function chunkSeq(key) { const m = key.match(/-(\d+)-[SIE]$/); return m ? parseInt(m[1], 10) : 0; }

async function listVolumeFolders(station) {
    const xml = await s3ListText(`${L2_CHUNKS}/?list-type=2&delimiter=/&prefix=${station}/`);
    return [...xml.matchAll(/<Prefix>[^<]*\/(\d+)\/<\/Prefix>/g)].map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n));
}
function pickLatestFolder(nums) {
    const max = Math.max(...nums), min = Math.min(...nums);
    // Volume numbers wrap 0..999; if the set straddles a wrap, newest is the low cluster.
    return (max - min > 500) ? Math.max(...nums.filter((n) => n < 500)) : max;
}
async function listVolumeChunks(station, folder) {
    const xml = await s3ListText(`${L2_CHUNKS}/?list-type=2&prefix=${station}/${folder}/`);
    return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]).sort((a, b) => chunkSeq(a) - chunkSeq(b));
}

async function fetchLatestL2(station) {
    const folders = await listVolumeFolders(station);
    if (!folders.length) throw new Error('No realtime Level-II found for ' + station + '.');
    let folder = pickLatestFolder(folders);
    let keys = await listVolumeChunks(station, folder);
    // Prefer a completed volume (has an end chunk); else fall back one volume.
    if (!keys.some((k) => /-E$/.test(k))) {
        const prev = folder > 0 ? folder - 1 : Math.max(...folders);
        if (folders.includes(prev)) {
            const pk = await listVolumeChunks(station, prev);
            if (pk.some((k) => /-E$/.test(k))) keys = pk;
        }
    }
    if (!keys.length) throw new Error('No Level-II chunks in latest volume for ' + station + '.');
    const parts = await Promise.all(keys.map(async (k) => {
        const r = await fetch(`${L2_CHUNKS}/${k}`, { cache: 'no-store' });
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    }));
    return Buffer.concat(parts.filter(Boolean));
}

app.get('/api/level2/latest', requireAuth, async (req, res) => {
    const station = String(req.query.station || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!station) return res.status(400).json({ error: 'A station is required.' });
    try {
        const buf = await fetchLatestL2(station);
        if (!buf.length) throw new Error('Empty Level-II volume.');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.send(buf);
    } catch (err) {
        res.status(502).json({ error: err.message || 'Level-II fetch failed.' });
    }
});

// ─── Generic CORS proxy for weather data hosts (replaces corsproxy.io) ───────
// The app prepends this to external URLs (lightning, storm tracks, SPC, surface
// fronts, METARs, hurricanes). Server-side fetch avoids browser CORS. Restricted
// to trusted weather-data hosts to limit SSRF.
const PROXY_ALLOWED = ['noaa.gov', 'weather.gov', 'aviationweather.gov', 'saratoga-weather.org', 'placefilenation.com', 'navy.mil', 'adsb.lol'];
function proxyHostAllowed(host) {
    host = String(host || '').toLowerCase();
    return PROXY_ALLOWED.some((h) => host === h || host.endsWith('.' + h));
}
app.get('/api/proxy', requireAuth, async (req, res) => {
    // The app concatenates the target URL unencoded after `url=`, so read it
    // straight from the raw query rather than via req.query (which stops at &).
    const raw = req.originalUrl;
    const idx = raw.indexOf('url=');
    let target = idx >= 0 ? raw.slice(idx + 4) : '';
    if (/^https?%3a/i.test(target)) { try { target = decodeURIComponent(target); } catch {} }
    if (!target) return res.status(400).json({ error: 'A url is required.' });
    let host;
    try { host = new URL(target).hostname; } catch { return res.status(400).json({ error: 'Invalid url.' }); }
    if (!proxyHostAllowed(host)) return res.status(403).json({ error: 'Host not allowed: ' + host });
    try {
        const upstream = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (VortexRadar)', 'Accept': '*/*' } });
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.status(upstream.status);
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
        const lastMod = upstream.headers.get('last-modified');
        if (lastMod) res.setHeader('Last-Modified', lastMod);
        res.setHeader('Cache-Control', 'no-store');
        res.send(buf);
    } catch (err) {
        res.status(502).json({ error: 'Proxy fetch failed: ' + (err.message || err) });
    }
});

// ─── Spotter Network proxy (avoids browser CORS) ─────────────────────────────
async function spotterProxy(endpoint, req, res) {
    try {
        const upstream = await fetch(`https://www.spotternetwork.org/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body || {}),
        });
        const text = await upstream.text();
        res.status(upstream.status).type('application/json').send(text);
    } catch (err) {
        res.status(502).json({ error: 'Spotter Network is unavailable.' });
    }
}
app.post('/api/spotters/positions', requireAuth, (req, res) => spotterProxy('positions', req, res));
app.post('/api/spotters/reports', requireAuth, (req, res) => spotterProxy('reports', req, res));

// ─── NOAA model data access layer (GFS/HRRR/NAM/GEFS/NDFD on public S3) ──────
// Pro-gated: models & forecasts require a Pro subscription (no-op if billing
// isn't configured).
app.use('/api/models', requireAuth, billing.requirePro);
require('./model_data').attachModels(app, requireAuth);

// ─── Static files ──────────────────────────────────────────────────────────────
const sendFile = (file) => (req, res) => res.sendFile(path.join(ROOT, file));

// Public pages / assets (reachable without a session).
app.get('/login.html', sendFile('login.html'));
app.get('/admin.html', sendFile('admin.html'));
app.get('/manifest.json', sendFile('manifest.json'));
app.get('/logo.png', sendFile('logo.png'));
app.use('/icons', express.static(path.join(ROOT, 'icons')));

// Everything past this point requires a valid (unlocked) session.
app.use(requireAuth);

// Never serve secrets or server code, even to authenticated users.
app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    if (p.startsWith('/server_data') || p.startsWith('/node_modules') ||
        p === '/server.js' || p === '/billing.js' || p === '/model_data.js' ||
        p.startsWith('/.env') || p.startsWith('/package') || p.startsWith('/.git')) {
        return res.status(404).end();
    }
    next();
});

// Pro-gate the Vortex Graphics studio (redirects free users to an upgrade
// prompt; no-op if billing isn't configured).
app.use('/graphics', billing.requireProPage);

app.get('/', sendFile('index.html'));
app.use(express.static(ROOT, { index: false }));

// Final 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

ensureSuperAdmin();

// Bind to 0.0.0.0 (all interfaces) so hosts like Render can route external
// traffic to the service — binding to localhost only would refuse those
// connections (ERR_CONNECTION_RESET).
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Vortex Radar server running on ${HOST}:${PORT}`);
});
