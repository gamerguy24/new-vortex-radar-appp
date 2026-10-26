/*
 * components/billing_ui.js
 * Client for the Stripe billing layer (server: billing.js). Reads
 * /api/billing/status and drives the "Upgrade to Pro" menu row + the footer Pro
 * badge. Free users get Upgrade -> the pay-what-you-want picker -> Checkout;
 * paid subscribers get Manage Subscription -> Customer Portal. Admins are Pro
 * by role (row hidden). If billing isn't configured on the server, the row
 * stays hidden.
 */

let state = null;

const $ = (id) => document.getElementById(id);
function badge() { return $('vortexProBadge'); }
function row() { return $('armrUpgradeProBtn'); }
function label() { return $('armrUpgradeProLabel'); }

function toast(msg, kind) {
  const colors = { info: 'var(--vx-accent)', warn: 'var(--vx-warn)', good: 'var(--vx-ok)' };
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed; bottom:78px; left:50%; transform:translateX(-50%);
    background:var(--vx-surface); color:${colors[kind] || colors.info};
    border:1px solid ${colors[kind] || colors.info}; padding:10px 16px; border-radius:var(--vx-r-3);
    font-family:var(--vx-font); font-size:13px; z-index:100060;
    box-shadow:var(--vx-shadow);`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// Everything Pro unlocks (all three gate levels in components/pro_gates.js).
// Pay what you want: every amount gets the whole list.
const PRO_FEATURES = [
  'Live Lightning', 'Surface Fronts', 'Power Outages', 'Tide Stations', 'Buoys', 'BuoyCAMs',
  'Manual Storm Track', 'Split Screen', 'Models & Forecast', '3D Storm View', 'Echo Graphics',
  'Warning Graphic', 'My Locations',
];

// Shared client billing state for the Pro gates (components/pro_gates.js).
// gatingActive() is true only when a paywall is live AND the user isn't Pro.
window.vortexBilling = {
  status: null,
  gatingActive() { const s = this.status; return !!(s && s.billingConfigured && !s.isPro); },
  // Opens the pay-what-you-want picker. (Takes no plan any more: there is one.)
  startCheckout: () => openTierPicker(),
  openPortal: () => go('portal'),
};

function dollars(cents) { return '$' + (cents / 100).toFixed(2); }

function ensurePickerStyles() {
  if (document.getElementById('vtpStyles')) return;
  const s = document.createElement('style');
  s.id = 'vtpStyles';
  s.textContent = `
    #vortexTierPicker{position:fixed;inset:0;background:var(--vx-scrim);z-index:100070;display:flex;align-items:center;justify-content:center;padding:20px;}
    .vtp-panel{background:var(--vx-surface);border:1px solid rgba(255,255,255,0.12);border-radius:var(--vx-r-3);max-width:460px;width:100%;max-height:88vh;overflow:auto;box-shadow:var(--vx-shadow-lg);font-family:var(--vx-font);color:var(--vx-text);}
    .vtp-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);font-weight:700;font-size:16px;}
    .vtp-x{background:none;border:none;color:var(--vx-text-2);font-size:26px;line-height:1;cursor:pointer;padding:0 4px;}
    .vtp-body{padding:18px 20px 6px;}
    .vtp-lede{margin:0 0 16px;font-size:13.5px;line-height:1.45;color:var(--vx-text-2);}
    .vtp-amount{display:flex;align-items:baseline;justify-content:center;gap:4px;margin-bottom:10px;}
    .vtp-cur{font-size:26px;font-weight:800;color:var(--vx-accent);}
    .vtp-amount input{width:110px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.16);border-radius:var(--vx-r-2);color:var(--vx-text);font:800 26px var(--vx-font);text-align:center;padding:4px 6px;}
    .vtp-amount input:focus{outline:none;border-color:var(--vx-accent);}
    .vtp-amount input.vtp-bad{border-color:var(--vx-bad);}
    .vtp-per{font-size:14px;color:var(--vx-text-2);}
    .vtp-slider{width:100%;accent-color:var(--vx-accent);margin:4px 0 2px;}
    .vtp-range{display:flex;justify-content:space-between;font-size:12px;color:var(--vx-text-2);}
    .vtp-msg{min-height:18px;font-size:12.5px;color:var(--vx-bad);text-align:center;margin-top:6px;}
    .vtp-feats{list-style:none;margin:10px 0 16px;padding:0;font-size:13px;color:var(--vx-text-2);columns:2;column-gap:14px;}
    .vtp-feats li{padding:3px 0 3px 18px;position:relative;break-inside:avoid;}
    .vtp-feats li:before{content:'\\2713';position:absolute;left:0;color:var(--vx-ok);}
    .vtp-choose{width:100%;background:var(--vx-accent);color:var(--vx-accent-ink);border:none;border-radius:var(--vx-r-2);padding:11px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;}
    .vtp-choose:hover{filter:brightness(1.08);}
    .vtp-choose:disabled{opacity:0.5;cursor:default;filter:none;}
    .vtp-foot{display:flex;justify-content:center;gap:10px;padding:12px 18px 18px;}
    .vtp-notnow{background:none;border:1px solid rgba(255,255,255,0.18);color:var(--vx-text-2);border-radius:var(--vx-r-2);padding:8px 22px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;}
    .vtp-notnow:hover{color:var(--vx-text);border-color:rgba(255,255,255,0.35);}`;
  document.head.appendChild(s);
}

/*
 * The pay-what-you-want picker: a slider for quick picks and a box for an
 * exact amount, kept in step. The slider moves in 50-cent steps from the
 * minimum ($2.99, $3.49 … $10.99); the box takes any cent in the range. The
 * server checks the range again, so this is for the user, not for safety.
 *
 * Two jobs, one dialog. A free user picks an amount and goes to Checkout. A
 * subscriber (state.hasSubscription) gets it as "Your Pro plan": it opens on
 * what they pay now, changes the amount in place (POST /api/billing/amount,
 * from the next bill), and links to Stripe's portal for card, invoices and
 * cancelling.
 */
function openTierPicker() {
  const plan = state && state.billingConfigured && state.plan;
  if (!plan) { toast('Upgrades are not available right now.', 'warn'); return; }
  const changing = !!state.hasSubscription;
  const current = changing && state.amount ? state.amount : null;
  const start = current != null ? Math.min(plan.max, Math.max(plan.min, current)) : plan.default;

  ensurePickerStyles();
  const old = document.getElementById('vortexTierPicker');
  if (old) old.remove();

  const range = `${dollars(plan.min)} to ${dollars(plan.max)}`;
  const title = changing ? 'Your Pro plan' : 'Upgrade to Pro';
  const lede = !changing
    ? `Pay what you want, from ${range} a ${plan.interval}. Every amount unlocks every Pro feature.`
    : (current != null ? `You pay ${dollars(current)} a ${plan.interval}. ` : '')
      + `Choose a new amount from ${range}. It starts with your next bill, and nothing is charged today.`;
  const foot = changing
    ? '<button class="vtp-notnow vtp-portal">Billing &amp; cancel</button><button class="vtp-notnow vtp-close">Close</button>'
    : '<button class="vtp-notnow vtp-close">Not now</button>';

  const overlay = document.createElement('div');
  overlay.id = 'vortexTierPicker';
  overlay.innerHTML = `<div class="vtp-panel" role="dialog" aria-label="${title}">
      <div class="vtp-head"><span>${title}</span><button class="vtp-x vtp-close" aria-label="Close">&times;</button></div>
      <div class="vtp-body">
        <p class="vtp-lede">${lede}</p>
        <div class="vtp-amount">
          <span class="vtp-cur">$</span>
          <input id="vtpAmount" type="number" inputmode="decimal" min="${plan.min / 100}" max="${plan.max / 100}" step="0.01" value="${(start / 100).toFixed(2)}" aria-label="Monthly amount in dollars">
          <span class="vtp-per">/ ${plan.interval}</span>
        </div>
        <input id="vtpSlider" class="vtp-slider" type="range" min="${plan.min}" max="${plan.max}" step="50" value="${start}" aria-label="Monthly amount">
        <div class="vtp-range"><span>${dollars(plan.min)}</span><span>${dollars(plan.max)}</span></div>
        <div class="vtp-msg" id="vtpMsg"></div>
        ${changing ? '' : `<ul class="vtp-feats">${PRO_FEATURES.map((f) => `<li>${f}</li>`).join('')}</ul>`}
        <button class="vtp-choose" id="vtpChoose"></button>
      </div>
      <div class="vtp-foot">${foot}</div>
    </div>`;
  document.body.appendChild(overlay);

  const box = overlay.querySelector('#vtpAmount');
  const slider = overlay.querySelector('#vtpSlider');
  const msg = overlay.querySelector('#vtpMsg');
  const choose = overlay.querySelector('#vtpChoose');

  // Cents from the box, or null when it is not a usable amount.
  const boxCents = () => {
    const v = Math.round(parseFloat(box.value) * 100);
    return Number.isFinite(v) && v >= plan.min && v <= plan.max ? v : null;
  };
  const show = (cents) => {
    const ok = cents != null;
    const same = ok && changing && cents === current;
    box.classList.toggle('vtp-bad', !ok);
    msg.textContent = ok ? '' : `Enter an amount from ${range}.`;
    choose.disabled = !ok || same;
    choose.textContent = !ok ? (changing ? 'Change amount' : 'Subscribe')
      : same ? 'This is what you pay now'
      : changing ? `Change to ${dollars(cents)}/${plan.interval}`
      : `Subscribe for ${dollars(cents)}/${plan.interval}`;
  };

  slider.addEventListener('input', () => {
    box.value = (slider.value / 100).toFixed(2);
    show(+slider.value);
  });
  box.addEventListener('input', () => {
    const c = boxCents();
    if (c != null) slider.value = c;
    show(c);
  });
  // Tidy to two decimals once they leave the box, if it is valid.
  box.addEventListener('change', () => { const c = boxCents(); if (c != null) box.value = (c / 100).toFixed(2); });
  show(start);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay || e.target.classList.contains('vtp-close')) { close(); return; }
    if (e.target.classList.contains('vtp-portal')) { close(); go('portal'); return; }
    if (e.target !== choose) return;
    const cents = boxCents();
    if (cents == null) { show(null); return; }
    choose.disabled = true;
    if (!changing) {
      choose.textContent = 'Opening checkout…';
      go('checkout', { amount: cents }).finally(() => { if (overlay.isConnected) show(boxCents()); });
      return;
    }
    choose.textContent = 'Saving…';
    if (await changeAmount(cents)) close();
    else if (overlay.isConnected) show(boxCents());
  });
}

// Subscriber changes their monthly amount. True when it worked.
async function changeAmount(cents) {
  try {
    const r = await fetch('/api/billing/amount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: cents }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || 'Could not change your amount.', 'warn'); return false; }
    state.amount = d.amount;
    toast(`Done. You will pay ${dollars(d.amount)} a month from your next bill.`, 'good');
    return true;
  } catch (e) {
    toast('Network error changing your amount.', 'warn');
    return false;
  }
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

  // A paying subscriber: their plan dialog (change amount, or Stripe's portal
  // for card, invoices and cancelling).
  if (state.hasSubscription) {
    rw.style.display = '';
    if (label()) label().textContent = 'Manage Subscription';
    rw.dataset.action = 'manage';
    return;
  }

  // Pro without paying (admin role or an admin grant): nothing to manage in
  // Stripe, and they must never be prompted to upgrade, so hide the row.
  // Someone who subscribed and then cancelled is neither, so they fall
  // through to Upgrade and can subscribe again.
  if (state.isPro || state.isAdmin || (state.tierLevel || 0) >= 1) {
    rw.style.display = 'none';
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
      const menu = $('vortexRadarMenu');
      if (menu) menu.style.display = 'none';
      const action = rw.dataset.action || 'checkout';
      // Free user picks an amount; a subscriber gets the same dialog as
      // "Your Pro plan" (openTierPicker tells them apart).
      if (action === 'checkout' || action === 'manage') openTierPicker();
      else go(action);
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
