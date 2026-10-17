/*
 * parse/fetch.js
 * Fetches the latest NEXRAD Level-II volume for a station. Goes through the
 * Vortex Radar server proxy (/api/level2/latest) which lists + downloads from
 * the NOAA S3 bucket server-side — this avoids browser CORS and anonymous-list
 * issues. Returns the raw bytes for the 3D storm worker to parse.
 */

export async function loadLatestL2RadarFile(station) {
    if (!station) throw new Error('No station selected.');
    const res = await fetch('/api/level2/latest?station=' + encodeURIComponent(station), { cache: 'no-store' });
    if (!res.ok) {
        let msg = 'Failed to download Level-II data (' + res.status + ').';
        let body = null;
        try { body = await res.json(); msg = body.error || msg; } catch {}
        const err = new Error(msg);
        err.status = res.status;                      // 402 = needs a higher tier
        err.requiredTier = body && body.requiredTier;
        throw err;
    }
    const data = new Uint8Array(await res.arrayBuffer());
    if (!data.length) throw new Error('Empty Level-II response.');
    return { data };
}
