/*
 * embed_api.js — the public, embeddable radar at api.echoradarwx.com
 * ────────────────────────────────────────────────────────────────────────────
 * Lets any website show Echo Radar's live radar with no login:
 *
 *   https://api.echoradarwx.com/            how to embed it (snippet builder)
 *   https://api.echoradarwx.com/embed       the map itself (an iframe target)
 *   https://api.echoradarwx.com/embed.js    a loader: <div data-echoradar> → iframe
 *   https://api.echoradarwx.com/v1/health   for uptime checks
 *
 * THE API HOST IS FENCED OFF FROM THE APP. Requests whose Host is one of
 * EMBED_HOSTS (default api.echoradarwx.com) get only the files above and the
 * handful of public app files the map needs (listed in EMBED_ASSETS); anything
 * else is a 404 there. So the login screen, the radar app and every /api/*
 * route behind the session gate are never reachable on that address, even by
 * accident when new routes are added — this runs before all of them.
 *
 * On the app's own host, /embed, /embed.js and /embed/docs answer too (public,
 * above the gate), which is handy for checking a change before it is live.
 *
 * WHAT IT EXPOSES: nothing private. The map is drawn in the visitor's browser
 * from public data — NOAA MRMS radar (noaa-mrms-pds on AWS) and NWS warnings
 * (api.weather.gov) — exactly what /broadcast already shows the world. This
 * server only hands out static files, so busy embeds cost it very little; set
 * them cacheable so Cloudflare serves most of the traffic. The base map is
 * Mapbox (the app's public token): those map loads ARE counted by Mapbox
 * (owner's choice, 2026-10-18).
 *
 * Wiring (Cloudflare Tunnel): add a public hostname api.echoradarwx.com →
 * the same local service as echoradarwx.com. cloudflared passes the original
 * Host header through, which is what the fence keys on.
 */
const path = require('path');

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

function attachEmbedApi(app) {
    const isEmbedHost = (req) => EMBED_HOSTS.includes(hostOf(req));

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

    const embedPage = send('embed/index.html', { type: 'html', maxAge: 300, frame: true });
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

    // ── the API host: embed files only, everything else 404 ──
    app.use((req, res, next) => {
        if (!isEmbedHost(req)) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });
        const p = req.path;
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

    // ── the app's own host: the same embed, public, for previewing ──
    app.get(['/embed', '/embed/'], embedPage);
    app.get('/embed.js', loader);
    app.get('/embed/docs', docs);
    app.get('/embed/radar-sites.json', radarSites);
    app.use('/embed', embedStatic);

    console.log('[embed] public radar embed on', EMBED_HOSTS.join(', '), '(and /embed on the app host)');
}

module.exports = { attachEmbedApi, EMBED_HOSTS };
