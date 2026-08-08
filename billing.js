/*
 * billing.js
 * Stripe-backed Pro paywall for Vortex Radar. Adapted from the Postgres/ESM
 * version to this app's stack: CommonJS, the JSON user store (users.json), and
 * the custom signed-cookie session (req.user set by server.js middleware).
 *
 * Billing fields live on each user object:
 *   tier ('free'|'pro'), stripeCustomerId, stripeSubscriptionId,
 *   subscriptionStatus, subscriptionCurrentPeriodEnd
 *
 * The Stripe secret never leaves this process — read from STRIPE_SECRET_KEY at
 * boot. If billing env isn't set, the routers still mount but paid endpoints
 * reply 503 so the app boots fine in dev without billing wired up.
 *
 * `store` (injected by server.js) provides:
 *   getById(id), getByStripeCustomer(customerId), update(user, fields)
 */

const express = require('express');

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

function createBilling({ store }) {
    const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
    const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

    // One Stripe price per subscription tier. STRIPE_PRICE_ID is kept as a
    // legacy alias for the Tier Three price so old single-price setups keep
    // working. Set only the tiers you actually sell.
    const PRICE_BY_TIER = {
        tier1: process.env.STRIPE_PRICE_TIER1 || null,
        tier2: process.env.STRIPE_PRICE_TIER2 || null,
        tier3: process.env.STRIPE_PRICE_TIER3 || process.env.STRIPE_PRICE_ID || null,
    };
    // Reverse lookup (price id -> tier) so the webhook can tell which plan was
    // bought, including plan changes made through the customer portal.
    const TIER_BY_PRICE = {};
    for (const [t, p] of Object.entries(PRICE_BY_TIER)) { if (p) TIER_BY_PRICE[p] = t; }
    // Configured tiers, lowest -> highest.
    const configuredTiers = ['tier1', 'tier2', 'tier3'].filter((t) => PRICE_BY_TIER[t]);

    let stripe = null;
    if (STRIPE_SECRET) {
        try { stripe = new (require('stripe'))(STRIPE_SECRET); }
        catch (e) { console.error('[billing] Stripe init failed:', e.message); }
    }
    const isBillingConfigured = !!(stripe && configuredTiers.length);
    if (!isBillingConfigured) {
        console.log('[billing] Not configured (set STRIPE_SECRET_KEY + at least one of STRIPE_PRICE_TIER1/2/3). Endpoints return 503.');
    } else {
        console.log(`[billing] Configured tiers: ${configuredTiers.join(', ')}`);
    }

    // Lazily fetch + cache each configured price's amount/currency/interval so
    // the client can show a real price on the plan picker. Cached after first hit.
    let catalogCache = null;
    async function getCatalog() {
        if (!stripe || !configuredTiers.length) return [];
        if (catalogCache) return catalogCache;
        const out = [];
        for (const t of configuredTiers) {
            const pid = PRICE_BY_TIER[t];
            let amount = null, currency = null, interval = null;
            try {
                const price = await stripe.prices.retrieve(pid);
                amount = price.unit_amount;
                currency = price.currency;
                interval = price.recurring && price.recurring.interval;
            } catch (e) { console.error('[billing] price retrieve failed', pid, e.message); }
            out.push({ tier: t, level: tierToLevel(t), amount, currency, interval });
        }
        catalogCache = out;
        return out;
    }

    // Which tier a subscription grants, derived from its price (survives portal
    // upgrades/downgrades). Falls back to the tier stamped at checkout time.
    function tierFromSubscription(sub) {
        try {
            const pid = sub && sub.items && sub.items.data && sub.items.data[0]
                && sub.items.data[0].price && sub.items.data[0].price.id;
            if (pid && TIER_BY_PRICE[pid]) return TIER_BY_PRICE[pid];
        } catch (e) { /* fall through */ }
        if (sub && sub.metadata && sub.metadata.tier && PRICE_BY_TIER[sub.metadata.tier]) return sub.metadata.tier;
        return configuredTiers[configuredTiers.length - 1] || 'tier3';
    }

    const notConfigured = (res) => res.status(503).json({ error: 'Billing is not configured on this server.' });

    // Map a stored tier string to a cumulative numeric access level. Higher
    // levels include every feature of the levels below them.
    //   0 free · 1 Tier One · 2 Tier Two · 3 Tier Three (== legacy "pro")
    function tierToLevel(tier) {
        switch (tier) {
            case 'tier3':
            case 'pro': return 3;   // legacy single-price subscribers == top tier
            case 'tier2': return 2;
            case 'tier1': return 1;
            default: return 0;
        }
    }

    // Effective billing state from a user object. Admins get the top tier.
    function billingState(user) {
        if (!user) return { isPro: false, isAdmin: false, tier: 'free', tierLevel: 0 };
        const tier = user.tier || 'free';
        const tierLevel = user.isAdmin ? 3 : tierToLevel(tier);
        return {
            // isPro keeps its legacy meaning: full (Tier Three) access. This is
            // what the server-side requirePro gates and the Pro badge rely on.
            isPro: tierLevel >= 3,
            isAdmin: !!user.isAdmin,
            tier,
            tierLevel,
            subscriptionStatus: user.subscriptionStatus || null,
            currentPeriodEnd: user.subscriptionCurrentPeriodEnd || null,
            hasStripeCustomer: !!user.stripeCustomerId,
        };
    }

    // Express middleware: gate a JSON API route behind Pro. When billing isn't
    // configured, nothing is gated (the app runs fully open in dev).
    function requirePro(req, res, next) {
        if (!isBillingConfigured) return next();
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        if (billingState(req.user).isPro) return next();
        return res.status(402).json({ error: 'Pro subscription required', upgrade: '/api/billing/checkout' });
    }

    // Same gate for page/asset routes: redirect HTML navigations to an upgrade
    // prompt instead of returning raw 402 JSON.
    function requireProPage(req, res, next) {
        if (!isBillingConfigured) return next();
        if (req.user && billingState(req.user).isPro) return next();
        if ((req.headers.accept || '').includes('text/html')) return res.redirect('/?upgrade=required');
        return res.status(402).json({ error: 'Pro subscription required' });
    }

    // ── Webhook (raw body; MUST mount before any express.json) ────────────────
    function webhookRouter() {
        const router = express.Router();
        router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
            if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(503).send('Billing not configured');
            let event;
            try {
                event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
            } catch (err) {
                console.error('[billing] webhook signature verification failed:', err.message);
                return res.status(400).send(`Webhook Error: ${err.message}`);
            }
            try { await handleWebhookEvent(event); res.json({ received: true }); }
            catch (err) { console.error('[billing] webhook handler error:', err); res.status(500).send('Webhook handler error'); }
        });
        return router;
    }

    async function handleWebhookEvent(event) {
        const data = event.data.object;
        switch (event.type) {
            case 'checkout.session.completed': {
                const userId = data.client_reference_id;
                if (!userId) { console.warn('[billing] checkout.completed missing client_reference_id'); return; }
                const subscriptionId = data.subscription;
                const sub = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null;
                const status = (sub && sub.status) || 'active';
                const periodEnd = sub && sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
                const paidTier = sub ? tierFromSubscription(sub)
                    : ((data.metadata && data.metadata.tier) || configuredTiers[configuredTiers.length - 1] || 'tier3');
                const tier = ACTIVE_STATUSES.has(status) ? paidTier : 'free';
                const user = store.getById(userId);
                if (user) {
                    store.update(user, {
                        stripeCustomerId: data.customer,
                        stripeSubscriptionId: subscriptionId,
                        subscriptionStatus: status,
                        subscriptionCurrentPeriodEnd: periodEnd,
                        tier,
                    });
                    console.log(`[billing] user ${userId} upgraded to ${tier} (status=${status})`);
                } else {
                    console.warn(`[billing] checkout.completed for unknown user ${userId}`);
                }
                break;
            }
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const status = data.status;
                const periodEnd = data.current_period_end ? new Date(data.current_period_end * 1000).toISOString() : null;
                const tier = ACTIVE_STATUSES.has(status) ? tierFromSubscription(data) : 'free';
                const user = store.getByStripeCustomer(data.customer);
                if (user) {
                    store.update(user, {
                        stripeSubscriptionId: data.id,
                        subscriptionStatus: status,
                        subscriptionCurrentPeriodEnd: periodEnd,
                        tier,
                    });
                } else {
                    console.warn(`[billing] ${event.type} for unknown customer ${data.customer}`);
                }
                break;
            }
            default:
                break;
        }
    }

    // ── JSON API: status / checkout / portal ──────────────────────────────────
    function apiRouter() {
        const router = express.Router();
        router.use(express.json({ limit: '10kb' })); // no-op if body already parsed

        router.get('/status', async (req, res) => {
            const tiers = await getCatalog().catch(() => []);
            if (!req.user) {
                return res.json({ signedIn: false, isPro: false, isAdmin: false, tier: 'free', tierLevel: 0, billingConfigured: isBillingConfigured, tiers });
            }
            res.json({ signedIn: true, email: req.user.email, billingConfigured: isBillingConfigured, tiers, ...billingState(req.user) });
        });

        router.post('/checkout', async (req, res) => {
            if (!isBillingConfigured) return notConfigured(res);
            if (!req.user) return res.status(401).json({ error: 'Sign in first' });
            try {
                // Resolve which tier's price to charge. Default to the highest
                // configured tier if the client didn't ask for a specific one.
                let tier = String((req.body && req.body.tier) || '').toLowerCase();
                if (tier === 'pro') tier = 'tier3';
                if (!PRICE_BY_TIER[tier]) tier = configuredTiers[configuredTiers.length - 1];
                const priceId = PRICE_BY_TIER[tier];
                if (!priceId) return res.status(400).json({ error: 'That plan is not available.' });

                const origin = `${req.protocol}://${req.get('host')}`;
                const user = req.user;
                let customerId = user.stripeCustomerId;
                if (!customerId) {
                    const customer = await stripe.customers.create({ email: user.email, metadata: { user_id: String(user.id) } });
                    customerId = customer.id;
                    store.update(user, { stripeCustomerId: customerId });
                }
                const session = await stripe.checkout.sessions.create({
                    mode: 'subscription',
                    payment_method_types: ['card'],
                    line_items: [{ price: priceId, quantity: 1 }],
                    customer: customerId,
                    client_reference_id: String(user.id),
                    metadata: { tier },
                    subscription_data: { metadata: { tier } },
                    success_url: process.env.STRIPE_SUCCESS_URL || `${origin}/?upgrade=success`,
                    cancel_url: process.env.STRIPE_CANCEL_URL || `${origin}/?upgrade=cancelled`,
                    allow_promotion_codes: true,
                });
                res.json({ url: session.url });
            } catch (err) {
                console.error('[billing] checkout error', err);
                res.status(500).json({ error: 'Could not start checkout' });
            }
        });

        router.post('/portal', async (req, res) => {
            if (!isBillingConfigured) return notConfigured(res);
            if (!req.user) return res.status(401).json({ error: 'Sign in first' });
            try {
                const customerId = req.user.stripeCustomerId;
                if (!customerId) return res.status(400).json({ error: 'No subscription on file' });
                const origin = `${req.protocol}://${req.get('host')}`;
                const portal = await stripe.billingPortal.sessions.create({
                    customer: customerId,
                    return_url: process.env.STRIPE_PORTAL_RETURN_URL || `${origin}/`,
                });
                res.json({ url: portal.url });
            } catch (err) {
                console.error('[billing] portal error', err);
                res.status(500).json({ error: 'Could not open customer portal' });
            }
        });

        return router;
    }

    return { webhookRouter, apiRouter, requirePro, requireProPage, billingState, isBillingConfigured };
}

module.exports = { createBilling };
