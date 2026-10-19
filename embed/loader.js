/*
 * Echo Radar WX embed loader — served as https://api.echoradarwx.com/embed.js
 *
 *   <div data-echoradar data-lat="33.75" data-lon="-84.39" data-zoom="7"></div>
 *   <script src="https://api.echoradarwx.com/embed.js" async></script>
 *
 * Turns every [data-echoradar] element into the live radar (an iframe of
 * /embed). Settings: data-lat, data-lon, data-zoom, data-style
 * (dark|light|satellite), data-warnings, data-legend, data-controls,
 * data-interactive (1/0), data-height (CSS length, default 450px).
 * Plain JavaScript, no dependencies; safe to include more than once.
 */
(function () {
    var me = document.currentScript;
    var origin = 'https://api.echoradarwx.com';
    try { if (me && me.src) origin = new URL(me.src).origin; } catch (e) { /* keep default */ }
    var KEYS = ['lat', 'lon', 'zoom', 'style', 'warnings', 'legend', 'controls', 'interactive'];

    function mount(el) {
        if (el.getAttribute('data-echoradar-ready')) return;
        el.setAttribute('data-echoradar-ready', '1');
        var params = [];
        for (var i = 0; i < KEYS.length; i++) {
            var v = el.getAttribute('data-' + KEYS[i]);
            if (v != null && v !== '') params.push(KEYS[i] + '=' + encodeURIComponent(v));
        }
        var f = document.createElement('iframe');
        f.src = origin + '/embed' + (params.length ? '?' + params.join('&') : '');
        f.title = 'Live weather radar by Echo Radar WX';
        f.loading = 'lazy';
        f.allow = 'fullscreen';
        f.setAttribute('allowfullscreen', '');
        f.style.cssText = 'display:block;width:100%;border:0;border-radius:8px;height:' + (el.getAttribute('data-height') || '450px');
        el.innerHTML = '';
        el.appendChild(f);
    }

    function run() {
        var els = document.querySelectorAll('[data-echoradar]');
        for (var i = 0; i < els.length; i++) mount(els[i]);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
})();
