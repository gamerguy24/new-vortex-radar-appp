/*
 * info_site.js — the public "what is Echo Radar" site at info.echoradarwx.com
 * ────────────────────────────────────────────────────────────────────────────
 * The page people land on before they have an account, and the one search
 * engines index: what Echo Radar does, what it has that others don't, plans,
 * and the way in (Create account / Log in on the app host).
 *
 *   https://info.echoradarwx.com/              the landing page (info/index.html)
 *   https://info.echoradarwx.com/img/…         screenshots
 *   https://info.echoradarwx.com/tour.mp4      the 60 s narrated tour
 *   https://info.echoradarwx.com/robots.txt, /sitemap.xml
 *
 * THE INFO HOST IS FENCED OFF FROM THE APP, like the embed host: requests whose
 * Host is one of INFO_HOSTS get only the files in info/ (plus the logo) and
 * anything else is a 404 there, so no app route or /api is reachable on it.
 * This runs before every other route.
 *
 * On the app's own host the same page answers at /info/ (public, above the
 * session gate) for checking a change before it is live, and as the fallback
 * landing page until the info hostname is wired up (see INFO_URL in server.js).
 *
 * Wiring (Cloudflare Tunnel): add a public hostname info.echoradarwx.com →
 * the same local service as echoradarwx.com. cloudflared passes the original
 * Host header through, which is what the fence keys on.
 */
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const INFO_DIR = path.join(ROOT, 'info');
const INFO_HOSTS = String(process.env.INFO_HOSTS || 'info.echoradarwx.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const hostOf = (req) => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');

// Only plain file names under info/ (and info/img/) — no traversal, no dotfiles.
const SAFE = /^\/(?:img\/)?[a-z0-9][a-z0-9._-]*\.(?:html|jpg|png|webp|mp4|txt|xml|ico)$/i;

function attachInfoSite(app) {
    const isInfoHost = (req) => INFO_HOSTS.includes(hostOf(req));

    // Serve a file from info/, or call miss() when there is none.
    function serve(rel, res, miss) {
        const file = path.join(INFO_DIR, rel);
        if (!file.startsWith(INFO_DIR + path.sep) || !fs.existsSync(file)) return miss();
        // The page itself revalidates so copy edits show at once; media can sit in Cloudflare.
        const maxAge = /\.(html|txt|xml)$/.test(rel) ? 300 : 86400;
        res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
        res.sendFile(file);
    }

    app.use((req, res, next) => {
        if (!isInfoHost(req)) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
        const notFound = () => res.status(404).type('text').send('Not found');
        if (req.path === '/' || req.path === '/index.html') return serve('index.html', res, notFound);
        if (req.path === '/logo.png' || req.path === '/favicon.ico') {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(path.join(ROOT, 'logo.png'));
        }
        if (SAFE.test(req.path)) return serve(req.path.slice(1), res, notFound);
        return notFound();
    });

    // Preview / fallback on the app host. Assets resolve relative to /info/.
    // Express routes ignore a trailing slash, so tell /info from /info/ by hand:
    // the page needs the slash for its relative img/ and tour.mp4 links.
    app.get(['/info', '/info/'], (req, res, next) => {
        if (!req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, '/info/');
        serve('index.html', res, next);
    });
    app.get(/^\/info\/(.+)$/, (req, res, next) => {
        const rel = '/' + req.params[0];
        if (!SAFE.test(rel)) return next();
        serve(rel.slice(1), res, next);
    });
}

module.exports = { attachInfoSite, INFO_HOSTS };
