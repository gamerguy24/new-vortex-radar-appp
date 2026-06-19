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
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
    }
    const data = new Uint8Array(await res.arrayBuffer());
    if (!data.length) throw new Error('Empty Level-II response.');
    return { data };
}
