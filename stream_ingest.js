/*
 * stream_ingest.js — Echo Radar's own RTMP server for the Chase Stream Hub.
 *
 * Every approved streamer gets an RTMP URL and a private stream key to paste
 * into OBS (or that the Hub pushes into OBS for them at Go Live). OBS sends
 * the video to MediaMTX (a single-binary media server, setup in
 * tools/RTMP_SETUP.md), which asks THIS server whether each key may publish
 * and each viewer may watch, and turns the stream into HLS for the in-app
 * player.
 *
 * MediaMTX normally runs on the 24/7 broadcast box (public IP, plenty of
 * bandwidth), so video never touches this server:
 *
 *   OBS ──RTMP──▶ MediaMTX (broadcast box) ──"may this key publish?"──▶ POST /internal/mediamtx/auth
 *   viewer ─▶ GET /live/<id>/index.m3u8 here (signed in) ─302─▶ MediaMTX …/live/<id>/index.m3u8?token=…
 *
 * The token is an HMAC this server signs and checks again when MediaMTX asks,
 * so only signed-in Echo Radar users can watch, without MediaMTX knowing
 * anything about accounts. Leave MEDIAMTX_HLS_PUBLIC_URL unset to run MediaMTX
 * on this box instead; then /live/… is proxied here rather than redirected.
 *
 * Streams live at path live/<publicId>. The OBS stream key is
 * "<publicId>?pass=<secret>", which MediaMTX reads as path + password; the
 * secret part never appears in a watch link.
 *
 * Env:
 *   MEDIAMTX_HOOK_SECRET     shared secret, also in mediamtx.yml's authHTTPAddress (required)
 *   RTMP_PUBLIC_URL          what streamers paste into OBS (default rtmp://ingest.echoradarwx.com/live)
 *   MEDIAMTX_HLS_PUBLIC_URL  MediaMTX's public HTTPS address, e.g. https://ingest.echoradarwx.com
 *                            (set when MediaMTX runs on another box; viewers are sent there)
 *   MEDIAMTX_API_URL         MediaMTX control API (default http://127.0.0.1:9997; remote:
 *                            the same public address, which forwards /v3/ to it)
 *   MEDIAMTX_HLS_URL         MediaMTX HLS when it runs on THIS box (default http://127.0.0.1:8888)
 */
const crypto = require('crypto');
const { Readable } = require('stream');

