/*
 * components/pro_gates.js
 * Client-side Pro gating for the paid features. Intercepts clicks (capture
 * phase) so free users get an upgrade prompt instead of the feature. No "PRO"
 * badge is shown — the sign is reserved for actual Pro members (the footer
 * badge, handled by components/billing_ui.js). Server-side enforcement still
 * backs the ones with endpoints (models /api/models, graphics /graphics).
 * Reads paywall state from window.vortexBilling (components/billing_ui.js).
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
  if (!gatingActive()) return; // Pro/admin, or no paywall configured → allow through
  e.preventDefault();
  e.stopImmediatePropagation();
  const menu = document.getElementById('atticRadarMenu');
  if (menu) menu.style.display = 'none';
  upgradeToast(name);
}

function init() {
  for (const g of GATED) {
    const el = document.getElementById(g.id);
    if (el) el.addEventListener('click', (e) => intercept(e, g.name), true); // capture
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
