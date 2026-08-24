/*
 * storm_alerts.js
 * Fires location-impact alerts as new radar volumes come in. On each storm-track
 * plot the tracker compares every cell's projected path against the user's live
 * GPS and announces meaningful transitions:
 *   - a tracked storm now arriving soon
 *   - its path shifting closer
 *   - a storm that's no longer expected to impact you
 * State is kept per cell so we alert on change, not every refresh (no spam).
 * Only runs when a GPS fix is already cached — it never prompts on its own.
 */

const { computeImpact } = require('./storm_impact');
const userLoc = require('../../../../core/map/user_location');

const state = {}; // cellID -> { intersecting, closest, arriveBucket, ts }

function toast(msg, kind) {
    if (!document.getElementById('storm-alert-styles')) {
        const s = document.createElement('style');
        s.id = 'storm-alert-styles';
        s.textContent = `
        .storm-alert-toast{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:100070;
          max-width:88vw;background:rgba(11,18,32,.98);color:#e5edff;border-radius:12px;padding:11px 16px;
          font-family:'Onest',system-ui,sans-serif;font-size:13.5px;line-height:1.4;text-align:center;
          box-shadow:0 12px 34px rgba(0,0,0,.55);border:1px solid #27324a}
        .storm-alert-toast.warn{border-color:var(--vx-warn)}.storm-alert-toast.info{border-color:var(--vx-accent)}`;
        document.head.appendChild(s);
    }
    const el = document.createElement('div');
    el.className = 'storm-alert-toast ' + (kind || 'info');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 8000);
}

// cells: [{ id, path, times, speedMph, motionText, cell }]
function evaluate(cells) {
    const loc = userLoc.get();
    if (!loc || !Array.isArray(cells)) return; // never prompt; only alert if we know where they are
    const now = Date.now();
    const seen = new Set();

    for (const c of cells) {
        if (!c || c.speedMph < 1 || !c.path || c.path.length < 2) continue;
        let r;
        try { r = computeImpact({ path: c.path, times: c.times, speedMph: c.speedMph, motionText: c.motionText, user: [loc.lng, loc.lat], cell: c.cell, now }); }
        catch (e) { continue; }
        seen.add(c.id);
        const prev = state[c.id] || {};

        // Arriving soon (bucketed so we alert at ~15 / ~10 / ~5 min, once each).
        if (r.intersects && r.etaMin != null && r.etaMin <= 15) {
            const bucket = r.etaMin <= 5 ? 5 : (r.etaMin <= 10 ? 10 : 15);
            if (prev.arriveBucket !== bucket) {
                const core = r.phases && r.phases.core ? ` — core around ${r.phases.core.clock}` : '';
                toast(`⚠️ Tracked storm arriving at your location in ~${r.etaMin} min${core}.`, 'warn');
                prev.arriveBucket = bucket;
            }
        } else {
            prev.arriveBucket = null;
        }

        // Stopped being a direct-impact threat.
        if (prev.intersecting && !r.intersects) {
            toast('Storm no longer expected to directly impact your location.', 'info');
        }

        // Path shifted meaningfully closer (still a near-miss, but worth flagging).
        if (!r.intersects && typeof prev.closest === 'number' && r.closestApproachMiles != null &&
            (prev.closest - r.closestApproachMiles) > 4 && r.trend === 'closer') {
            toast(`Tracked storm path shifted closer to your location (${r.closestApproachMiles.toFixed(1)} mi at ${r.closestApproachClock}).`, 'warn');
        }

        prev.intersecting = r.intersects;
        prev.closest = r.closestApproachMiles;
        prev.ts = now;
        state[c.id] = prev;
    }

    // Forget cells we haven't seen for a while.
    for (const id of Object.keys(state)) {
        if (!seen.has(id) && now - (state[id].ts || 0) > 15 * 60000) delete state[id];
    }
}

module.exports = { evaluate };
