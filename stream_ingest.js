/*
 * stream_ingest.js — Echo Radar's own RTMP server for the Chase Stream Hub.
 *
 * Every approved streamer gets an RTMP URL and a private stream key to paste
 * into OBS (or that the Hub pushes into OBS for them at Go Live). OBS sends
 * the video to nginx with its RTMP module on the 24/7 broadcast box (public
 * IP, plenty of bandwidth; setup in tools/RTMP_SETUP.md), which asks THIS
 * server whether each key may publish and turns the stream into HLS for the
 * in-app player. No video passes through this server:
 *
 *   OBS ──RTMP──▶ nginx (broadcast box) ──"may this key publish?"──▶ POST /internal/rtmp/publish
 *   viewer ─▶ GET /live/<id>/index.m3u8 here (signed in) ─302─▶ <box>/w/<expiry>/<sig>/<id>/index.m3u8
 *
 * The watch link is signed here and checked by nginx itself (secure_link), so
 * only signed-in Echo Radar users can watch, without nginx knowing anything
 * about accounts or calling back per viewer.
 *
 * Streams live at live/<publicId>. The OBS stream key is
 * "<publicId>?pass=<secret>"; nginx passes the name and the pass on to the
 * key check, and the secret part never appears in a watch link.
 *
 * Env:
 *   INGEST_SECRET      shared secret, the same value given to tools/broadcast/install_ingest.sh (required)
 *   RTMP_PUBLIC_URL    what streamers paste into OBS (default rtmp://193.122.152.119/live, the broadcast box)
 *   INGEST_PUBLIC_URL  the box's HTTPS address via its Cloudflare Tunnel (default https://stream.echoradarwx.com)
 */
const crypto = require('crypto');
const express = require('express');

const RTMP_URL = process.env.RTMP_PUBLIC_URL || 'rtmp://193.122.152.119/live';
const BOX_URL = (process.env.INGEST_PUBLIC_URL || 'https://stream.echoradarwx.com').replace(/\/$/, '');
const SECRET = process.env.INGEST_SECRET || '';
const KEY_RE = /^erx_[a-f0-9]{32}$/;
const PID_RE = /^[a-f0-9]{10}$/;
const POLL_MS = 10 * 1000;
const TOKEN_TTL_S = 6 * 60 * 60;   // a watch link lasts a long chase

const sameSecret = (a, b) => {
    const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
// nginx's secure_link_md5 "$er_exp $er_id <secret>": base64url MD5, expiry in seconds.
function watchUrl(pid) {
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_S;
    const sig = crypto.createHash('md5').update(`${exp} ${pid} ${SECRET}`).digest('base64url');
    return `${BOX_URL}/w/${exp}/${sig}/${pid}/index.m3u8`;
}

function attachStreamIngest(app, { streamConfigs, saveStreamConfigs, findById, canStream, requireAuth, requireStreamer }) {
    const enabled = !!SECRET;
    if (!enabled) console.log('[ingest] INGEST_SECRET not set: Echo Radar RTMP server is off (tools/RTMP_SETUP.md)');

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
        serverUp,
    });

    // Which streams nginx is receiving right now, from its rtmp_stat page.
    const livePids = new Set();
    let serverUp = false;
    async function poll() {
        try {
            const r = await fetch(`${BOX_URL}/stat`, { headers: { 'X-Ingest-Secret': SECRET }, signal: AbortSignal.timeout(5000) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const xml = await r.text();
            if (!xml.includes('<rtmp>')) throw new Error('not the stat page');
            livePids.clear();
            for (const block of xml.split('<stream>').slice(1)) {
                const m = /<name>([a-f0-9]{10})<\/name>/.exec(block);
                if (m && block.includes('<publishing/>')) livePids.add(m[1]);
            }
            serverUp = true;
        } catch (e) {
            serverUp = false;
            livePids.clear();
        }
    }
    if (enabled) { poll(); setInterval(poll, POLL_MS).unref(); }

    /*
     * nginx's on_publish, once per stream start (relayed by nginx's local
     * 127.0.0.1:8098 so it can reach us over HTTPS). Not under /api (which
     * sits behind the login gate); guarded by the shared secret in a header
     * instead. nginx sends a form: app, name (the public id), pass (from the
     * stream key's ?pass=), addr. 2xx lets the stream in, anything else drops it.
     */
    app.post('/internal/rtmp/publish', express.urlencoded({ extended: false, limit: '8kb' }), (req, res) => {
        if (!enabled || !sameSecret(req.get('x-ingest-secret'), SECRET)) return res.status(403).end();
        const b = req.body || {};
        const pid = b.app === 'live' && PID_RE.test(b.name || '') ? b.name : '';
        const uid = pid && userBy('publicId', pid);
        const u = uid && findById(uid);
        if (u && !u.isLocked && canStream(u) && sameSecret(b.pass, streamConfigs[uid].ingest.key)) {
            console.log(`[ingest] ${u.email} started streaming`);
            return res.status(200).end();
        }
        console.log(`[ingest] refused a stream key for ${String(b.name || '?').slice(0, 40)} from ${String(b.addr || '?').slice(0, 45)}`);
        // Tells install_ingest.sh's self-test this was us, not the login gate's 401.
        res.setHeader('X-Echo-Ingest', 'refused');
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

    // Beacons of streamers live on this server right now, for the Spotters
    // layer (components/beacon_streams.js): their Spotter Network beacon plays
    // this stream and the player follows it. A streamer links their beacon by
    // putting their Spotter Network name or callsign in the Hub. Only live
    // ones are listed, so nobody's name is handed out while they are off air.
    app.get('/api/stream/beacons', requireAuth, (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const beacons = [];
        if (enabled) {
            for (const [uid, c] of Object.entries(streamConfigs)) {
                const pid = c && c.ingest && c.ingest.publicId;
                const spotter = c && typeof c.spotter === 'string' ? c.spotter.trim() : '';
                if (!pid || !spotter || !livePids.has(pid)) continue;
                const u = findById(uid);
                if (!u || u.isLocked || !canStream(u)) continue;
                beacons.push({ spotter, name: spotter, watchPath: watchPath(pid) });
            }
        }
        res.json({ beacons });
    });

    // Watching, for signed-in users, by public id: off to the broadcast box
    // with a signed link. Its playlists are relative, so the rest follows.
    app.get('/live/:pid/index.m3u8', requireAuth, (req, res) => {
        const pid = req.params.pid;
        if (!enabled || !PID_RE.test(pid) || !userBy('publicId', pid)) return res.status(404).end();
        res.setHeader('Cache-Control', 'no-store');
        res.redirect(302, watchUrl(pid));
    });

    return { livePids };
}

module.exports = { attachStreamIngest };
