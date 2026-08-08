/*
 * components/pro_gates.js
 * Client-side subscription gating for the paid features, organized into three
 * cumulative tiers (a higher tier unlocks everything below it):
 *
 *   Tier One   (level 1) — Live Lightning
 *   Tier Two   (level 2) — Manual Storm Track, Split Screen
 *   Tier Three (level 3) — Warning Graphic, Models & Forecast, My Locations,
 *                          Vortex Graphics
 *
 * Clicks are intercepted in the capture phase so users below the required tier
 * get an upgrade prompt instead of the feature. No "PRO" badge is shown here —
 * that sign is reserved for actual members (footer badge, billing_ui.js).
 * Server-side enforcement still backs the ones with endpoints (Tier Three:
 * models /api/models, graphics /graphics via requirePro).
 *
 * Reads the viewer's tier from window.vortexBilling (components/billing_ui.js).
 */

const TIER_NAMES = { 1: 'Tier One', 2: 'Tier Two', 3: 'Tier Three' };

// Feature button id -> required tier level. Cumulative: a viewer at or above
// the listed level may use the feature.
const FEATURES = [
  // Tier One
  { id: 'armrLightningVisBtn', name: 'Live Lightning', tier: 1 },
  // Tier Two
  { id: 'mstMenuItemDiv', name: 'Manual Storm Track', tier: 2 },
  { id: 'vortexSplitBtn', name: 'Split Screen', tier: 2 },
  // Tier Three
  { id: 'warnGraphicBtn', name: 'Warning Graphic', tier: 3 },
  { id: 'vortexModelsBtn', name: 'Models & Forecast', tier: 3 },
  { id: 'vortexLocationsBtn', name: 'My Locations', tier: 3 },
  { id: 'vortexGraphicsBtn', name: 'Vortex Graphics', tier: 3 },
];

// True only when a paywall is actually live for this deployment. When billing
// isn't configured (dev), nothing is gated and everything is unlocked.
function paywallLive() {
  const s = window.vortexBilling && window.vortexBilling.status;
  return !!(s && s.billingConfigured);
}

// The viewer's cumulative access level (0 = free ... 3 = Tier Three / admin).
function userTierLevel() {
  const s = window.vortexBilling && window.vortexBilling.status;
  if (!s) return 0;
  if (typeof s.tierLevel === 'number') return s.tierLevel;
  if (s.isAdmin) return 3;
  if (s.isPro) return 3;                 // legacy status without tierLevel
  return 0;
}

// Should this feature be blocked for the current viewer?
function isLocked(requiredTier) {
  if (!paywallLive()) return false;
  return userTierLevel() < requiredTier;
}

function upgradeToast(name, requiredTier) {
  const existing = document.getElementById('proGateToast');
  if (existing) existing.remove();
  const tierName = TIER_NAMES[requiredTier] || 'a higher tier';
  const el = document.createElement('div');
  el.id = 'proGateToast';
  el.className = 'pro-toast';
  el.innerHTML = `<span>🔒 <b>${name}</b> needs <b>${tierName}</b>.</span><button class="pro-toast-btn">Upgrade</button>`;
  el.querySelector('.pro-toast-btn').onclick = () => {
    el.remove();
    // Open the plan picker with the tier this feature needs pre-highlighted.
    if (window.vortexBilling && window.vortexBilling.startCheckout) window.vortexBilling.startCheckout('tier' + requiredTier);
  };
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

function intercept(e, feature) {
  if (!isLocked(feature.tier)) return; // at/above required tier, or no paywall → allow
  e.preventDefault();
  e.stopImmediatePropagation();
  const menu = document.getElementById('atticRadarMenu');
  if (menu) menu.style.display = 'none';
  upgradeToast(feature.name, feature.tier);
}

function init() {
  for (const f of FEATURES) {
    const el = document.getElementById(f.id);
    if (el) el.addEventListener('click', (e) => intercept(e, f), true); // capture
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
