/*
 * embed_api.js — the embeddable radar at api.echoradarwx.com
 * ────────────────────────────────────────────────────────────────────────────
 * Lets other websites show Echo Radar's live radar, with an API key:
 *
 *   https://api.echoradarwx.com/                  how to embed it, and the key request form
 *   https://api.echoradarwx.com/embed?key=…       the map itself (an iframe target)
 *   https://api.echoradarwx.com/embed.js          a loader: <div data-echoradar data-key=…> → iframe
 *   https://api.echoradarwx.com/v1/health         for uptime checks
 *   POST /embed/request-key                       the request form posts here
 *
 * KEYS. The map page only loads with a key an admin has approved (admin
 * panel → "Radar API keys"). Someone who finds the API gets a page telling
 * them to request one. A key can be locked to the websites it was issued for:
 * then the page loads only inside those sites (checked against the Referer the
 * browser sends with the iframe). The docs page's own preview needs no key —
 * its Referer is this host. Keys live in server_data/embed_keys.json.
 *
 * What the key does NOT hide: the map's scripts and the public data they read
 * stay public (they are on the app host too). The key gates the hosted map,
 * which is what other sites embed; it is not a lock on NOAA's data.
 *
 * THE API HOST IS FENCED OFF FROM THE APP. Requests whose Host is one of
 * EMBED_HOSTS (default api.echoradarwx.com) get only the files above and the
 * handful of public app files the map needs (listed in EMBED_ASSETS); anything
 * else is a 404 there. So the login screen, the radar app and every /api/*
 * route behind the session gate are never reachable on that address, even by
 * accident when new routes are added — this runs before all of them.
 *
 * On the app's own host, /embed, /embed.js and /embed/docs answer too (above
 * the session gate, same key rules), handy for checking a change before it is
 * live.
 *
 * The base map is Mapbox (the app's public token): those map loads ARE counted
 * by Mapbox (owner's choice, 2026-10-18).
 *
 * Wiring (Cloudflare Tunnel): add a public hostname api.echoradarwx.com →
 * the same local service as echoradarwx.com. cloudflared passes the original
 * Host header through, which is what the fence keys on.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const ROOT = __dirname;
const EMBED_DIR = path.join(ROOT, 'embed');
const EMBED_HOSTS = String(process.env.EMBED_HOSTS || 'api.echoradarwx.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// App files the embed page loads, by URL. Already public on the app host; on
// the API host these are the only app files served.
const EMBED_ASSETS = {
    '/components/tokens.css': 'components/tokens.css',
    '/components/mrms.js': 'components/mrms.js',
    '/components/mrms_products.js': 'components/mrms_products.js',
    '/components/palettes.js': 'components/palettes.js',
    '/components/basemap_palette.json': 'components/basemap_palette.json',
    // Single-site Level 2: the app's decoder + the Studio's rasteriser (both
    // already public for /broadcast), and the app's radar site pills.
    '/dist/l2_bundle.js': 'dist/l2_bundle.js',
    '/graphics/studio/engine/radar_l2_raster.js': 'graphics/studio/engine/radar_l2_raster.js',
    '/broadcast/site_markers.js': 'broadcast/site_markers.js',
    '/logo.png': 'logo.png',
};

const hostOf = (req) => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.ip || '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "https://www.example.com/page", "example.com" → "example.com". www. is
// dropped so a key for example.com works on www.example.com and back.
function normDomain(s) {
    let h = String(s || '').trim().toLowerCase();
    if (!h) return '';
    try { h = new URL(/^[a-z]+:\/\//.test(h) ? h : 'http://' + h).hostname; } catch (e) { return ''; }
    h = h.replace(/^www\./, '').replace(/\.$/, '');
    return /^[a-z0-9.-]+$/.test(h) && (h.includes('.') || h === 'localhost') ? h : '';
}
function parseDomains(v) {
    const list = Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/);
    return [...new Set(list.map(normDomain).filter(Boolean))].slice(0, 10);
}
const domainAllowed = (host, domains) => {
    const h = String(host || '').replace(/^www\./, '');
    return domains.some((d) => h === d || h.endsWith('.' + d));
};
function refererHost(req) {
    try { return new URL(req.headers.referer || '').hostname.toLowerCase(); } catch (e) { return ''; }
}

function attachEmbedApi(app, deps = {}) {
    const isEmbedHost = (req) => EMBED_HOSTS.includes(hostOf(req));
    const DATA_DIR = deps.DATA_DIR || path.join(ROOT, 'server_data');
    const KEYS_FILE = path.join(DATA_DIR, 'embed_keys.json');
    const sendMail = deps.sendMail || (async () => false);
    const NOTIFY = deps.SUPPORT_EMAIL || '';
    const APP_URL = deps.APP_URL || '';
    const PUBLIC_ORIGIN = `https://${EMBED_HOSTS[0] || 'api.echoradarwx.com'}`;

    // ── the key store ──
    // [{ id, status: pending|active|revoked, key, name, email, website, use,
    //    domains, requestedAt, decidedAt, decidedBy, loads, lastUsedAt, lastSite }]
    let keys = [];
    try { keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch (e) { keys = []; }
    if (!Array.isArray(keys)) keys = [];
    const save = () => {
        try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
        } catch (e) { console.error('[embed] could not save keys:', e.message); }
    };
    // Load counts change on every map view: write them a minute later, not each time.
    let saveTimer = null;
    const saveSoon = () => { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; save(); }, 60 * 1000); };
    const newId = () => crypto.randomBytes(6).toString('hex');
    const newKey = () => 'erx_' + crypto.randomBytes(16).toString('hex');
    const byKey = (k) => keys.find((x) => x.status === 'active' && x.key === k);

    /*
     * May this request open the map? Our own pages (the docs preview) may,
     * key or not. Anyone else needs an active key, and a key locked to sites
     * opens only inside them. A locked key with no Referer is refused: a site
     * could hide its address on purpose to borrow someone else's key.
     */
    function checkKey(req) {
        const ref = refererHost(req);
        const own = !!ref && (ref === hostOf(req) || EMBED_HOSTS.includes(ref));
        const k = clip(req.query.key, 80);
        const rec = k ? byKey(k) : null;
        if (own) return { ok: true };
        if (!k) return { ok: false, why: 'missing' };
        if (!rec) return { ok: false, why: 'invalid' };
        if (rec.domains && rec.domains.length && !domainAllowed(ref, rec.domains)) return { ok: false, why: 'site', ref };
        rec.loads = (rec.loads || 0) + 1;
        rec.lastUsedAt = new Date().toISOString();
        if (ref) rec.lastSite = ref;
        saveSoon();
        return { ok: true };
    }

    function refusalPage(req, why, ref) {
        const docs = isEmbedHost(req) ? '/' : '/embed/docs';
        const head = {
            missing: 'This radar needs an API key',
            invalid: 'This API key is not active',
            site: 'This API key is not set up for this website',
        }[why];
        const body = {
            missing: 'Echo Radar WX’s live radar can be embedded with a free API key.',
            invalid: 'The key in this embed is wrong or has been turned off.',
            site: `The key was issued for other websites${ref ? ` (not ${escHtml(ref)})` : ''}. The site owner can ask Echo Radar WX to add this one.`,
        }[why];
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Echo Radar WX — API key needed</title><meta name="robots" content="noindex">
<style>
  html,body{margin:0;height:100%;background:#0d1117;color:#e6edf3;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .box{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(360px,calc(100% - 32px));box-sizing:border-box;
       padding:18px;background:#161b22;border:1px solid #30363d;border-radius:10px;text-align:center}
  img{width:34px;height:34px;border-radius:6px}
  h1{font-size:16px;margin:8px 0 6px}
  p{margin:0 0 14px;color:#9da7b3;font-size:13px}
  a.btn{display:inline-block;padding:7px 14px;border-radius:6px;background:#2f81f7;color:#fff;text-decoration:none;font-weight:700;font-size:13px}
</style></head><body><div class="box">
  <img src="/logo.png" alt=""><h1>${head}</h1><p>${body}</p>
  <a class="btn" href="${docs}#request" target="_blank" rel="noopener">${why === 'missing' ? 'Request a key' : 'About API keys'}</a>
</div></body></html>`;
    }

    // Any site may frame the map; that is the point of it.
    const frameable = (res) => {
        res.setHeader('Content-Security-Policy', 'frame-ancestors *');
        res.removeHeader('X-Frame-Options');
    };
    const send = (file, { type, maxAge = 300, frame = false, cors = false } = {}) => (req, res) => {
        if (type) res.type(type);
        res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
        if (frame) frameable(res);
        if (cors) res.setHeader('Access-Control-Allow-Origin', '*');
        res.sendFile(path.join(ROOT, file));
    };

    // The map page: never cached anywhere, since the answer depends on the key
    // and the page around it, and a revoked key must stop working.
    const embedPage = (req, res) => {
        frameable(res);
        res.setHeader('Cache-Control', 'private, no-store');
        const r = checkKey(req);
        if (!r.ok) return res.status(r.why === 'missing' ? 401 : 403).type('html').send(refusalPage(req, r.why, r.ref));
        res.type('html').sendFile(path.join(ROOT, 'embed/index.html'));
    };
    const loader = send('embed/loader.js', { type: 'application/javascript', maxAge: 3600, cors: true });
    const docs = send('embed/docs.html', { type: 'html', maxAge: 300 });
    // Radar positions, from the app's own NEXRAD_LOCATIONS table (as /broadcast uses).
    const radarSites = (req, res) => {
        try {
            const { NEXRAD_LOCATIONS } = require('./app/radar/libnexrad/nexrad_locations');
            res.set('Cache-Control', 'public, max-age=86400').set('Access-Control-Allow-Origin', '*').json(NEXRAD_LOCATIONS);
        } catch (e) {
            res.status(500).json({ error: 'radar site table unavailable' });
        }
    };
    const health = (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({ ok: true, service: 'echo-radar-embed', time: new Date().toISOString() });
    };
    // The embed's own files (embed.css, embed_app.js). Not the HTML ones:
    // those have the routes above.
    const embedStatic = (req, res, next) => {
        const name = path.basename(req.path);
        if (!/^[\w.-]+\.(js|css)$/.test(name) || name === 'loader.js') return next();
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.sendFile(path.join(EMBED_DIR, name), (err) => { if (err) next(); });
    };

    // ── key requests (the form on the docs page) ──
    const hits = new Map();   // ip -> [times]
    const tooMany = (ip) => {
        const now = Date.now();
        const list = (hits.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
        list.push(now);
        hits.set(ip, list);
        if (hits.size > 5000) hits.clear();
        return list.length > 5;
    };
    const parseJson = express.json({ limit: '16kb' });
    const requestKey = (req, res) => parseJson(req, res, async () => {
        res.setHeader('Cache-Control', 'no-store');
        const b = req.body || {};
        if (b.company_url) return res.json({ ok: true });   // honeypot: bots fill every field
        if (tooMany(clientIp(req))) return res.status(429).json({ error: 'Too many requests. Please try again in an hour.' });
        const name = clip(b.name, 100);
        const email = clip(b.email, 200).toLowerCase();
        const website = clip(b.website, 300);
        const use = clip(b.use, 1000);
        const domains = parseDomains(b.domains || website);
        if (name.length < 2) return res.status(400).json({ error: 'Please give your name or organisation.' });
        if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please give a valid email address — the key is sent there.' });
        if (!domains.length) return res.status(400).json({ error: 'Please give the website the radar will go on (for example example.com).' });
        if (keys.filter((x) => x.status === 'pending').length >= 300) return res.status(503).json({ error: 'Too many requests are waiting. Please try again later.' });

        // One pending request per email: a second one updates it.
        let rec = keys.find((x) => x.status === 'pending' && x.email === email);
        if (!rec) { rec = { id: newId(), status: 'pending', requestedAt: new Date().toISOString() }; keys.push(rec); }
        Object.assign(rec, { name, email, website, use, domains, ip: clientIp(req) });
        save();
        if (NOTIFY) {
            sendMail({
                to: NOTIFY,
                subject: `Radar API key request — ${name}`,
                text: `${name} <${email}> asked for a radar API key.\n\n` +
                    `  Website:  ${website || '—'}\n  Sites:    ${domains.join(', ')}\n  Use:      ${use || '—'}\n\n` +
                    `Approve or deny it in the admin panel${APP_URL ? `: ${APP_URL}/#admin` : ''}.\n`,
            }).catch(() => {});
        }
        res.json({ ok: true });
    });

    // ── the API host: embed files only, everything else 404 ──
    app.use((req, res, next) => {
        if (!isEmbedHost(req)) return next();
        const p = req.path;
        if (req.method === 'POST' && p === '/embed/request-key') return requestKey(req, res);
        if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });
        if (p === '/' || p === '/index.html') return docs(req, res);
        if (p === '/embed' || p === '/embed/') return embedPage(req, res);
        if (p === '/embed.js') return loader(req, res);
        if (p === '/v1/health') return health(req, res);
        if (p === '/embed/radar-sites.json') return radarSites(req, res);
        if (p === '/robots.txt') return res.type('text/plain').send('User-agent: *\nAllow: /$\nDisallow: /embed\n');
        if (p.startsWith('/embed/')) return embedStatic(req, res, () => res.status(404).json({ error: 'Not found' }));
        if (EMBED_ASSETS[p]) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.sendFile(path.join(ROOT, EMBED_ASSETS[p]));
        }
        return res.status(404).json({ error: 'Not found' });
    });

    // ── the app's own host: the same embed, for previewing ──
    app.get(['/embed', '/embed/'], embedPage);
    app.get('/embed.js', loader);
    app.get('/embed/docs', docs);
    app.get('/embed/radar-sites.json', radarSites);
    app.post('/embed/request-key', requestKey);
    app.use('/embed', embedStatic);

    console.log('[embed] radar embed on', EMBED_HOSTS.join(', '), `(and /embed on the app host); ${keys.filter((x) => x.status === 'active').length} active API key(s)`);

    // ── admin: review requests, issue and revoke keys ──
    // Mounted by server.js once the session middleware and requireAdmin exist.
    function keyEmail(rec) {
        const snippet = `<div data-echoradar data-key="${rec.key}" data-lat="38.5" data-lon="-96.5" data-zoom="4"></div>\n` +
            `<script src="${PUBLIC_ORIGIN}/embed.js" async></script>`;
        return {
            to: rec.email,
            subject: 'Your Echo Radar WX radar API key',
            text: `Hi ${rec.name},\n\nYour Echo Radar WX radar API key is ready:\n\n  ${rec.key}\n\n` +
                (rec.domains && rec.domains.length ? `It works on: ${rec.domains.join(', ')} (and their subdomains).\n\n` : '') +
                `Paste this where the radar should appear (change the location and zoom to suit):\n\n${snippet}\n\n` +
                `The snippet builder and every setting are at ${PUBLIC_ORIGIN}/ — put your key in the "API key" box there.\n\n` +
                `— Echo Radar WX\n`,
        };
    }
    function attachAdmin(requireAdmin) {
        const find = (req, res) => {
            const rec = keys.find((x) => x.id === req.params.id);
            if (!rec) res.status(404).json({ error: 'Key not found.' });
            return rec;
        };
        const view = (x) => ({
            id: x.id, status: x.status, key: x.key || null, name: x.name, email: x.email, website: x.website || '',
            use: x.use || '', domains: x.domains || [], requestedAt: x.requestedAt || null, decidedAt: x.decidedAt || null,
            loads: x.loads || 0, lastUsedAt: x.lastUsedAt || null, lastSite: x.lastSite || null,
        });
        const issue = async (rec, req) => {
            rec.status = 'active';
            rec.key = rec.key || newKey();
            rec.decidedAt = new Date().toISOString();
            rec.decidedBy = req.user && req.user.email;
            save();
            return EMAIL_RE.test(rec.email || '') ? sendMail(keyEmail(rec)) : false;
        };

        app.get('/admin/embed-keys', requireAdmin, (req, res) => {
            const order = { pending: 0, active: 1, revoked: 2 };
            const list = keys.slice().sort((a, b) => (order[a.status] - order[b.status])
                || String(b.decidedAt || b.requestedAt || '').localeCompare(String(a.decidedAt || a.requestedAt || '')));
            res.json({ keys: list.map(view) });
        });
        // Issue a key to someone who did not use the form (your own sites, partners).
        app.post('/admin/embed-keys', requireAdmin, async (req, res) => {
            const b = req.body || {};
            const name = clip(b.name, 100);
            if (!name) return res.status(400).json({ error: 'Give the key a name.' });
            const rec = { id: newId(), status: 'pending', name, email: clip(b.email, 200).toLowerCase(), website: '', use: clip(b.use, 1000),
                domains: parseDomains(b.domains), requestedAt: new Date().toISOString() };
            keys.push(rec);
            const mailed = await issue(rec, req);
            res.json({ key: view(rec), mailed });
        });
        app.post('/admin/embed-keys/:id/approve', requireAdmin, async (req, res) => {
            const rec = find(req, res); if (!rec) return;
            if (req.body && req.body.domains != null) rec.domains = parseDomains(req.body.domains);
            const mailed = await issue(rec, req);
            res.json({ key: view(rec), mailed });
        });
        app.post('/admin/embed-keys/:id/domains', requireAdmin, (req, res) => {
            const rec = find(req, res); if (!rec) return;
            rec.domains = parseDomains(req.body && req.body.domains);
            save();
            res.json({ key: view(rec) });
        });
        app.post('/admin/embed-keys/:id/revoke', requireAdmin, (req, res) => {
            const rec = find(req, res); if (!rec) return;
            rec.status = 'revoked';
            rec.decidedAt = new Date().toISOString();
            rec.decidedBy = req.user && req.user.email;
            save();
            res.json({ key: view(rec) });
        });
        app.post('/admin/embed-keys/:id/restore', requireAdmin, (req, res) => {
            const rec = find(req, res); if (!rec) return;
            if (!rec.key) return res.status(400).json({ error: 'This request was never approved.' });
            rec.status = 'active';
            save();
            res.json({ key: view(rec) });
        });
        // Deny a request, or clear away a revoked key.
        app.delete('/admin/embed-keys/:id', requireAdmin, (req, res) => {
            const rec = find(req, res); if (!rec) return;
            keys = keys.filter((x) => x !== rec);
            save();
            res.json({ ok: true });
        });
    }

    return { attachAdmin };
}

module.exports = { attachEmbedApi, EMBED_HOSTS };
