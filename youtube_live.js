/*
 * youtube_live.js
 * YouTube Live integration for the Chase Stream Hub. Same shape as billing.js:
 * a dependency-light CommonJS factory that server.js wires to the per-user
 * stream-config store.
 *
 * What it does when a chaser goes live (the "full" flow):
 *   1. OAuth (one-time): the user connects their YouTube channel; we keep a
 *      refresh token in their stream config.
 *   2. Go live: with a fresh access token we create a liveBroadcast + a
 *      liveStream (RTMP), bind them, and return the ingest address + stream key
 *      + watch URL. The Hub pushes the ingest/key into OBS over obs-websocket
 *      and starts streaming; YouTube auto-starts the broadcast when it sees the
 *      feed (enableAutoStart) and auto-stops when it ends (enableAutoStop).
 *
 * Config via env (see docs/youtube_live_setup.md):
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET   (from Google Cloud OAuth client)
 *   YOUTUBE_REDIRECT_URI                        (optional; else derived per-request)
 *
 * `store` (injected by server.js) provides per-user config access:
 *   getConfig(userId)          -> the user's stream config object (or {})
 *   setConfig(userId, config)  -> persist it
 */

const crypto = require('crypto');

const OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
// youtube.force-ssl is required to create/manage live broadcasts.
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

