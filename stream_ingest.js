/*
 * stream_ingest.js — Echo Radar's own RTMP server for the Chase Stream Hub.
 *
 * Every approved streamer gets an RTMP URL and a private stream key to paste
 * into OBS (or that the Hub pushes into OBS for them at Go Live). OBS sends
 * the video to MediaMTX (a single-binary media server, docs: tools/RTMP_SETUP.md)
 * running beside this app; MediaMTX asks THIS server whether each stream key
 * is allowed, and turns the stream into HLS that viewers play inside Echo Radar.
 *
 *   OBS ──RTMP──▶ MediaMTX :1935 ──"may key X publish?"──▶ POST /internal/mediamtx/auth
 *                    │
 *                    └─ HLS 127.0.0.1:8888 ◀── GET /live/<publicId>/… (signed-in viewers)
 *
 * The stream key never appears in a watch link: viewers use a separate public
 * id, and only this server (holding MEDIAMTX_HOOK_SECRET) may read from
 * MediaMTX. Without MEDIAMTX_HOOK_SECRET the feature reports itself as not set
 * up and nothing is exposed.
 *
 * Env:
 *   MEDIAMTX_HOOK_SECRET  shared secret, also in mediamtx.yml's authHTTPAddress (required)
 *   RTMP_PUBLIC_URL       what streamers paste into OBS (default rtmp://ingest.echoradarwx.com/live)
 *   MEDIAMTX_HLS_URL      MediaMTX HLS listener (default http://127.0.0.1:8888)
 *   MEDIAMTX_API_URL      MediaMTX control API  (default http://127.0.0.1:9997)
 */
const crypto = require('crypto');
const { Readable } = require('stream');

