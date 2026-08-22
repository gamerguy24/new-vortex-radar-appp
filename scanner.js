/*
 * scanner.js — Global PTT live audio streaming
 * ────────────────────────────────────────────────────────────────────────────
 * Relays a live audio feed from our own Global PTT / radio gateway to listeners
 * on the website and mobile app. It is NOT a public-scanner client.
 *
 * Data flow:
 *   Global PTT radio → audio out → Windows PC (FFmpeg / tools/ptt_source.js)
 *     → HTTP chunked POST  /scanner/ingest   (authenticated with SCANNER_INGEST_KEY)
 *       → this server fans the audio out to every listener
 *         → GET /scanner/stream   (audio/mpeg)  → <audio> in the app
 *
 * Listeners never connect to the Windows PC — only to this server.
 *
 * Architected around a CHANNEL REGISTRY so more channels can be added later
 * (channel selection, private/public, per-channel permissions, recording, …)
 * without rebuilding the backend. Ships with a single default channel.
 *
 * Everything is in-memory + guarded; it never throws into the event loop.
 */

const path = require('path');

// A listener that hasn't received audio in this long counts the feed "offline".
const STALE_MS = 15 * 1000;
// Rolling "prime" buffer sent to a newly-connecting listener so playback starts
// quickly (MP3/ADTS decoders resync on the next frame header).
const PRIME_MAX_BYTES = 48 * 1024;
// Drop a slow listener whose socket backs up beyond this (protects memory).
const LISTENER_HIGHWATER = 4 * 1024 * 1024;

