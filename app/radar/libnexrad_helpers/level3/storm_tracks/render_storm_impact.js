/*
 * render_storm_impact.js
 * Renders the "📍 My Location Impact" section inside a storm-cell popup and
 * keeps it live while the popup is open. Pure presentation over storm_impact's
 * pure math + user_location's cached GPS.
 */

const { computeImpact } = require('./storm_impact');
const userLoc = require('../../../../core/map/user_location');

function injectStyles() {
    if (document.getElementById('storm-impact-styles')) return;
    const s = document.createElement('style');
    s.id = 'storm-impact-styles';
    s.textContent = `
    .storm-impact{margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.18)}
    .si-title{font-weight:800;margin-bottom:5px}
    .si-row{display:flex;justify-content:space-between;gap:14px;font-size:12.5px;line-height:1.55}
    .si-row span{opacity:.8}
    .si-row b{white-space:nowrap}
    .si-phases{margin-top:6px;padding-top:5px;border-top:1px dashed rgba(255,255,255,.18)}
    .si-phases-title{font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.7;margin-bottom:2px}
    .si-msg{margin-top:6px;font-size:12px;opacity:.9;font-style:italic}
    .si-conf-high{color:#34d399}.si-conf-medium{color:#facc15}.si-conf-low{color:#f8a4a4}`;
    document.head.appendChild(s);
}

const mi = (m) => (typeof m === 'number' ? m.toFixed(1) : '—');

function impactHTML(r) {
    const head = '<div class="si-title">📍 My Location Impact</div>';
    if (!r) return `<div class="storm-impact">${head}</div>`;

    // No motion, or a miss: distance + motion + explanation.
    if (!r.intersects) {
        let h = `<div class="storm-impact">${head}` +
            `<div class="si-row"><span>Distance from Me</span><b>${mi(r.distanceMiles)} mi</b></div>`;
        if (r.motionText) h += `<div class="si-row"><span>Storm Motion</span><b>${r.motionText}</b></div>`;
        if (r.closestApproachMiles != null && r.trend !== 'stationary') {
            h += `<div class="si-row"><span>Closest Approach</span><b>${mi(r.closestApproachMiles)} mi · ${r.closestApproachClock}</b></div>`;
        }
        h += `<div class="si-msg">${r.message || ''}</div></div>`;
        return h;
    }

    const trendTxt = r.trend === 'closer' ? 'Moving closer' : (r.trend === 'farther' ? 'Moving away' : 'Steady');
    let h = `<div class="storm-impact">${head}` +
        `<div class="si-row"><span>Storm ETA to My Location</span><b>${r.etaMin != null ? r.etaMin + ' min' : '—'}</b></div>` +
        `<div class="si-row"><span>Estimated Arrival Time</span><b>${r.arrivalClock || '—'} local</b></div>` +
        `<div class="si-row"><span>Distance from Me</span><b>${mi(r.distanceMiles)} mi</b></div>` +
        `<div class="si-row"><span>Storm Motion</span><b>${r.motionText || '—'}</b></div>` +
        `<div class="si-row"><span>Impact Type</span><b>${r.impactType}</b></div>` +
        `<div class="si-row"><span>Confidence</span><b class="si-conf-${r.confidence.toLowerCase()}">${r.confidence}</b></div>` +
        `<div class="si-row"><span>Trend</span><b>${trendTxt}</b></div>`;

    const ph = r.phases || {};
    const rows = [];
    if (ph.rain) rows.push(['Rain arrival', ph.rain.clock]);
    if (ph.core) rows.push(['Core arrival', ph.core.clock]);
    if (ph.strongest) rows.push(['Strongest impact', ph.strongest.clock]);
    if (ph.exit) rows.push(['Storm exit', ph.exit.clock]);
    if (rows.length) {
        h += `<div class="si-phases"><div class="si-phases-title">Estimated phases</div>` +
            rows.map(([k, v]) => `<div class="si-row"><span>${k}</span><b>${v}</b></div>`).join('') + `</div>`;
    }
    h += `</div>`;
    return h;
}

/**
 * @param {string} targetId  id of the placeholder element inside the popup
 * @param {Object} params    { path, times, speedMph, motionText, cell }
 * @param {Function} onUpdate called after content changes (reposition the popup)
 */
function render(targetId, params, onUpdate) {
    injectStyles();
    const el = () => document.getElementById(targetId);
    const set = (html) => { const n = el(); if (n) { n.innerHTML = html; if (onUpdate) onUpdate(); } };

    function compute(loc) {
        const r = computeImpact({
            path: params.path, times: params.times, speedMph: params.speedMph,
            motionText: params.motionText, user: [loc.lng, loc.lat], cell: params.cell,
        });
        set(impactHTML(r));
    }

    set(`<div class="storm-impact"><div class="si-title">📍 My Location Impact</div><div class="si-msg">Getting your location…</div></div>`);
    userLoc.ensure((err, loc) => {
        if (!el()) return;
        if (err || !loc) {
            set(`<div class="storm-impact"><div class="si-title">📍 My Location Impact</div><div class="si-msg">Enable location to see this storm's impact on your position.</div></div>`);
            return;
        }
        compute(loc);
        // Continuously recalc while the popup is open (storm speed/direction and
        // your GPS both move); stop when the popup is gone.
        const iv = setInterval(() => {
            if (!el()) { clearInterval(iv); return; }
            compute(userLoc.get() || loc);
        }, 15000);
    });
}

module.exports = render;