const RTMP_URL = process.env.RTMP_PUBLIC_URL || 'rtmp://ingest.echoradarwx.com/live';
const HLS_PUBLIC = (process.env.MEDIAMTX_HLS_PUBLIC_URL || '').replace(/\/$/, '');
const HLS_LOCAL = (process.env.MEDIAMTX_HLS_URL || 'http://127.0.0.1:8888').replace(/\/$/, '');
const API_BASE = (process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997').replace(/\/$/, '');
const HOOK_SECRET = process.env.MEDIAMTX_HOOK_SECRET || '';
const KEY_RE = /^erx_[a-f0-9]{32}$/;
const PID_RE = /^[a-f0-9]{10}$/;
const PATH_RE = /^live\/([a-f0-9]{10})$/;
const POLL_MS = 10 * 1000;
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;   // a watch link lasts a long chase

// MediaMTX checks our own reads (HLS proxy, status poll) with these credentials.
const internalAuth = () => ({ Authorization: 'Basic ' + Buffer.from('echoradar:' + HOOK_SECRET).toString('base64') });
const sameSecret = (a, b) => {
    const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const sign = (pid, exp) => crypto.createHmac('sha256', HOOK_SECRET).update(`watch:${pid}:${exp}`).digest('base64url').slice(0, 32);
const watchToken = (pid) => { const exp = Date.now() + TOKEN_TTL_MS; return `${exp}.${sign(pid, exp)}`; };
function tokenOk(pid, token) {
    const [exp, sig] = String(token || '').split('.');
    return Number(exp) > Date.now() && sameSecret(sig, sign(pid, exp));
}
const queryParam = (query, name) => { try { return new URLSearchParams(query || '').get(name) || ''; } catch (e) { return ''; } };

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
    const describe = (ing) => ({
        enabled: true,
        server: RTMP_URL,
        key: `${ing.publicId}?pass=${ing.key}`,   // exactly what goes in OBS's Stream Key box
        watchPath: watchPath(ing.publicId),
        live: livePids.has(ing.publicId),
        serverUp: mediamtxUp,
    });

    // Which streams MediaMTX is receiving right now, from its API.
    const livePids = new Set();
    let mediamtxUp = false;
    async function poll() {
        try {
            const r = await fetch(`${API_BASE}/v3/paths/list?itemsPerPage=1000`, { headers: internalAuth(), signal: AbortSignal.timeout(5000) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            livePids.clear();
            for (const p of j.items || []) {
                const m = PATH_RE.exec(p.name || '');
                if (m && p.ready) livePids.add(m[1]);
            }
            mediamtxUp = true;
        } catch (e) {
            mediamtxUp = false;
            livePids.clear();
        }
    }
    if (enabled) { poll(); setInterval(poll, POLL_MS).unref(); }

    /*
     * MediaMTX's authHTTPAddress, called for every publish and read. Not under
     * /api (which sits behind the login gate); guarded by the shared secret in
     * the query instead, because MediaMTX is not a signed-in user and, on the
     * broadcast box, not even on this machine.
     */
    app.post('/internal/mediamtx/auth', (req, res) => {
        if (!enabled || !sameSecret(req.query.secret, HOOK_SECRET)) return res.status(403).end();
        const b = req.body || {};
        // Our own requests (HLS proxy, status poll) carry the secret.
        if (sameSecret(b.password, HOOK_SECRET)) return res.status(200).end();
        const m = PATH_RE.exec(b.path || '');
        const uid = m && userBy('publicId', m[1]);
        if (b.action === 'publish') {
            const u = uid && findById(uid);
            const pass = b.password || queryParam(b.query, 'pass');
            if (u && !u.isLocked && canStream(u) && sameSecret(pass, streamConfigs[uid].ingest.key)) {
                console.log(`[ingest] ${u.email} started streaming`);
                return res.status(200).end();
            }
            console.log(`[ingest] refused a stream key for ${b.path || '?'} from ${b.ip || '?'}`);
            return res.status(401).end();
        }
        if (b.action === 'read' && uid && tokenOk(m[1], queryParam(b.query, 'token'))) return res.status(200).end();
        return res.status(401).end();
    });

    // The caller's server, key and watch link.
    app.get('/api/stream/ingest', requireStreamer, (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!enabled) return res.json({ enabled: false });
        res.json(describe(ensureIngest(req.user.id)));
    });
    // A new key, for when the old one was shared or leaked. The old one stops
    // working for the next connection; the watch link stays the same.
    app.post('/api/stream/ingest/reset', requireStreamer, (req, res) => {
        if (!enabled) return res.status(503).json({ error: 'The Echo Radar stream server is not set up.' });
        res.json(describe(ensureIngest(req.user.id, { newKey: true })));
    });

    // Watching, for signed-in users, by public id.
    app.use('/live', requireAuth, async (req, res) => {
        if (!enabled) return res.status(404).end();
        const m = /^\/([a-f0-9]{10})\/([A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*)$/.exec(req.path);
        if (!m || m[2].includes('..') || !userBy('publicId', m[1])) return res.status(404).end();
        const pid = m[1];

        // MediaMTX on the broadcast box: send the player there with a signed
        // token. Its playlists are relative, so the rest follows from there.
        if (HLS_PUBLIC) {
            if (m[2] !== 'index.m3u8') return res.status(404).end();
            res.setHeader('Cache-Control', 'no-store');
            return res.redirect(302, `${HLS_PUBLIC}/live/${pid}/index.m3u8?token=${encodeURIComponent(watchToken(pid))}`);
        }

        // MediaMTX on this box: relay it.
        const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        const ctrl = new AbortController();
        res.on('close', () => ctrl.abort());
        try {
            const r = await fetch(`${HLS_LOCAL}/live/${pid}/${m[2]}${qs}`, { headers: internalAuth(), signal: ctrl.signal });
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

    return { livePids };
}

module.exports = { attachStreamIngest };