function attachScanner({ app, requireAuth, requireAdmin, DATA_DIR, readJson, writeJson }) {
    const CHANNELS_FILE = path.join(DATA_DIR, 'scanner_channels.json');
    const INGEST_KEY = (process.env.SCANNER_INGEST_KEY || '').trim();

    // ── channel registry (persisted definitions + in-memory live state) ──────────
    // Definition (persisted): { id, name, description, public, enabled }
    // Live state (memory): listeners, source, byte/stat counters.
    const DEFAULT_CHANNELS = [
        { id: 'global-ptt', name: 'Global PTT', description: 'Live Global PTT communications', public: false, enabled: true },
    ];
    let defs = readJson(CHANNELS_FILE, null);
    if (!Array.isArray(defs) || !defs.length) { defs = DEFAULT_CHANNELS; try { writeJson(CHANNELS_FILE, defs); } catch (e) {} }
    const saveDefs = () => { try { writeJson(CHANNELS_FILE, defs); } catch (e) {} };

    const state = new Map(); // id -> live state
    function ensureState(id) {
        if (!state.has(id)) {
            state.set(id, {
                listeners: new Set(),
                source: null,            // active ingest req while a source is connected
                contentType: 'audio/mpeg',
                sourceStartedAt: 0,
                lastAudioAt: 0,
                bytesIn: 0,
                prime: [],               // recent Buffers
                primeBytes: 0,
                peakListeners: 0,
                totalConnections: 0,
            });
        }
        return state.get(id);
    }
    defs.forEach((d) => ensureState(d.id));

    const getDef = (id) => defs.find((d) => d.id === id) || null;
    const defaultId = () => (defs[0] && defs[0].id) || 'global-ptt';
    // Resolve a channel from a route param, falling back to the default channel.
    function resolve(param) {
        const id = (param && String(param)) || defaultId();
        const def = getDef(id);
        if (!def) return null;
        return { def, st: ensureState(id) };
    }

    function isOnline(st) { return !!(st.source && (Date.now() - st.lastAudioAt) < STALE_MS); }
    function bitrateKbps(st) {
        const secs = st.sourceStartedAt ? (Date.now() - st.sourceStartedAt) / 1000 : 0;
        if (secs < 1) return 0;
        return Math.round((st.bytesIn * 8) / 1000 / secs);
    }
    function statusOf(def, st) {
        return {
            channel: def.id,
            name: def.name,
            description: def.description || '',
            public: !!def.public,
            enabled: def.enabled !== false,
            online: isOnline(st),
            connection: st.source ? (isOnline(st) ? 'live' : 'stalled') : 'offline',
            listeners: st.listeners.size,
            peakListeners: st.peakListeners,
            lastAudioAt: st.lastAudioAt || null,
            lastAudioAgeMs: st.lastAudioAt ? (Date.now() - st.lastAudioAt) : null,
            bitrateKbps: bitrateKbps(st),
            contentType: st.contentType,
            uptimeMs: st.sourceStartedAt ? (Date.now() - st.sourceStartedAt) : 0,
            serverTime: Date.now(),
        };
    }

    // ── fan-out ──────────────────────────────────────────────────────────────────
    function pushPrime(st, chunk) {
        st.prime.push(chunk);
        st.primeBytes += chunk.length;
        while (st.primeBytes > PRIME_MAX_BYTES && st.prime.length > 1) {
            st.primeBytes -= st.prime.shift().length;
        }
    }
    function fanout(st, chunk) {
        st.lastAudioAt = Date.now();
        st.bytesIn += chunk.length;
        pushPrime(st, chunk);
        for (const res of st.listeners) {
            try {
                if (res.writableLength > LISTENER_HIGHWATER) { st.listeners.delete(res); try { res.end(); } catch (e) {} continue; }
                res.write(chunk);
            } catch (e) { st.listeners.delete(res); }
        }
    }

    // ── ingest (the Windows gateway posts a continuous chunked stream here) ───────
    function handleIngest(req, res) {
        const r = resolve(req.params.channel);
        if (!r) return res.status(404).json({ error: 'Unknown channel.' });
        if (!INGEST_KEY) return res.status(503).json({ error: 'Ingest disabled: set SCANNER_INGEST_KEY on the server.' });
        const key = (req.get('x-ingest-key') || req.query.key || '').toString();
        if (key !== INGEST_KEY) return res.status(401).json({ error: 'Bad ingest key.' });

        const { def, st } = r;
        // One source per channel — replace any previous (lets the gateway reconnect).
        if (st.source && st.source !== req) { try { st.source.destroy(); } catch (e) {} }
        const ct = (req.get('content-type') || '').toLowerCase();
        if (ct.includes('audio/') || ct.includes('application/octet-stream')) st.contentType = ct.includes('octet') ? 'audio/mpeg' : ct;
        st.source = req;
        st.sourceStartedAt = Date.now();
        st.lastAudioAt = Date.now();
        st.bytesIn = 0;
        st.prime = []; st.primeBytes = 0;
        try { req.setTimeout(0); } catch (e) {}          // no inactivity timeout on the long POST
        console.log(`[SCANNER] source connected → ${def.id} (${st.contentType})`);

        req.on('data', (chunk) => fanout(st, chunk));
        const done = () => {
            if (st.source === req) { st.source = null; console.log(`[SCANNER] source disconnected ← ${def.id}`); }
        };
        req.on('end', () => { done(); res.json({ ok: true, bytes: st.bytesIn }); });
        req.on('close', done);
        req.on('error', done);
    }
    app.post('/scanner/ingest', handleIngest);
    app.post('/scanner/ingest/:channel', handleIngest);

    // ── listener stream (audio/mpeg) ─────────────────────────────────────────────
    // Auth: public channels are open; private channels require a signed-in user.
    function streamGate(req, res, next) {
        const r = resolve(req.params.channel);
        if (!r || r.def.enabled === false) return res.status(404).json({ error: 'Channel not found.' });
        if (r.def.public) return next();
        return requireAuth(req, res, next);
    }
    function handleStream(req, res) {
        const { def, st } = resolve(req.params.channel);
        res.writeHead(200, {
            'Content-Type': st.contentType || 'audio/mpeg',
            'Cache-Control': 'no-cache, no-store',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',       // don't let a reverse proxy buffer audio
            'Access-Control-Allow-Origin': '*',
        });
        try { res.setTimeout(0); } catch (e) {}
        // Prime so audio starts promptly.
        for (const b of st.prime) { try { res.write(b); } catch (e) {} }
        st.listeners.add(res);
        st.totalConnections++;
        if (st.listeners.size > st.peakListeners) st.peakListeners = st.listeners.size;
        const cleanup = () => { st.listeners.delete(res); };
        req.on('close', cleanup);
        res.on('error', cleanup);
    }
    app.get('/scanner/stream', streamGate, handleStream);
    app.get('/scanner/stream/:channel', streamGate, handleStream);

    // ── status + channel list ────────────────────────────────────────────────────
    function handleStatus(req, res) {
        const r = resolve(req.params.channel);
        if (!r) return res.status(404).json({ error: 'Channel not found.' });
        res.json(statusOf(r.def, r.st));
    }
    // Base /scanner returns the default channel status (handy to eyeball in a browser).
    app.get('/scanner', handleStatus);
    app.get('/scanner/status', handleStatus);
    app.get('/scanner/status/:channel', handleStatus);

    // Public channel directory (only channels the caller may see): drops private
    // channels for signed-out users.
    app.get('/scanner/channels', (req, res) => {
        const signedIn = !!req.user;
        const list = defs
            .filter((d) => d.enabled !== false && (d.public || signedIn))
            .map((d) => statusOf(d, ensureState(d.id)));
        res.json({ channels: list, default: defaultId() });
    });

    // ── admin: channel management (future channels, no rebuild needed) ───────────
    app.get('/admin/scanner/channels', requireAdmin, (req, res) => {
        res.json({ channels: defs.map((d) => ({ ...d, status: statusOf(d, ensureState(d.id)) })) });
    });
    app.post('/admin/scanner/channels', requireAdmin, (req, res) => {
        const b = req.body || {};
        const id = String(b.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
        if (!id) return res.status(400).json({ error: 'A channel id (letters, numbers, dashes) is required.' });
        let def = getDef(id);
        if (!def) { def = { id, name: id, description: '', public: false, enabled: true }; defs.push(def); ensureState(id); }
        if (b.name != null) def.name = String(b.name).slice(0, 80);
        if (b.description != null) def.description = String(b.description).slice(0, 300);
        if (b.public != null) def.public = !!b.public;
        if (b.enabled != null) def.enabled = !!b.enabled;
        saveDefs();
        res.json({ channel: def });
    });
    app.delete('/admin/scanner/channels/:id', requireAdmin, (req, res) => {
        const id = req.params.id;
        if (id === defaultId() && defs.length === 1) return res.status(400).json({ error: 'Cannot delete the only channel.' });
        const st = state.get(id);
        if (st) { for (const l of st.listeners) { try { l.end(); } catch (e) {} } if (st.source) { try { st.source.destroy(); } catch (e) {} } state.delete(id); }
        defs = defs.filter((d) => d.id !== id);
        saveDefs();
        res.json({ ok: true });
    });

    console.log(`[SCANNER] Global PTT streaming ready (${defs.length} channel(s), ingest ${INGEST_KEY ? 'ENABLED' : 'DISABLED — set SCANNER_INGEST_KEY'}).`);
}

module.exports = { attachScanner };
