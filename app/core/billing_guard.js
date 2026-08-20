/*
 * billing_guard.js
 * Bulletproof "never show Upgrade to Pro to someone who already has access".
 *
 * This lives in the BUNDLE (which is version-stamped/cache-busted via size.txt),
 * so it deploys reliably — unlike components/billing_ui.js, whose stale cached
 * copy kept showing the upgrade row to admins/pro users. It reads the
 * authoritative /api/billing/status and, for anyone with access (admin, any paid
 * tier, or a Stripe customer), force-hides #armrUpgradeProBtn with !important and
 * a MutationObserver so it stays hidden even if a stale billing_ui tries to show
 * it.
 */
function hideUpgradeForMembers() {
    fetch('/api/billing/status', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then((r) => r.json())
        .then((d) => {
            const hasAccess = !!(d && (d.isPro || d.isAdmin || (d.tierLevel || 0) >= 1 || d.hasStripeCustomer));
            if (!hasAccess) return;
            const el = document.getElementById('armrUpgradeProBtn');
            if (!el) return;
            const hide = () => { if (el.style.display !== 'none') el.style.setProperty('display', 'none', 'important'); };
            hide();
            try {
                new MutationObserver(hide).observe(el, { attributes: true, attributeFilter: ['style'] });
            } catch (e) { /* MutationObserver unsupported — the initial hide still applies */ }
        })
        .catch(() => { /* billing off / not signed in — nothing to do */ });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hideUpgradeForMembers);
else hideUpgradeForMembers();

module.exports = {};
