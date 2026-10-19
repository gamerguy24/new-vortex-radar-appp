/*
 * components/beacon_streams.js
 * Spotter Network beacons that have a live stream to go with them.
 *
 * Each entry pairs a person's Spotter Network beacon with the stream they run
 * while chasing. With the Spotters layer on, their beacon gets a "Watch live"
 * button, and when the beacon comes on the mini player opens on its own and
 * follows them; when the beacon goes off it stops following
 * (components/spotters.js does the watching, stream_player.js the playing).
 *
 *   spotter   how they appear on Spotter Network: real name, callsign, ham
 *             call or numeric id (matched the same way stream_player.js does)
 *   name      label for the player and the marker
 *   url       the stream; leave '' until there is one and the entry is ignored
 *   platform  shown on the "Open on …" link
 *
 * To find the exact Spotter Network name, open the console with the Spotters
 * layer on:  VortexStreamPlayer.findSpotter('pisani')
 */
export const BEACON_STREAMS = [
    // Joseph Pisani streams on the Extreme Weather Videos YouTube channel.
    { spotter: 'Joseph Pisani', name: 'Extreme Weather Videos', url: 'https://www.youtube.com/@Extremeweathervideos/live', platform: 'YouTube' },
    // Nathan Bradley streams on TikTok as West GA Country Boy.
    { spotter: 'Nathan Bradley', name: 'West GA Country Boy', url: 'https://www.tiktok.com/@westgacountryboy/live', platform: 'TikTok' },
];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The stream entry for a Spotter Network position row, or null. */
export function beaconStreamFor(pos) {
    if (!pos) return null;
    const ids = [pos.id, pos.spotter_id, pos.callsign, pos.ham, String(pos.first || '') + String(pos.last || '')].map(norm).filter(Boolean);
    return BEACON_STREAMS.find((b) => b.url && ids.includes(norm(b.spotter))) || null;
}

/** The stream entry whose stream is this URL (Featured Streams rows), or null. */
export function beaconStreamForUrl(url) {
    const key = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^(www|m)\./, '') + x.pathname.replace(/\/live\/?$/, '').replace(/\/$/, '')).toLowerCase(); } catch { return ''; } };
    const k = key(url);
    return k ? BEACON_STREAMS.find((b) => b.url && key(b.url) === k) || null : null;
}

/** The follow source stream_player.js expects for an entry. */
export const beaconTrack = (b) => ({ kind: 'spotter', callsign: b.spotter });
