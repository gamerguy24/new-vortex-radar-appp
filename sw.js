/*
 * sw.js — the service worker that receives weather alert notifications
 * ────────────────────────────────────────────────────────────────────────────
 * This is the only part of the app that runs when the app is NOT open, which
 * is the entire reason the feature exists: a tornado warning is no use if it
 * needs a tab to be in the foreground.
 *
 * It is kept deliberately small. A service worker intercepts the whole origin
 * and a mistake here can make the site unreachable in a way that survives a
 * reload — so this one does not cache, does not touch fetch, and has no
 * opinion about anything other than notifications. Adding offline caching
 * later is a separate decision with separate risks.
 *
 * MUST be served from the site root. Its scope is the directory it is served
 * from, so at /components/sw.js it could only ever control /components.
 */

/* Take over straight away rather than waiting for every tab to close. An old
   worker that keeps running is how a fixed bug appears not to be fixed. */
self.addEventListener('install', (event) => {
    self.skipWaiting();
});
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

/*
 * A push arrived.
 *
 * The payload is JSON the server built. Anything could in principle be
 * delivered here, so it is parsed defensively: a push that cannot be read
 * still shows something, because a silent push on some platforms costs the
 * site its permission to send any more.
 */
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        try { data = { title: 'Weather alert', body: event.data ? event.data.text() : '' }; }
        catch (e2) { data = {}; }
    }

    const title = data.title || 'Weather alert';
    const options = {
        body: data.body || '',
        icon: '/logo.png',
        badge: '/logo.png',
        /*
         * The tag collapses repeats of the same warning for the same place.
         * Without it, an alert that is updated four times is four
         * notifications for one storm.
         */
        tag: data.tag || 'echo-alert',
        renotify: false,
        requireInteraction: !!data.requireInteraction,
        timestamp: Date.now(),
        data: { url: data.url || '/', event: data.event || null },
    };

    // waitUntil, or the worker may be killed before the notification shows.
    event.waitUntil(self.registration.showNotification(title, options));
});

/*
 * Tapping it should land on the radar, in a tab that already exists where
 * possible — opening a fifth copy of the app is its own small annoyance.
 */
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of all) {
            if ('focus' in client) {
                try { await client.navigate(url); } catch (e) { /* cross-origin or unsupported */ }
                return client.focus();
            }
        }
        return self.clients.openWindow(url);
    })());
});
