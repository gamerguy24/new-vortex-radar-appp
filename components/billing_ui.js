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

// Shared client billing state for the Pro gates (components/pro_gates.js).
// gatingActive() is true only when a paywall is live AND the user isn't Pro.
window.vortexBilling = {
  status: null,
  gatingActive() { const s = this.status; return !!(s && s.billingConfigured && !s.isPro); },
  startCheckout: () => go('checkout'),
  openPortal: () => go('portal'),
};

async function loadStatus() {
  try {
    const r = await fetch('/api/billing/status');
    state = await r.json();
    window.vortexBilling.status = state;
    apply();
    window.dispatchEvent(new CustomEvent('vortexbillingstatus', { detail: state }));
  } catch (e) { /* leave UI untouched on failure */ }
}

function apply() {
  const rw = row();
  const bd = badge();
  if (!state) return;

  // The Pro badge reflects real membership everywhere: only actual Pro members
  // (paid subscribers or admins) ever see it. Never for free users.
  if (bd) bd.style.display = state.isPro ? 'inline-flex' : 'none';

  if (!state.billingConfigured) {
    if (rw) rw.style.display = 'none'; // nothing to sell when billing is off
    return;
  }

  if (!rw) return;
  if (!state.signedIn) { rw.style.display = 'none'; return; }
  // Show for everyone signed in (incl. admins, so it's visible/testable).
  rw.style.display = '';
  const subscriber = state.hasStripeCustomer || (state.tier === 'pro' && !state.isAdmin);
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
