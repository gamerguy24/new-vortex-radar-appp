/*
 * components/pro_gates.js
 * Client-side subscription gating for the paid features, organized into three
 * cumulative levels (a higher level unlocks everything below it). What is sold
 * is one pay-what-you-want Pro plan that grants level 3, so to a subscriber all
 * of these are simply "Pro"; the lower levels exist for admin grants.
 *
 *   Tier One   (level 1) — Live Lightning, Surface Fronts, Tide Stations,
 *                          Buoys, BuoyCAMs, Power Outages
 *   Tier Two   (level 2) — Manual Storm Track, Split Screen
 *   Tier Three (level 3) — Warning Graphic, Models & Forecast, My Locations,
 *                          Echo Graphics, 3D Storm View
 *
 * Clicks are intercepted in the capture phase so users below the required tier
 * get an upgrade prompt instead of the feature. No "PRO" badge is shown here —
 * that sign is reserved for actual members (footer badge, billing_ui.js).
 * Server-side enforcement still backs the ones with endpoints (Tier Three:
 * models /api/models, graphics /graphics via requirePro).
 *
 * Reads the viewer's tier from window.vortexBilling (components/billing_ui.js).
 */


// Feature button id -> required tier level. Cumulative: a viewer at or above
// the listed level may use the feature.
const FEATURES = [
  // Tier One
  { id: 'armrLightningVisBtn', name: 'Live Lightning', tier: 1 },
  { id: 'armrSurfaceFrontsBtn', name: 'Surface Fronts', tier: 1 },
  { id: 'armrTideStationsBtn', name: 'Tide Stations', tier: 1 },
  { id: 'armrBuoysBtn', name: 'Buoys', tier: 1 },
  { id: 'armrBuoyCamsBtn', name: 'BuoyCAMs', tier: 1 },
  { id: 'armrPowerOutagesBtn', name: 'Power Outages', tier: 1 },
  // Tier Two
  { id: 'mstMenuItemDiv', name: 'Manual Storm Track', tier: 2 },
  { id: 'armrMstBtn', name: 'Manual Storm Track', tier: 2 },
  { id: 'vortexSplitBtn', name: 'Split Screen', tier: 2 },
  // Tier Three
  { id: 'warnGraphicBtn', name: 'Warning Graphic', tier: 3 },
  { id: 'vortexModelsBtn', name: 'Models & Forecast', tier: 3 },
  { id: 'vortexLocationsBtn', name: 'My Locations', tier: 3 },
  { id: 'vortexGraphicsBtn', name: 'Echo Graphics', tier: 3 },
  { id: 'armrStorm3DBtn', name: '3D Storm View', tier: 3 },
  { id: 'psmStorm3DRow', name: '3D Storm View', tier: 3 },
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
  const el = document.createElement('div');
  el.id = 'proGateToast';
  el.className = 'pro-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span><b>${name}</b> is part of Pro.</span><button class="pro-toast-btn">Upgrade</button><button class="pro-toast-dismiss" aria-label="Dismiss">Dismiss</button>`;
  // Dismiss (button or Escape) just closes it; nothing else happens.
  const close = () => { el.remove(); clearTimeout(timer); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el.querySelector('.pro-toast-btn').onclick = () => {
    close();
    if (window.vortexBilling && window.vortexBilling.startCheckout) window.vortexBilling.startCheckout();
  };
  el.querySelector('.pro-toast-dismiss').onclick = close;
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(el);
  const timer = setTimeout(close, 8000);
}

// The server enforces the same tiers on the paid data endpoints (see
// PROXY_TIER_RULES and billing.requireTier in server.js), so a viewer who
// bypasses the click gate in devtools gets a 402 instead of the data. Layers
// funnel that response through here to show the same upgrade prompt and put
// their menu switch back to off, rather than failing silently.
window.vortexProGate = {
  prompt: upgradeToast,
  paywalled(res) { return !!res && res.status === 402; },
  denied(name, requiredTier, switchId) {
    upgradeToast(name, requiredTier || 1);
    if (switchId) {
      const el = document.getElementById(switchId);
      if (el && el.checked) el.checked = false;
    }
  },
};

function init() {
  // ONE capture-phase listener on the document. Because the capture phase
  // descends document → target, this always runs BEFORE any element's own click
  // handler — regardless of which library bound it, in what order, or which
  // sub-element (icon vs. button) was actually clicked. stopImmediatePropagation
  // then reliably prevents the feature from ever running for a locked viewer.
  document.addEventListener('click', (e) => {
    if (!e.target || !e.target.closest) return;
    for (const f of FEATURES) {
      if (!e.target.closest('#' + f.id)) continue;
      if (isLocked(f.tier)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const menu = document.getElementById('vortexRadarMenu');
        if (menu) menu.style.display = 'none';
        const psm = document.getElementById('productSelectionMenu');
        if (psm) psm.style.display = 'none';
        upgradeToast(f.name, f.tier);
      }
      return; // matched a gated feature; stop scanning
    }
  }, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