function createYouTube({ store }) {
    const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
    const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
    const REDIRECT_OVERRIDE = process.env.YOUTUBE_REDIRECT_URI;

    const isConfigured = !!(CLIENT_ID && CLIENT_SECRET);
    if (!isConfigured) {
        console.log('[youtube] Not configured (set YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET). Connect endpoints return 503.');
    }

    // Short-lived CSRF state store: state -> { userId, created }.
    const pendingStates = new Map();
    const STATE_TTL_MS = 10 * 60 * 1000;
    function newState(userId) {
        const state = crypto.randomBytes(16).toString('hex');
        pendingStates.set(state, { userId, created: Date.now() });
        return state;
    }
    function consumeState(state) {
        const s = pendingStates.get(state);
        if (!s) return null;
        pendingStates.delete(state);
        if (Date.now() - s.created > STATE_TTL_MS) return null;
        return s;
    }

    // The redirect URI must EXACTLY match one registered in the Google console.
    // Prefer the explicit env override; otherwise derive from the request so it
    // works across localhost / prod without reconfig.
    function redirectUri(req) {
        if (REDIRECT_OVERRIDE) return REDIRECT_OVERRIDE;
        const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        return `${proto}://${host}/api/stream/connect/youtube/callback`;
    }

    async function tokenRequest(params) {
        const res = await fetch(OAUTH_TOKEN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params).toString(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error_description || data.error || ('token HTTP ' + res.status));
        return data;
    }

    // Get a usable access token for a user from their stored refresh token.
    async function accessTokenFor(userId) {
        const cfg = store.getConfig(userId) || {};
        const refreshToken = cfg.youtube && cfg.youtube.refreshToken;
        if (!refreshToken) throw new Error('YouTube is not connected for this account.');
        const data = await tokenRequest({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        });
        return data.access_token;
    }

    async function api(method, path, accessToken, body) {
        const res = await fetch(API + path, {
            method,
            headers: {
                Authorization: 'Bearer ' + accessToken,
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = (data.error && (data.error.message || (data.error.errors && data.error.errors[0] && data.error.errors[0].reason))) || ('YouTube API HTTP ' + res.status);
            const err = new Error(msg);
            err.status = res.status;
            throw err;
        }
        return data;
    }

    // ── Create everything needed to go live; returns ingest + watch details. ──
    async function goLive(userId, { title, privacy }) {
        const accessToken = await accessTokenFor(userId);
        const startTime = new Date(Date.now() + 5000).toISOString();

        // 1) Broadcast (the watch page). Auto start/stop off the incoming feed.
        const broadcast = await api('POST', '/liveBroadcasts?part=snippet,status,contentDetails', accessToken, {
            snippet: { title: (title || 'Live').slice(0, 100), scheduledStartTime: startTime },
            status: { privacyStatus: (privacy === 'unlisted' || privacy === 'private') ? privacy : 'public', selfDeclaredMadeForKids: false },
            contentDetails: { enableAutoStart: true, enableAutoStop: true },
        });

        // 2) Stream (the RTMP ingest endpoint OBS pushes to).
        const stream = await api('POST', '/liveStreams?part=snippet,cdn,contentDetails', accessToken, {
            snippet: { title: (title || 'Live').slice(0, 100) },
            cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
        });

        // 3) Bind the stream to the broadcast.
        await api('POST', `/liveBroadcasts/bind?id=${broadcast.id}&part=id,contentDetails&streamId=${stream.id}`, accessToken);

        const ingestion = (stream.cdn && stream.cdn.ingestionInfo) || {};
        return {
            broadcastId: broadcast.id,
            streamId: stream.id,
            ingestionAddress: ingestion.ingestionAddress,   // rtmp://a.rtmp.youtube.com/live2
            streamName: ingestion.streamName,               // the stream key
            watchUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
        };
    }

    async function endLive(userId, broadcastId) {
        if (!broadcastId) return;
        const accessToken = await accessTokenFor(userId);
        // enableAutoStop usually handles this; transition explicitly too so the
        // watch page closes promptly. Ignore errors (may already be complete).
        try {
            await api('POST', `/liveBroadcasts/transition?broadcastStatus=complete&id=${broadcastId}&part=status`, accessToken);
        } catch (e) { /* already ended / not yet live */ }
    }

    // ── Express routes ──
    function attach(app, requireAuth) {
        // Kick off OAuth. Full-page redirect to Google's consent screen.
        app.get('/api/stream/connect/youtube', requireAuth, (req, res) => {
            if (!isConfigured) return res.status(503).send('YouTube is not configured on this server.');
            const params = new URLSearchParams({
                client_id: CLIENT_ID,
                redirect_uri: redirectUri(req),
                response_type: 'code',
                scope: SCOPE,
                access_type: 'offline',   // get a refresh token
                prompt: 'consent',        // force refresh_token even on re-connect
                include_granted_scopes: 'true',
                state: newState(req.user.id),
            });
            res.redirect(`${OAUTH_AUTH}?${params.toString()}`);
        });

        // OAuth callback. Browser lands here with ?code&state.
        app.get('/api/stream/connect/youtube/callback', requireAuth, async (req, res) => {
            const done = (ok, msg) => res.status(ok ? 200 : 400).type('html').send(
                `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
                 <body style="font-family:system-ui;background:#0b1220;color:#e5edff;display:flex;
                 min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px">
                 <div><div style="font-size:42px">${ok ? '✅' : '⚠️'}</div>
                 <h2>${ok ? 'YouTube connected' : 'Could not connect YouTube'}</h2>
                 <p style="color:#9db0d0;max-width:340px">${msg}</p>
                 <p><a href="/" style="color:#27beff">Return to Vortex Radar</a></p>
                 <script>setTimeout(function(){try{window.close()}catch(e){}},1500)</script></div></body>`);

            if (!isConfigured) return done(false, 'YouTube is not configured on this server.');
            if (req.query.error) return done(false, 'You declined the connection or Google returned: ' + req.query.error);
            const st = consumeState(String(req.query.state || ''));
            if (!st || st.userId !== req.user.id) return done(false, 'Security check failed (state mismatch). Please try connecting again.');
            try {
                const tokens = await tokenRequest({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    code: String(req.query.code || ''),
                    grant_type: 'authorization_code',
                    redirect_uri: redirectUri(req),
                });
                if (!tokens.refresh_token) {
                    console.warn('[youtube] OAuth callback: no refresh_token returned (user already granted; needs re-consent).');
                    return done(false, 'Google did not return a refresh token. Remove Vortex Radar from your Google account permissions and reconnect.');
                }
                const cfg = store.getConfig(req.user.id) || {};
                cfg.youtube = { refreshToken: tokens.refresh_token, connectedAt: new Date().toISOString() };
                cfg.autoPost = Object.assign({}, cfg.autoPost, { youtube: true });
                store.setConfig(req.user.id, cfg);
                done(true, 'Your channel is linked. Go back to the app and hit Go Live.');
            } catch (e) {
                console.warn('[youtube] OAuth token exchange failed:', e.message);
                done(false, e.message || 'Token exchange failed.');
            }
        });

        app.post('/api/stream/youtube/disconnect', requireAuth, (req, res) => {
            const cfg = store.getConfig(req.user.id) || {};
            if (cfg.youtube) delete cfg.youtube;
            if (cfg.autoPost) cfg.autoPost.youtube = false;
            store.setConfig(req.user.id, cfg);
            res.json({ ok: true });
        });

        // Create the broadcast + stream and hand back ingest details for OBS.
        app.post('/api/stream/youtube/golive', requireAuth, async (req, res) => {
            if (!isConfigured) return res.status(503).json({ error: 'YouTube is not configured on this server.' });
            try {
                const out = await goLive(req.user.id, { title: req.body && req.body.title, privacy: req.body && req.body.privacy });
                res.json(out);
            } catch (e) {
                console.warn('[youtube] goLive failed:', e.message);
                res.status(e.status === 401 ? 401 : 502).json({ error: e.message || 'Could not start the YouTube broadcast.' });
            }
        });

        app.post('/api/stream/youtube/end', requireAuth, async (req, res) => {
            try { await endLive(req.user.id, req.body && req.body.broadcastId); res.json({ ok: true }); }
            catch (e) { res.json({ ok: false, error: e.message }); } // best-effort
        });
    }

    return { attach, isConfigured };
}

module.exports = { createYouTube };
