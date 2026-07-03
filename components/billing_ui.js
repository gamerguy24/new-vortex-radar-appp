/*
 * components/billing_ui.js
 * Client for the Stripe billing layer (server: billing.js). Reads
 * /api/billing/status and drives the "Upgrade to Pro" menu row + the footer Pro
 * badge. Free users get Upgrade -> Checkout; paid subscribers get Manage
 * Subscription -> Customer Portal. Admins are Pro by role (row hidden). If
 * billing isn't configured on the server, the row stays hidden.
 */

let state = null;

const $ = (id) => document.getElementById(id);
function badge() { return $('vortexProBadge'); }
function row() { return $('armrUpgradeProBtn'); }
function label() { return $('armrUpgradeProLabel'); }

function toast(msg, kind) {
  const colors = { info: '#27beff', warn: '#facc15', good: '#34d399' };
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed; bottom:78px; left:50%; transform:translateX(-50%);
    background:rgba(11,18,32,0.97); color:${colors[kind] || colors.info};
    border:1px solid ${colors[kind] || colors.info}; padding:10px 16px; border-radius:10px;
    font-family:'Onest',system-ui,sans-serif; font-size:13px; z-index:100060;
    box-shadow:0 10px 30px rgba(0,0,0,0.5);`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function loadStatus() {
  try {
    const r = await fetch('/api/billing/status');
    state = await r.json();
    apply();
  } catch (e) { /* leave UI untouched on failure */ }
}

function apply() {
  const rw = row();
  const bd = badge();
  if (!state) return;

  if (!state.billingConfigured) {
    // Billing not set up on this server — hide the upgrade row, leave the badge
    // as-is (it's product branding until real tiers are live).
    if (rw) rw.style.display = 'none';
    return;
  }

  // Pro badge now reflects real entitlement.
  if (bd) bd.style.display = state.isPro ? 'inline-flex' : 'none';

  if (!rw) return;
  if (!state.signedIn || state.isAdmin) {
    rw.style.display = 'none'; // not signed in, or Pro-by-admin (nothing to buy)
    return;
  }
  rw.style.display = '';
  const subscriber = state.tier === 'pro' || state.hasStripeCustomer;
  if (label()) label().textContent = subscriber ? 'Manage Subscription' : 'Upgrade to Pro';
  rw.dataset.action = subscriber ? 'portal' : 'checkout';
}

async function go(action) {
  try {
    const r = await fetch('/api/billing/' + action, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (d.url) { window.location.href = d.url; return; }
    toast(d.error || 'Could not open billing.', 'warn');
  } catch (e) { toast('Network error opening billing.', 'warn'); }
}

function init() {
  const rw = row();
  if (rw) {
    rw.addEventListener('click', () => {
      const menu = $('atticRadarMenu');
      if (menu) menu.style.display = 'none';
      go(rw.dataset.action || 'checkout');
    });
  }

  // Show a result toast after returning from Stripe Checkout, then clean the URL.
  const p = new URLSearchParams(location.search);
  if (p.get('upgrade') === 'success') toast('Welcome to Pro! 🎉 Your account is being upgraded.', 'good');
  else if (p.get('upgrade') === 'cancelled') toast('Checkout cancelled — no charge made.', 'warn');
  if (p.has('upgrade')) {
    p.delete('upgrade');
    history.replaceState({}, '', location.pathname + (p.toString() ? '?' + p.toString() : ''));
  }

  loadStatus();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
