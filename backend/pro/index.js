/*
 * backend/pro/index.js
 * Server side of VORTEX PRO — the licensed workspace at /pro.
 *
 * WHO THIS IS FOR
 * Television and radio newsrooms, school districts, and emergency management
 * agencies. Not storm chasers, and not the consumer app wearing a different
 * colour: /pro is a separate front end (pro/index.html) over the same engine,
 * the way /eoc already is.
 *
 * WHY THIS IS NOT A FOURTH STRIPE TIER
 * The tier1/tier2/tier3 ladder in billing.js is a self-serve paywall: anyone
 * with a card buys it in a checkout page, it belongs to one person, and it is
 * cumulative — tier3 means "has paid the most". None of that describes a TV
 * station or a school district. They buy on a contract or a purchase order,
 * the licence belongs to the ORGANISATION rather than to whoever happens to be
 * signed in, and it is not something a consumer should be able to buy their
 * way into by accident. So this is a separate axis: an admin grants an
 * organisation licence, and that is the only way in.
 *
 * A user can hold both. An org licence says nothing about their consumer tier,
 * and deliberately does not grant it — the two gates are checked separately.
 *
 * WHAT LIVES HERE
 *   requireOrg / requireOrgPage   the licence gates
 *   /api/pro/session              who the viewer is and which org they carry
 *   /api/pro/counties             county search, for building a coverage area
 *   /api/pro/coverage             the org's coverage area (GET/POST)
 *   /api/pro/board                active warnings narrowed to that coverage
 *
 * The board reuses backend/eoc's buildOverview() rather than fetching the NWS
 * feed a second time. That cache is shared process-wide, so a newsroom polling
 * every 20 seconds and an EOC screen polling every 30 add no extra load on
 * weather.gov between them.
 */

const path = require('path');

const { buildOverview } = require('../eoc');

/*
 * The organisation kinds. The workspace reads this to decide what to put on
 * screen: a newsroom wants crawl copy and cut-in triggers, a school district
 * wants "which of my campuses is under this warning", and an agency wants
 * neither. Keep the ids stable — they are stored on user records.
 */
const ORG_TYPES = {
    media: { label: 'Media', desc: 'Television, radio and digital newsrooms' },
    school: { label: 'School District', desc: 'Districts, campuses and universities' },
    agency: { label: 'Agency', desc: 'Emergency management and public safety' },
};

/** The org licence on a user, normalised, or null if they hold none. */
function orgOf(user) {
    if (!user || !user.org || !ORG_TYPES[user.org.type]) return null;
    return {
        type: user.org.type,
        name: String(user.org.name || '').slice(0, 120) || ORG_TYPES[user.org.type].label,
        grantedAt: user.org.grantedAt || null,
    };
}

/*
 * Admins can always open /pro. Without this the person who grants licences
 * cannot see the thing they are granting, which makes support impossible.
 * Their effective org is a placeholder, so the workspace has a name to show.
 */
function effectiveOrg(user) {
    const real = orgOf(user);
    if (real) return real;
    if (user && user.isAdmin) return { type: 'agency', name: 'Vortex Radar (admin)', grantedAt: null, viaAdmin: true };
    return null;
}

function hasOrg(user) {
    return !!effectiveOrg(user);
}

/*
 * JSON gate. 403, not 402: 402 means "pay us and you can have it", which is
 * what the consumer tiers return and is the wrong thing to tell someone whose
 * organisation simply is not licensed. There is no checkout link to offer.
 */
function requireOrg(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.isLocked) return res.status(403).json({ error: 'Account locked' });
    if (hasOrg(req.user)) return next();
    return res.status(403).json({
        error: 'Vortex Pro is licensed to organisations. Contact us to have your account enabled.',
        proRequired: true,
    });
}

/*
 * Page gate. Unlike billing's requireProPage this is NOT relaxed when Stripe is
 * unconfigured — an org licence is an explicit grant, not a paywall, so there
 * is no "dev mode" in which everyone is a TV station. Admins already pass via
 * effectiveOrg, which is what keeps a self-hosted operator from locking
 * themselves out of their own install.
 */
function requireOrgPage(req, res, next) {
    const wantsHtml = (req.headers.accept || '').includes('text/html');
    if (!req.user) {
        if (wantsHtml) return res.redirect('/login.html');
        return res.status(401).json({ error: 'Not authenticated' });
    }
    if (hasOrg(req.user)) return next();
    if (wantsHtml) return res.redirect('/?pro=required');
    return res.status(403).json({ error: 'Vortex Pro licence required', proRequired: true });
}

/* ── coverage area ──────────────────────────────────────────────────────────
 * A newsroom cares about its market, not about the country. Coverage is stored
 * as a list of 5-digit county FIPS because that is the unit every NWS warning
 * can be resolved to: measured against the live feed, essentially every alert
 * carries geocode.SAME while only about one in ten carries a polygon (see the
 * note in backend/eoc/index.js). Storing a bounding box or a radius instead
 * would look tidier and would silently miss most warnings.
 */
const MAX_COUNTIES = 400;   // ~13% of the country; far beyond any real market

function makeCoverageStore({ DATA_DIR, readJson, writeJson }) {
    // userId -> { counties: [fips], updatedAt }
    const FILE = path.join(DATA_DIR, 'pro_coverage.json');
    let all = readJson(FILE, {});
    if (!all || typeof all !== 'object') all = {};

    const save = () => { try { writeJson(FILE, all); } catch (e) { console.warn('[PRO] could not save coverage:', e.message); } };

    return {
        get(userId) {
            const rec = all[userId];
            if (!rec) return { counties: [], updatedAt: null };
            return {
                counties: Array.isArray(rec.counties) ? rec.counties : [],
                updatedAt: rec.updatedAt || null,
            };
        },
        set(userId, counties) {
            all[userId] = { counties, updatedAt: new Date().toISOString() };
            save();
            return all[userId];
        },
    };
}

