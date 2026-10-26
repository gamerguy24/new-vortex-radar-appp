/*
 * billing.js
 * Stripe-backed Pro paywall for Echo Radar. Adapted from the Postgres/ESM
 * version to this app's stack: CommonJS, the JSON user store (users.json), and
 * the custom signed-cookie session (req.user set by server.js middleware).
 *
 * Billing fields live on each user object:
 *   tier ('free'|'tier1'|'tier2'|'tier3'), stripeCustomerId,
 *   stripeSubscriptionId, subscriptionStatus, subscriptionCurrentPeriodEnd
 *
 * What is sold: ONE plan, pay what you want. A subscriber picks any monthly
 * amount from PLAN.min to PLAN.max and every amount unlocks everything
 * (tier3). Owner's decision, 2026-10-26; it replaced three fixed tiers
 * ($9.99 / $15.99 / $25.99) that never had a subscriber. tier1/tier2 survive
 * only as levels an admin can grant by hand.
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

    // Amounts in cents. The client's slider keeps to this range; checkout
    // enforces it.
    const PLAN = { min: 299, max: 1099, default: 299, currency: 'usd', interval: 'month' };
    // Every paid subscription gets this, whatever amount was chosen.
    const PLAN_TIER = 'tier3';

    let stripe = null;
    if (STRIPE_SECRET) {
        try { stripe = new (require('stripe'))(STRIPE_SECRET); }
        catch (e) { console.error('[billing] Stripe init failed:', e.message); }
    }
    // No Price ids to configure: each checkout makes its own price (see
    // planProductId), so the secret key is all billing needs.
    const isBillingConfigured = !!stripe;
    if (!isBillingConfigured) {
        console.log('[billing] Not configured (set STRIPE_SECRET_KEY). Endpoints return 503.');
    } else {
        console.log(`[billing] Pay what you want: ${money(PLAN.min)}-${money(PLAN.max)}/${PLAN.interval}`);
    }

    /*
     * Does this user have email alerts? Every signed-in user does: email
     * alerts are FREE (owner's decision, 2026-10-18). They were a paid add-on
     * with a Stripe product of their own; it had no subscribers and was
     * deleted from Stripe, so that code is gone. This is the one switch the
     * email channel (critical_messaging.js) checks.
     */
    function hasAlerts(user) {
        return !!user;
    }

    /*
     * The Stripe product every pay-what-you-want price hangs off. Checkout
     * builds the price itself (price_data) from the amount the subscriber
     * chose, and Stripe requires that to name an existing product.
     * STRIPE_PRODUCT_ID pins one; otherwise the product tagged echo_plan=pwyw
     * is found, or made the first time anyone checks out, so a fresh account
     * needs no setup.
     */
    let productIdPromise = null;
    function planProductId() {
        if (process.env.STRIPE_PRODUCT_ID) return Promise.resolve(process.env.STRIPE_PRODUCT_ID.trim());
        if (!productIdPromise) {
            productIdPromise = (async () => {
                const found = await stripe.products.search({ query: "active:'true' AND metadata['echo_plan']:'pwyw'", limit: 1 });
                if (found.data.length) return found.data[0].id;
                const made = await stripe.products.create({ name: 'Echo Radar Pro', metadata: { echo_plan: 'pwyw' } });
                console.log(`[billing] created Stripe product ${made.id} for pay-what-you-want`);
                return made.id;
            })();
            productIdPromise.catch(() => { productIdPromise = null; });   // try again next checkout
        }
        return productIdPromise;
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
            alerts: { active: hasAlerts(user), free: true },
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

    // True when this request's user is at or above `level` (1..3). Tiers are
    // cumulative, and nothing is gated when billing isn't configured (dev).
    // Use this to enforce a tier inside a handler that has other work to do;
    // requireTier() below is the middleware form.
    function hasTier(user, level) {
        if (!isBillingConfigured) return true;
        if (!user) return false;
        return billingState(user).tierLevel >= level;
    }

    // Express middleware: gate a JSON API route behind a tier. This is what
    // stops a signed-in free user from calling a paid feature's endpoint
    // directly from devtools once the client-side gate is bypassed.
    function requireTier(level) {
        return function (req, res, next) {
            if (!isBillingConfigured) return next();
            if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
            if (hasTier(req.user, level)) return next();
            return res.status(402).json({
                error: 'Tier ' + level + ' subscription required',
                requiredTier: level,
                upgrade: '/api/billing/checkout',
            });
        };
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
                const tier = ACTIVE_STATUSES.has(status) ? PLAN_TIER : 'free';
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
                const tier = ACTIVE_STATUSES.has(status) ? PLAN_TIER : 'free';
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

        router.get('/status', (req, res) => {
            const plan = isBillingConfigured ? PLAN : null;
            if (!req.user) {
                return res.json({ signedIn: false, isPro: false, isAdmin: false, tier: 'free', tierLevel: 0, billingConfigured: isBillingConfigured, plan });
            }
            res.json({ signedIn: true, email: req.user.email, billingConfigured: isBillingConfigured, plan, ...billingState(req.user) });
        });

        // Email alerts are free: this only says so (the client asks before showing the sign-up).
        router.get('/alerts', (req, res) => {
            res.json({ free: true, active: hasAlerts(req.user) });
        });

        router.post('/checkout', async (req, res) => {
            if (!isBillingConfigured) return notConfigured(res);
            if (!req.user) return res.status(401).json({ error: 'Sign in first' });
            try {
                // The chosen amount, in whole cents. This is the check that
                // counts: anything outside the range is refused, not clamped.
                const amount = Number(req.body && req.body.amount);
                if (!Number.isInteger(amount) || amount < PLAN.min || amount > PLAN.max) {
                    return res.status(400).json({ error: `Choose an amount from ${money(PLAN.min)} to ${money(PLAN.max)}.` });
                }
                const product = await planProductId();

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
                    line_items: [{
                        price_data: { currency: PLAN.currency, product, unit_amount: amount, recurring: { interval: PLAN.interval } },
                        quantity: 1,
                    }],
                    customer: customerId,
                    client_reference_id: String(user.id),
                    metadata: { tier: PLAN_TIER, amount: String(amount) },
                    subscription_data: { metadata: { tier: PLAN_TIER, amount: String(amount) } },
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
            if (!stripe) return notConfigured(res);
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

    return { webhookRouter, apiRouter, requirePro, requireProPage, requireTier, hasTier, hasAlerts, billingState, isBillingConfigured };
}

function money(cents) {
    return '$' + (cents / 100).toFixed(2);
}

module.exports = { createBilling };