const RTMP_URL = process.env.RTMP_PUBLIC_URL || 'rtmp://ingest.echoradarwx.com/live';
const HLS_BASE = (process.env.MEDIAMTX_HLS_URL || 'http://127.0.0.1:8888').replace(/\/$/, '');
const API_BASE = (process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997').replace(/\/$/, '');
const HOOK_SECRET = process.env.MEDIAMTX_HOOK_SECRET || '';
const KEY_RE = /^erx_[a-f0-9]{32}$/;
const PID_RE = /^[a-f0-9]{10}$/;
const POLL_MS = 10 * 1000;

// MediaMTX checks our own reads (HLS proxy, status poll) with these credentials.
const internalAuth = () => ({ Authorization: 'Basic ' + Buffer.from('echoradar:' + HOOK_SECRET).toString('base64') });
const sameSecret = (a, b) => {
    const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

function attachStreamIngest(app, { streamConfigs, saveStreamConfigs, findById, canStream, requireAuth, requireStreamer }) {
    const enabled = !!HOOK_SECRET;
    if (!enabled) console.log('[ingest] MEDIAMTX_HOOK_SECRET not set: Echo Radar RTMP server is off (tools/RTMP_SETUP.md)');

    function userBy(field, value) {
        for (const [uid, c] of Object.entries(streamConfigs)) {
            if (c && c.ingest && c.ingest[field] === value) return uid;
        }
        return null;
    }
    function ensureIngest(uid, { newKey = false } = {}) {
        const c = streamConfigs[uid] || (streamConfigs[uid] = {});
        const cur = c.ingest || {};
        if (newKey || !KEY_RE.test(cur.key || '') || !PID_RE.test(cur.publicId || '')) {
            c.ingest = {
                key: 'erx_' + crypto.randomBytes(16).toString('hex'),
                publicId: PID_RE.test(cur.publicId || '') ? cur.publicId : crypto.randomBytes(5).toString('hex'),
                createdAt: Date.now(),
            };
            saveStreamConfigs();
        }
        return c.ingest;
    }
    const watchPath = (pid) => `/live/${pid}/index.m3u8`;

    // Which keys MediaMTX is receiving right now, from its API.
    const liveKeys = new Set();
    let mediamtxUp = false;
    async function poll() {
        try {
            const r = await fetch(`${API_BASE}/v3/paths/list?itemsPerPage=1000`, { headers: internalAuth(), signal: AbortSignal.timeout(5000) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            liveKeys.clear();
            for (const p of j.items || []) {
                const m = /^live\/(erx_[a-f0-9]{32})$/.exec(p.name || '');
                if (m && p.ready) liveKeys.add(m[1]);
            }
            mediamtxUp = true;
        } catch (e) {
            mediamtxUp = false;
            liveKeys.clear();
        }
    }
    if (enabled) { poll(); setInterval(poll, POLL_MS).unref(); }

    /*
     * MediaMTX's authHTTPAddress. Called for every publish and read. Not under
     * /api (which sits behind the login gate); guarded by the shared secret in
     * the query instead, because every request through the Cloudflare tunnel
     * also arrives from 127.0.0.1.
     */
    app.post('/internal/mediamtx/auth', (req, res) => {
        if (!enabled || !sameSecret(req.query.secret, HOOK_SECRET)) return res.status(403).end();
        const b = req.body || {};
        if (b.action === 'publish') {
            const m = /^live\/(erx_[a-f0-9]{32})$/.exec(b.path || '');
            const uid = m && userBy('key', m[1]);
            const u = uid && findById(uid);
            if (u && !u.isLocked && canStream(u)) {
                console.log(`[ingest] ${u.email} started streaming`);
                return res.status(200).end();
            }
            console.log(`[ingest] refused a stream key from ${b.ip || '?'}`);
            return res.status(401).end();
        }
        // Reading (HLS, API) is ours alone; viewers come through /live below.
        if (sameSecret(b.password, HOOK_SECRET)) return res.status(200).end();
        return res.status(401).end();
    });

    // The caller's server, key and watch link.
    app.get('/api/stream/ingest', requireStreamer, (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!enabled) return res.json({ enabled: false });
        const ing = ensureIngest(req.user.id);
        res.json({
            enabled: true,
            server: RTMP_URL,
            key: ing.key,
            watchPath: watchPath(ing.publicId),
            live: liveKeys.has(ing.key),
            serverUp: mediamtxUp,
        });
    });
    // A new key, for when the old one was shared or leaked. The old one stops
    // working for the next connection.
    app.post('/api/stream/ingest/reset', requireStreamer, (req, res) => {
        if (!enabled) return res.status(503).json({ error: 'The Echo Radar stream server is not set up.' });
        const ing = ensureIngest(req.user.id, { newKey: true });
        res.json({ enabled: true, server: RTMP_URL, key: ing.key, watchPath: watchPath(ing.publicId), live: false, serverUp: mediamtxUp });
    });

    // Watching: signed-in viewers, by public id. Playlists and segments are
    // relative, so everything under /live/<pid>/ maps onto MediaMTX's path.
    app.use('/live', requireAuth, async (req, res) => {
        if (!enabled) return res.status(404).end();
        const m = /^\/([a-f0-9]{10})\/([A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*)$/.exec(req.path);
        if (!m || m[2].includes('..')) return res.status(404).end();
        const uid = userBy('publicId', m[1]);
        const key = uid && streamConfigs[uid].ingest.key;
        if (!key) return res.status(404).end();
        const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        const ctrl = new AbortController();
        res.on('close', () => ctrl.abort());
        try {
            const r = await fetch(`${HLS_BASE}/live/${key}/${m[2]}${qs}`, { headers: internalAuth(), signal: ctrl.signal });
            res.status(r.status === 401 ? 502 : r.status);
            const type = r.headers.get('content-type');
            if (type) res.setHeader('Content-Type', type);
            res.setHeader('Cache-Control', /\.m3u8$/i.test(m[2]) ? 'no-cache' : 'private, max-age=60');
            if (!r.body) return res.end();
            Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
        } catch (e) {
            if (!res.headersSent) res.status(ctrl.signal.aborted ? 499 : 502).end();
        }
    });

    return { liveKeys };
}

module.exports = { attachStreamIngest };