/* County name table, loaded from the same file the EOC population count uses. */
let COUNTY_NAMES = null;
function countyNames() {
    if (COUNTY_NAMES) return COUNTY_NAMES;
    try {
        const raw = require(path.join(__dirname, '..', '..', 'data', 'county_population.json'));
        COUNTY_NAMES = raw.names || {};
    } catch (e) {
        console.warn('[PRO] county name table unavailable:', e.message);
        COUNTY_NAMES = {};
    }
    return COUNTY_NAMES;
}

/** Keep only well-formed 5-digit FIPS that name a county we actually know. */
function cleanCounties(input) {
    const names = countyNames();
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(input) ? input : []) {
        const fips = String(raw).replace(/[^0-9]/g, '').padStart(5, '0');
        if (fips.length !== 5 || seen.has(fips) || !names[fips]) continue;
        seen.add(fips);
        out.push(fips);
        if (out.length >= MAX_COUNTIES) break;
    }
    return out;
}

/* ── routes ──────────────────────────────────────────────────────────────── */

function attachPro({ app, requireAuth, DATA_DIR, readJson, writeJson }) {
    const coverage = makeCoverageStore({ DATA_DIR, readJson, writeJson });

    // The workspace itself.
    app.use('/pro', requireOrgPage);

    // Who is looking, and under which licence. The workspace lays itself out
    // from org.type, so this is the first call it makes.
    app.get('/api/pro/session', requireAuth, requireOrg, (req, res) => {
        const org = effectiveOrg(req.user);
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            email: req.user.email,
            isAdmin: !!req.user.isAdmin,
            org,
            orgTypes: ORG_TYPES,
            coverage: coverage.get(req.user.id),
        });
    });

    // County search for the coverage picker. Substring match on the Census
    // name ("Tarrant County, Texas"), so typing either a county or a state
    // works without a second index.
    app.get('/api/pro/counties', requireAuth, requireOrg, (req, res) => {
        const q = String(req.query.q || '').trim().toLowerCase();
        const names = countyNames();
        if (q.length < 2) return res.json({ counties: [] });
        const out = [];
        for (const fips of Object.keys(names)) {
            if (names[fips].toLowerCase().includes(q)) {
                out.push({ fips, name: names[fips] });
                if (out.length >= 50) break;
            }
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        res.json({ counties: out });
    });

    app.get('/api/pro/coverage', requireAuth, requireOrg, (req, res) => {
        const rec = coverage.get(req.user.id);
        const names = countyNames();
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            counties: rec.counties.map((fips) => ({ fips, name: names[fips] || fips })),
            updatedAt: rec.updatedAt,
        });
    });

    app.post('/api/pro/coverage', requireAuth, requireOrg, (req, res) => {
        const counties = cleanCounties(req.body && req.body.counties);
        const rec = coverage.set(req.user.id, counties);
        const names = countyNames();
        res.json({
            counties: counties.map((fips) => ({ fips, name: names[fips] || fips })),
            updatedAt: rec.updatedAt,
            // Say what was thrown away rather than silently saving less than
            // was sent — a coverage area quietly missing three counties is a
            // warning that quietly never appears.
            dropped: (Array.isArray(req.body && req.body.counties) ? req.body.counties.length : 0) - counties.length,
        });
    });

    /*
     * The board: active warnings, split into the ones inside this org's
     * coverage and the ones outside it.
     *
     * Both are returned. A newsroom still needs to see a tornado warning one
     * county outside the market — it is coming, and it is a story — so the
     * answer is to rank it below the in-market warnings, not to hide it.
     */
    app.get('/api/pro/board', requireAuth, requireOrg, async (req, res) => {
        try {
            const rec = coverage.get(req.user.id);
            const set = new Set(rec.counties);
            const overview = await buildOverview({});
            const names = countyNames();

            const inArea = [];
            const outside = [];
            for (const w of overview.warnings || []) {
                const hit = (w.counties || []).filter((f) => set.has(f));
                const row = {
                    ...w,
                    coverageCounties: hit,
                    coverageCountyNames: hit.map((f) => names[f] || f),
                };
                if (hit.length) inArea.push(row);
                else outside.push(row);
            }

            // Population inside the coverage area only, de-duplicated: a county
            // under a tornado warning and a flash flood warning is one county
            // and one population, not two.
            const popTouched = new Set();
            for (const w of inArea) for (const f of w.coverageCounties) popTouched.add(f);

            res.setHeader('Cache-Control', 'no-store');
            res.json({
                generated: overview.generated,
                fetchedAt: overview.fetchedAt,
                stale: overview.stale,
                staleReason: overview.staleReason,
                coverage: {
                    counties: rec.counties.length,
                    configured: rec.counties.length > 0,
                    countiesAffected: popTouched.size,
                },
                inArea,
                outside,
                counts: overview.counts,
                populationAffected: overview.populationAffected,
            });
        } catch (e) {
            res.status(502).json({ error: 'Warning feed unavailable: ' + (e.message || e) });
        }
    });

    console.log('[PRO] attached: /pro, /api/pro/{session,counties,coverage,board}');
}

module.exports = {
    attachPro,
    ORG_TYPES,
    orgOf,
    effectiveOrg,
    hasOrg,
    requireOrg,
    requireOrgPage,
    cleanCounties,
};
