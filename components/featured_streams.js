/*
 * components/featured_streams.js
 * A hardcoded list of the admin team's live streams ("Featured Streams"), shown
 * in a panel and watched *inside* the app.
 *
 * Watching opens the shared floating player (components/stream_player.js): a
 * small draggable card over the map, not a full-screen modal — so radar stays
 * visible while the stream plays.
 *
 *  • YouTube — embeds the live video. A /@handle/live link is resolved to the
 *    current live video id through the app's /api/proxy (youtube is allow-listed).
 *  • TikTok  — the live embed is attempted in-app; TikTok often refuses to be
 *    framed, so the card offers "Open on TikTok" if nothing plays.
 *
 * GPS follow: give an entry a `spotter` id/callsign and the map follows that
 * person's live Spotter Network position while you watch (the player polls
 * /api/spotters/positions and pans the map, until you move the map by hand).
 * Leave it '' for a streamer who isn't on Spotter Network — the stream still
 * plays, there's just nothing to follow. To look someone up, run this in the
 * browser console while signed in:
 *
 *     VortexStreamPlayer.findSpotter('country boy')   // or a callsign / id
 *
 * Add/remove entries in FEATURED below. ES module, loaded via <script type=module>.
 */

import { openMiniPlayer, trackedPosition } from './stream_player.js';

const FEATURED = [
  // spotter: Spotter Network identifier to follow on the map — the numeric spotter
  // id, the callsign, the ham call, or the spotter's real name all match.
  // Both entries below are the same person streaming from two accounts, so they
  // share one Spotter Network id and the map follows the same position for either.
  { name: 'West GA Country Boy', platform: 'tiktok',  url: 'https://www.tiktok.com/@westgacountryboy/live', spotter: '23412' },
  { name: 'TCLM',                platform: 'youtube', url: 'https://www.youtube.com/@TCLM1/live',           spotter: '23412' },
];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function injectStyles() {
  if (document.getElementById('vfs-styles')) return;
  const s = document.createElement('style');
  s.id = 'vfs-styles';
  s.textContent = `
  #vfsPanel{position:fixed;right:12px;top:64px;z-index:100060;width:min(300px,86vw);
    background:var(--vx-surface);border:1px solid rgba(255,255,255,.10);border-radius:var(--vx-r-3);
    box-shadow:var(--vx-shadow-lg);font-family:var(--vx-font);overflow:hidden}
  .vfs-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;
    border-bottom:1px solid rgba(255,255,255,.07);font-weight:800;font-size:15px;color:var(--vx-text)}
  .vfs-x{background:none;border:none;color:var(--vx-text-2);font-size:20px;cursor:pointer;line-height:1}
  .vfs-x:hover{color:#fff}
  .vfs-row{display:flex;align-items:center;gap:11px;padding:11px 14px;cursor:pointer;
    border-bottom:1px solid rgba(255,255,255,.05)}
  .vfs-row:last-child{border-bottom:none}
  .vfs-row:hover{background:rgba(255,255,255,.06)}
  .vfs-ico{width:34px;height:34px;border-radius:var(--vx-r-2);flex:0 0 auto;display:flex;align-items:center;justify-content:center;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--vx-text);font-size:14px;font-weight:800}
  .vfs-info{min-width:0;flex:1}
  .vfs-nm{font-size:14px;font-weight:700;color:var(--vx-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .vfs-plat{font-size:11.5px;color:var(--vx-text-2);text-transform:capitalize;display:flex;align-items:center;gap:6px}
  .vfs-gps{color:var(--vx-ok);font-weight:700;text-transform:none}
  .vfs-watch{font-size:11px;font-weight:800;color:var(--vx-accent-ink);background:var(--vx-accent);border-radius:var(--vx-r-2);padding:5px 10px;flex:0 0 auto}
  `;
  document.head.appendChild(s);
}

function platformIcon(p) {
  return p === 'tiktok' ? 'TT' : p === 'youtube' ? 'YT' : p === 'twitch' ? 'TW' : p === 'kick' ? 'KK' : '●';
}

function trackFor(s) {
  return s.spotter ? { kind: 'spotter', callsign: s.spotter } : null;
}

function openStream(s) {
  openMiniPlayer({ url: s.url, name: s.name, platform: s.platform, track: trackFor(s) });
}

// Mark the rows whose streamer currently has a live Spotter Network position,
// so it's obvious before you click which ones the map can follow.
async function markGpsRows(panel) {
  await Promise.all(FEATURED.map(async (s, i) => {
    const track = trackFor(s);
    if (!track) return;
    const fix = await trackedPosition(track);
    if (!fix || !panel.isConnected) return;
    const el = panel.querySelector(`.vfs-row[data-i="${i}"] .vfs-plat`);
    if (el && !el.querySelector('.vfs-gps')) {
      const tag = document.createElement('span');
      tag.className = 'vfs-gps';
      tag.textContent = '· GPS';
      tag.title = 'Live position available — the map will follow this streamer';
      el.appendChild(tag);
    }
  }));
}

// ── list panel ──
function togglePanel() {
  const existing = document.getElementById('vfsPanel');
  if (existing) { existing.remove(); return; }
  injectStyles();
  const p = document.createElement('div');
  p.id = 'vfsPanel';
  p.innerHTML = `
    <div class="vfs-head"><span>Featured Streams</span><button class="vfs-x" aria-label="Close">×</button></div>
    ${FEATURED.map((s, i) => `
      <div class="vfs-row" data-i="${i}">
        <div class="vfs-ico">${platformIcon(s.platform)}</div>
        <div class="vfs-info"><div class="vfs-nm">${esc(s.name)}</div><div class="vfs-plat"><span>${esc(s.platform)}</span></div></div>
        <span class="vfs-watch">Watch</span>
      </div>`).join('')}`;
  document.body.appendChild(p);
  p.querySelector('.vfs-x').onclick = () => p.remove();
  p.querySelectorAll('.vfs-row').forEach((row) => {
    row.onclick = () => { const s = FEATURED[+row.getAttribute('data-i')]; if (s) openStream(s); };
  });
  markGpsRows(p);
}

function init() {
  injectStyles();
  const btn = document.getElementById('vortexFeaturedBtn');
  if (btn) btn.addEventListener('click', togglePanel);
  window.VortexFeatured = { open: togglePanel, list: FEATURED, watch: openStream };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
