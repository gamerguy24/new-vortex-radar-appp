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
    const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
    const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

    let stripe = null;
    if (STRIPE_SECRET) {
        try { stripe = new (require('stripe'))(STRIPE_SECRET); }
        catch (e) { console.error('[billing] Stripe init failed:', e.message); }
    }
    const isBillingConfigured = !!(stripe && STRIPE_PRICE_ID);
    if (!isBillingConfigured) {
        console.log('[billing] Not configured (set STRIPE_SECRET_KEY + STRIPE_PRICE_ID). Endpoints return 503.');
    }

    const notConfigured = (res) => res.status(503).json({ error: 'Billing is not configured on this server.' });

    // Effective Pro state from a user object. Admins are always Pro.
    function billingState(user) {
        if (!user) return { isPro: false, isAdmin: false, tier: 'free' };
        const tier = user.tier || 'free';
        return {
            isPro: !!user.isAdmin || tier === 'pro',
            isAdmin: !!user.isAdmin,
            tier,
            subscriptionStatus: user.subscriptionStatus || null,
            currentPeriodEnd: user.subscriptionCurrentPeriodEnd || null,
            hasStripeCustomer: !!user.stripeCustomerId,
        };
    }

    // Express middleware: gate a route behind Pro.
    function requirePro(req, res, next) {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        if (billingState(req.user).isPro) return next();
        return res.status(402).json({ error: 'Pro subscription required', upgrade: '/api/billing/checkout' });
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
                const tier = ACTIVE_STATUSES.has(status) ? 'pro' : 'free';
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
                const tier = ACTIVE_STATUSES.has(status) ? 'pro' : 'free';
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
            if (!req.user) {
                return res.json({ signedIn: false, isPro: false, isAdmin: false, tier: 'free', billingConfigured: isBillingConfigured });
            }
            res.json({ signedIn: true, email: req.user.email, billingConfigured: isBillingConfigured, ...billingState(req.user) });
        });

        router.post('/checkout', async (req, res) => {
            if (!isBillingConfigured) return notConfigured(res);
            if (!req.user) return res.status(401).json({ error: 'Sign in first' });
            try {
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
                    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
                    customer: customerId,
                    client_reference_id: String(user.id),
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

    return { webhookRouter, apiRouter, requirePro, billingState, isBillingConfigured };
}

module.exports = { createBilling };
