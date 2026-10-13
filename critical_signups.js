/*
 * critical_signups.js — sign-ups for warnings by email and text
 * ────────────────────────────────────────────────────────────────────────────
 * A signed-in user leaves an email address and/or a US mobile number, and the
 * list appears in the admin panel. Nothing is sent from here: the admin
 * contacts people by hand. So this is a list, kept tidy, and nothing more.
 *
 * TEXTS NEED EXPLICIT CONSENT. A number is only accepted with the consent box
 * ticked, and the time is kept with it, so the admin can always show that a
 * person asked to be texted. Somebody who replies STOP is removed with the
 * Remove button in the admin panel, which drops the consent with the number.
 *
 * Saved places are shown alongside each sign-up because they are what tells
 * the admin who is under a given warning.
 */

const path = require('path');

/** US numbers only — NWS warnings are US-only. Returns E.164 or null. */
function normPhone(v) {
    const d = String(v == null ? '' : v).replace(/\D/g, '');
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d[0] === '1') return '+' + d;
    return null;
}

function normEmail(v) {
    const s = String(v == null ? '' : v).trim().slice(0, 200);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

function attachCriticalSignups({ app, requireAuth, requireAdmin, DATA_DIR, readJson, writeJson, getLocations }) {
    const FILE = path.join(DATA_DIR, 'crit_signups.json');
    // userId -> { account, email: { value, at } | null, sms: { value, at, consentAt } | null }
    let signups = readJson(FILE, {});
    const save = () => { try { writeJson(FILE, signups); } catch (e) { /* next write */ } };

    const kindOf = (k) => (k === 'sms' || k === 'email' ? k : null);
    const mine = (userId) => {
        const s = signups[userId] || {};
        return { email: s.email || null, sms: s.sms || null };
    };

    function remove(userId, kind) {
        const s = signups[userId];
        if (!s) return;
        s[kind] = null;
        if (!s.email && !s.sms) delete signups[userId];
        save();
    }

    // ── user ─────────────────────────────────────────────────────────────────
    app.get('/api/critical/signup', requireAuth, (req, res) => res.json(mine(req.user.id)));

    app.post('/api/critical/signup', requireAuth, (req, res) => {
        const b = req.body || {};
        const kind = kindOf(b.kind);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        const value = kind === 'sms' ? normPhone(b.value) : normEmail(b.value);
        if (!value) {
            return res.status(400).json({ error: kind === 'sms'
                ? 'Enter a 10-digit US mobile number.'
                : 'That does not look like an email address.' });
        }
        if (kind === 'sms' && b.consent !== true) {
            return res.status(400).json({ error: 'Tick the box to agree to receive text alerts.' });
        }
        const now = new Date().toISOString();
        const s = signups[req.user.id] || (signups[req.user.id] = {});
        s.account = req.user.email || '';
        s[kind] = kind === 'sms' ? { value, at: now, consentAt: now } : { value, at: now };
        save();
        console.log(`[CRIT-SIGNUP] ${s.account || req.user.id} signed up for ${kind === 'sms' ? 'texts' : 'email'}`);
        res.json(mine(req.user.id));
    });

    app.delete('/api/critical/signup/:kind', requireAuth, (req, res) => {
        const kind = kindOf(req.params.kind);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        remove(req.user.id, kind);
        res.json(mine(req.user.id));
    });

    // ── admin ────────────────────────────────────────────────────────────────
    app.get('/admin/critical/signups', requireAdmin, (req, res) => {
        const locations = getLocations() || {};
        const rows = Object.entries(signups).map(([userId, s]) => ({
            userId,
            account: s.account || '',
            email: s.email || null,
            sms: s.sms || null,
            places: (locations[userId] || []).filter((l) => l && l.enabled !== false).map((l) => ({
                name: l.name || 'Location',
                where: [l.city, l.state].filter(Boolean).join(', ') || l.address || l.geocoded || '',
            })),
        }));
        const latest = (r) => Math.max(Date.parse((r.email && r.email.at) || 0) || 0, Date.parse((r.sms && r.sms.at) || 0) || 0);
        rows.sort((a, b) => latest(b) - latest(a));
        res.json({ signups: rows });
    });

    app.delete('/admin/critical/signups/:userId/:kind', requireAdmin, (req, res) => {
        const kind = kindOf(req.params.kind);
        if (!kind) return res.status(400).json({ error: 'kind must be email or sms' });
        if (!signups[req.params.userId]) return res.status(404).json({ error: 'No sign-up for that user.' });
        remove(req.params.userId, kind);
        res.json({ ok: true });
    });

    return { count: () => Object.keys(signups).length };
}

module.exports = { attachCriticalSignups, normPhone, normEmail };
