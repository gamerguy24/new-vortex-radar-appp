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

// Feature summaries shown on the plan picker (cumulative — each tier includes
// the ones below it). Mirrors the gating in components/pro_gates.js.
const TIER_INFO = {
  tier1: { name: 'Tier One', features: ['Live Lightning'] },
  tier2: { name: 'Tier Two', features: ['Everything in Tier One', 'Manual Storm Track', 'Split Screen'] },
  tier3: { name: 'Tier Three', features: ['Everything in Tier Two', 'Warning Graphic', 'Models & Forecast', 'My Locations', 'Vortex Graphics'] },
};

// Shared client billing state for the Pro gates (components/pro_gates.js).
// gatingActive() is true only when a paywall is live AND the user isn't Pro.
window.vortexBilling = {
  status: null,
  gatingActive() { const s = this.status; return !!(s && s.billingConfigured && !s.isPro); },
  // Opens the plan picker. Pass a tier id (e.g. 'tier2') to highlight it.
  startCheckout: (preferred) => openTierPicker(preferred),
  openPortal: () => go('portal'),
};

function money(amount, currency, interval) {
  if (amount == null) return '';
  let v;
  try { v = (amount / 100).toLocaleString(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase() }); }
  catch (e) { v = '$' + (amount / 100).toFixed(2); }
  return interval ? `${v}/${interval}` : v;
}

function ensurePickerStyles() {
  if (document.getElementById('vtpStyles')) return;
  const s = document.createElement('style');
  s.id = 'vtpStyles';
  s.textContent = `
    #vortexTierPicker{position:fixed;inset:0;background:rgba(3,7,14,0.72);backdrop-filter:blur(4px);z-index:100070;display:flex;align-items:center;justify-content:center;padding:20px;}
    .vtp-panel{background:#0b1220;border:1px solid rgba(255,255,255,0.12);border-radius:16px;max-width:760px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 24px 70px rgba(0,0,0,0.6);font-family:'Onest',system-ui,sans-serif;color:#e8edf3;}
    .vtp-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);font-weight:700;font-size:16px;}
    .vtp-x{background:none;border:none;color:#9fb0c3;font-size:26px;line-height:1;cursor:pointer;padding:0 4px;}
    .vtp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;padding:18px;}
    .vtp-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px;display:flex;flex-direction:column;}
    .vtp-card-hl{border-color:#27beff;box-shadow:0 0 0 1px #27beff inset;}
    .vtp-name{font-weight:800;font-size:15px;}
    .vtp-price{color:#27beff;font-weight:700;margin:6px 0 10px;min-height:20px;}
    .vtp-feats{list-style:none;margin:0 0 14px;padding:0;flex:1;font-size:13px;color:#c3cedb;}
    .vtp-feats li{padding:3px 0 3px 18px;position:relative;}
    .vtp-feats li:before{content:'\\2713';position:absolute;left:0;color:#34d399;}
    .vtp-choose{margin-top:auto;background:#27beff;color:#04121c;border:none;border-radius:9px;padding:9px;font-weight:700;cursor:pointer;font-family:inherit;}
    .vtp-choose:hover{filter:brightness(1.08);}`;
  document.head.appendChild(s);
}

function openTierPicker(preferred) {
  // No catalog (billing off, or a single legacy price) → go straight to Stripe.
  if (!state || !state.billingConfigured) { go('checkout'); return; }
  const tiers = (state.tiers && state.tiers.length) ? state.tiers : null;
  if (!tiers || tiers.length <= 1) { go('checkout', tiers && tiers[0] ? { tier: tiers[0].tier } : undefined); return; }

  ensurePickerStyles();
  const old = document.getElementById('vortexTierPicker');
  if (old) old.remove();

  const cards = tiers.map((t) => {
    const info = TIER_INFO[t.tier] || { name: t.tier, features: [] };
    const price = money(t.amount, t.currency, t.interval);
    const feats = info.features.map((f) => `<li>${f}</li>`).join('');
    const hl = preferred === t.tier ? ' vtp-card-hl' : '';
    return `<div class="vtp-card${hl}">
        <div class="vtp-name">${info.name}</div>
        <div class="vtp-price">${price}</div>
        <ul class="vtp-feats">${feats}</ul>
        <button class="vtp-choose" data-tier="${t.tier}">Choose ${info.name}</button>
      </div>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'vortexTierPicker';
  overlay.innerHTML = `<div class="vtp-panel">
      <div class="vtp-head"><span>Choose your plan</span><button class="vtp-x" aria-label="Close">&times;</button></div>
      <div class="vtp-cards">${cards}</div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('vtp-x')) { overlay.remove(); return; }
    const btn = e.target.closest('.vtp-choose');
    if (btn) { overlay.remove(); go('checkout', { tier: btn.dataset.tier }); }
  });
}

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

  // Anyone who already has paid/pro access must NEVER be shown "Upgrade to Pro":
  //   - admins (pro by role),
  //   - any paid tier (Tier One+ / legacy "pro"),
  //   - anyone with a Stripe customer record.
  const alreadyHasAccess = !!(state.isPro || state.isAdmin || (state.tierLevel || 0) >= 1 || state.hasStripeCustomer);

  if (alreadyHasAccess) {
    if (state.hasStripeCustomer) {
      // A real Stripe subscriber — let them manage/change their plan in the portal.
      rw.style.display = '';
      if (label()) label().textContent = 'Manage Subscription';
      rw.dataset.action = 'portal';
    } else {
      // Pro by admin grant or admin role — nothing to manage in Stripe, and they
      // must not be prompted to upgrade, so hide the row entirely.
      rw.style.display = 'none';
    }
    return;
  }

  // Free user — offer the upgrade.
  rw.style.display = '';
  if (label()) label().textContent = 'Upgrade to Pro';
  rw.dataset.action = 'checkout';
}

async function go(action, body) {
  try {
    const opts = { method: 'POST' };
    if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    const r = await fetch('/api/billing/' + action, opts);
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
      const action = rw.dataset.action || 'checkout';
      if (action === 'checkout') openTierPicker();  // free user -> pick a plan
      else go(action);                              // subscriber -> portal
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
