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
 *
 * Streamers also link their own beacon: they put their Spotter Network name
 * or callsign in the Chase Stream Hub, and while they stream to Echo Radar's
 * own server (stream_ingest.js) their beacon plays that stream, ahead of any
 * entry in this table. refreshEchoBeacons() fetches who that is.
 */
export const BEACON_STREAMS = [
    // Joseph Pisani streams on the Extreme Weather Videos YouTube channel.
    { spotter: 'Joseph Pisani', name: 'Extreme Weather Videos', url: 'https://www.youtube.com/@Extremeweathervideos/live', platform: 'YouTube' },
    // Nathan Bradley (West GA Country Boy). His TikTok was taken off
    // 2026-10-26: TikTok LIVE will not play inside the app. Kept for his name
    // and beacon key when he streams to Echo Radar's own server.
    { spotter: 'Nathan Bradley', name: 'West GA Country Boy', url: '', platform: '' },
];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Streamers live on Echo Radar's server with a linked beacon, as entries
// shaped like BEACON_STREAMS. A table entry for the same person lends its
// spotter key and name, so following and the marker label stay the same.
let echoBeacons = [];
export async function refreshEchoBeacons() {
    try {
        const r = await fetch('/api/stream/beacons', { cache: 'no-store', credentials: 'same-origin' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        echoBeacons = (j.beacons || []).filter((b) => b && b.spotter && b.watchPath).map((b) => {
            const known = BEACON_STREAMS.find((s) => norm(s.spotter) === norm(b.spotter));
            return {
                spotter: known ? known.spotter : b.spotter,
                name: known ? known.name : b.name,
                url: location.origin + b.watchPath,
                platform: 'Echo Radar',
            };
        });
    } catch (e) {
        console.warn('[beacon-streams] Echo Radar streams unavailable:', e);   // keep the last list
    }
    return echoBeacons;
}

const idsOf = (pos) => [pos.id, pos.spotter_id, pos.callsign, pos.ham, String(pos.first || '') + String(pos.last || '')].map(norm).filter(Boolean);

/** Whether a Spotter Network position row is this spotter (name, callsign, ham call or id). */
export const isSpotter = (pos, spotter) => !!pos && idsOf(pos).includes(norm(spotter));

/** The stream entry for a Spotter Network position row, or null. */
export function beaconStreamFor(pos) {
    if (!pos) return null;
    const ids = idsOf(pos);
    const match = (b) => b.url && ids.includes(norm(b.spotter));
    return echoBeacons.find(match) || BEACON_STREAMS.find(match) || null;
}

/** The stream entry whose stream is this URL (Featured Streams rows), or null. */
export function beaconStreamForUrl(url) {
    const key = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^(www|m)\./, '') + x.pathname.replace(/\/live\/?$/, '').replace(/\/$/, '')).toLowerCase(); } catch { return ''; } };
    const k = key(url);
    return k ? BEACON_STREAMS.find((b) => b.url && key(b.url) === k) || null : null;
}

/** The follow source stream_player.js expects for an entry. */
export const beaconTrack = (b) => ({ kind: 'spotter', callsign: b.spotter });
