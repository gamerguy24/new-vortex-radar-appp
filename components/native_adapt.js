/*
 * components/native_adapt.js
 * Makes the web app behave correctly inside the Capacitor native shell
 * (VortexRadarMobile). No-op in a normal browser — every change is guarded by
 * Capacitor.isNativePlatform(). Fixes:
 *   - window.open(): a WebView can't spawn tabs. Same-origin URLs (e.g. the
 *     Graphics Studio) navigate in-place; external URLs (Stripe etc.) open in an
 *     in-app Custom Tab via @capacitor/browser.
 *   - Hardware back button: walk WebView history, exit at the root.
 *   - Tags <html class="capacitor"> so CSS can adapt (e.g. safe-area insets).
 */

function cap() {
  const C = window.Capacitor;
  return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) ? C : null;
}

function init() {
  const C = cap();
  if (!C) return; // browser — leave everything untouched
  document.documentElement.classList.add('capacitor');

  // ---- window.open → in-app ----
  const origOpen = window.open ? window.open.bind(window) : null;
  window.open = function (url, target, features) {
    try {
      const u = new URL(url, location.href);
      if (u.origin === location.origin) { location.assign(u.href); return null; }
      const Browser = C.Plugins && C.Plugins.Browser;
      if (Browser) { Browser.open({ url: u.href }); return null; }
    } catch (e) { /* fall through */ }
    return origOpen ? origOpen(url, target, features) : null;
  };

  // ---- hardware back button ----
  const App = C.Plugins && C.Plugins.App;
  if (App && App.addListener) {
    App.addListener('backButton', () => {
      if (window.history.length > 1) window.history.back();
      else if (App.exitApp) App.exitApp();
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
