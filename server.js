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

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
const saveUsers = () => writeJson(USERS_FILE, users);
const saveResets = () => writeJson(RESETS_FILE, resetRequests);
const saveReports = () => writeJson(REPORTS_FILE, reports);
const saveLogos = () => writeJson(LOGOS_FILE, logos);

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
    // Only record a request if the account exists, but always respond ok so we
    // don't leak which emails are registered.
    if (user && !resetRequests.some((r) => r.email === email)) {
        resetRequests.push({ id: crypto.randomUUID(), email, requestedAt: new Date().toISOString() });
        saveResets();
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
    if (!b.type || typeof b.type !== 'string') return res.status(400).json({ error: 'A hazard type is required.' });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'A valid location is required.' });

    const report = {
        id: crypto.randomUUID(),
        userId: req.user.id,
        type: b.type.slice(0, 40),
        lat, lng,
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

// Never serve secrets, even to authenticated users.
app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    if (p.startsWith('/server_data') || p.startsWith('/node_modules') ||
        p === '/server.js' || p.startsWith('/package') || p.startsWith('/.git')) {
        return res.status(404).end();
    }
    next();
});

app.get('/', sendFile('index.html'));
app.use(express.static(ROOT, { index: false }));

// Final 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

ensureSuperAdmin();

app.listen(PORT, () => {
    console.log(`Vortex Radar server running at http://localhost:${PORT}`);
});
