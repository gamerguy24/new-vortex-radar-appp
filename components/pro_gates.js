/*
 * components/pro_gates.js
 * Client-side Pro gating for the paid features. Adds a "PRO" lock badge to each
 * gated control and intercepts clicks (capture phase) so free users get an
 * upgrade prompt instead of the feature. Server-side enforcement still backs the
 * ones with endpoints (models /api/models, graphics /graphics) — this is the UX
 * layer. Reads paywall state from window.vortexBilling (components/billing_ui.js).
 */

const GATED = [
  { id: 'vortexGraphicsBtn', name: 'Vortex Graphics' },
  { id: 'vortexModelsBtn', name: 'Models & Forecast' },
  { id: 'armrSurfaceFrontsBtn', name: 'Surface Fronts' },
  { id: 'armrTideStationsBtn', name: 'Tide Stations' },
];

function gatingActive() {
  return !!(window.vortexBilling && window.vortexBilling.gatingActive && window.vortexBilling.gatingActive());
}

function upgradeToast(name) {
  const existing = document.getElementById('proGateToast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'proGateToast';
  el.className = 'pro-toast';
  el.innerHTML = `<span>🔒 <b>${name}</b> is a Pro feature.</span><button class="pro-toast-btn">Upgrade</button>`;
  el.querySelector('.pro-toast-btn').onclick = () => {
    el.remove();
    if (window.vortexBilling && window.vortexBilling.startCheckout) window.vortexBilling.startCheckout();
  };
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

function intercept(e, name) {
  if (!gatingActive()) return; // Pro, or no paywall configured → allow through
  e.preventDefault();
  e.stopImmediatePropagation();
  const menu = document.getElementById('atticRadarMenu');
  if (menu) menu.style.display = 'none';
  upgradeToast(name);
}

function setBadge(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  const has = el.querySelector(':scope > .pro-lock');
  if (on && !has) {
    const b = document.createElement('span');
    b.className = 'pro-lock';
    b.textContent = 'PRO';
    el.appendChild(b);
    el.classList.add('pro-gated');
  } else if (!on && has) {
    has.remove();
    el.classList.remove('pro-gated');
  }
}

function refreshBadges() {
  const on = gatingActive();
  for (const g of GATED) setBadge(g.id, on);
}

function init() {
  for (const g of GATED) {
    const el = document.getElementById(g.id);
    if (el) el.addEventListener('click', (e) => intercept(e, g.name), true); // capture
  }
  window.addEventListener('vortexbillingstatus', refreshBadges);
  refreshBadges();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
