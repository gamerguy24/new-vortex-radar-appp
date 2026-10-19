/*
 * components/featured_streams.js
 * "Featured Streams": a panel of live streams, watched *inside* the app.
 *
 * Two things live in it:
 *
 *  • A TikTok creator card (FEATURED_CREATOR) — TikTok's own embed, the
 *    blockquote + embed.js pair TikTok hands out. It shows the creator's
 *    profile and recent videos, and is TikTok's widget, so tapping it goes to
 *    TikTok.
 *
 *  • Everyone an admin has approved to stream, from /api/featured-streams.
 *    Approving someone in the admin panel is what puts them here; revoking
 *    takes them off. Each channel link they gave when they applied is a row,
 *    named by its handle. Live streamers (broadcasting through the Chase
 *    Stream Hub) sort first, are marked LIVE, and the map follows them while
 *    you watch.
 *
 * Watching opens the shared floating player (components/stream_player.js): a
 * small draggable card over the map, not a full-screen modal — so radar stays
 * visible while the stream plays. YouTube /@handle/live links resolve through
 * the app's /api/proxy; TikTok often refuses to be framed, so the card offers
 * "Open on TikTok" if nothing plays.
 *
 * ES module, loaded via <script type=module>.
 */

import { openMiniPlayer, trackedPosition } from './stream_player.js?v=beacon2';
import { BEACON_STREAMS, beaconStreamForUrl, beaconTrack } from './beacon_streams.js?v=beacon2';

// The creator card at the top of the panel. Set to null to remove it.
const FEATURED_CREATOR = { handle: 'westgacountryboy' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function injectStyles() {
  if (document.getElementById('vfs-styles')) return;
  const s = document.createElement('style');
  s.id = 'vfs-styles';
  s.textContent = `
  #vfsPanel{position:fixed;right:12px;top:64px;z-index:100060;width:min(340px,92vw);
    max-height:calc(100vh - 140px);display:flex;flex-direction:column;
    background:var(--vx-surface);border:1px solid rgba(255,255,255,.10);border-radius:var(--vx-r-3);
    box-shadow:var(--vx-shadow-lg);font-family:var(--vx-font);overflow:hidden}
  .vfs-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;flex:0 0 auto;
    border-bottom:1px solid rgba(255,255,255,.07);font-weight:800;font-size:15px;color:var(--vx-text)}
  .vfs-body{overflow-y:auto;flex:1 1 auto;min-height:0}
  .vfs-x{background:none;border:none;color:var(--vx-text-2);font-size:20px;cursor:pointer;line-height:1}
  .vfs-x:hover{color:#fff}
  .vfs-sub{padding:10px 14px 4px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--vx-text-3)}
  .vfs-creator{padding:6px 10px 10px;display:flex;justify-content:center;border-bottom:1px solid rgba(255,255,255,.07)}
  .vfs-creator .tiktok-embed{margin:0 !important}
  .vfs-creator a{color:var(--vx-text-2)}
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
  .vfs-live{color:#fff;background:var(--vx-bad,#e5484d);border-radius:var(--vx-r-1);padding:0 5px;font-weight:800;font-size:10px;letter-spacing:.06em;text-transform:uppercase}
  .vfs-watch{font-size:11px;font-weight:800;color:var(--vx-accent-ink);background:var(--vx-accent);border-radius:var(--vx-r-2);padding:5px 10px;flex:0 0 auto}
  .vfs-note{padding:14px;font-size:12.5px;color:var(--vx-text-2);line-height:1.45}
  `;
  document.head.appendChild(s);
}

function platformIcon(p) {
  return p === 'tiktok' ? 'TT' : p === 'youtube' ? 'YT' : p === 'twitch' ? 'TW' : p === 'kick' ? 'KK' : p === 'facebook' ? 'FB' : '●';
}

// A streamer broadcasting through the Chase Stream Hub reports their position
// there, so that is what the player follows. Otherwise, a stream paired with a
// Spotter Network beacon (beacon_streams.js) follows that beacon.
function trackFor(s) {
  if (s.live) return { kind: 'hub', id: s.id };
  const b = beaconStreamForUrl(s.url);
  return b ? beaconTrack(b) : null;
}

function openStream(s) {
  openMiniPlayer({ url: s.url, name: s.name, platform: s.platform, track: trackFor(s) });
}

/*
 * TikTok's creator embed, exactly as TikTok publishes it. embed.js turns every
 * blockquote.tiktok-embed on the page into the widget, but only the ones there
 * when it runs — so it is loaded afresh each time the panel opens.
 */
function creatorHtml(c) {
  const h = esc(c.handle);
  return `
    <div class="vfs-sub">Featured creator</div>
    <div class="vfs-creator">
      <blockquote class="tiktok-embed" cite="https://www.tiktok.com/@${h}" data-unique-id="${h}"
        data-embed-type="creator" style="max-width: 780px; min-width: 288px;">
        <section><a target="_blank" rel="noopener" href="https://www.tiktok.com/@${h}?refer=creator_embed">@${h}</a></section>
      </blockquote>
    </div>`;
}

function loadTikTokEmbed() {
  const old = document.getElementById('vfs-tiktok-embed');
  if (old) old.remove();
  const s = document.createElement('script');
  s.id = 'vfs-tiktok-embed';
  s.async = true;
  s.src = 'https://www.tiktok.com/embed.js';
  document.body.appendChild(s);
}

async function fetchStreams() {
  const r = await fetch('/api/featured-streams', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const list = Array.isArray(d.streams) ? d.streams : [];
  // Beacon streamers (beacon_streams.js) are featured too, even if their
  // channel is not on an approved account here; skip any the server listed.
  for (const b of BEACON_STREAMS) {
    if (!b.url || list.some((s) => beaconStreamForUrl(s.url) === b)) continue;
    list.push({ id: 'beacon:' + b.spotter, name: b.name, platform: String(b.platform || '').toLowerCase(), url: b.url, live: false });
  }
  return list;
}

function rowsHtml(list) {
  if (!list.length) {
    return '<div class="vfs-note">No approved streamers yet. Anyone you approve to stream in the admin panel shows up here.</div>';
  }
  return list.map((s, i) => `
    <div class="vfs-row" data-i="${i}">
      <div class="vfs-ico">${platformIcon(s.platform)}</div>
      <div class="vfs-info"><div class="vfs-nm">${esc(s.name)}</div>
        <div class="vfs-plat"><span>${esc(s.platform)}</span>${s.live ? '<span class="vfs-live">Live</span>' : ''}</div></div>
      <span class="vfs-watch">Watch</span>
    </div>`).join('');
}

// Mark the live rows whose streamer is reporting a position, so it's obvious
// before you click which ones the map can follow.
async function markGpsRows(panel, list) {
  await Promise.all(list.map(async (s, i) => {
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
async function togglePanel() {
  const existing = document.getElementById('vfsPanel');
  if (existing) { existing.remove(); return; }
  injectStyles();
  const p = document.createElement('div');
  p.id = 'vfsPanel';
  p.innerHTML = `
    <div class="vfs-head"><span>Featured Streams</span><button class="vfs-x" aria-label="Close">×</button></div>
    <div class="vfs-body">
      ${FEATURED_CREATOR ? creatorHtml(FEATURED_CREATOR) : ''}
      <div class="vfs-sub">Approved streamers</div>
      <div class="vfs-list"><div class="vfs-note">Loading…</div></div>
    </div>`;
  document.body.appendChild(p);
  p.querySelector('.vfs-x').onclick = () => p.remove();
  if (FEATURED_CREATOR) loadTikTokEmbed();

  const listEl = p.querySelector('.vfs-list');
  let list = [];
  try {
    list = await fetchStreams();
  } catch (e) {
    if (p.isConnected) listEl.innerHTML = '<div class="vfs-note">Could not load streamers. Try again in a moment.</div>';
    return;
  }
  if (!p.isConnected) return;
  listEl.innerHTML = rowsHtml(list);
  listEl.querySelectorAll('.vfs-row').forEach((row) => {
    row.onclick = () => { const s = list[+row.getAttribute('data-i')]; if (s) openStream(s); };
  });
  markGpsRows(p, list);
}

function init() {
  injectStyles();
  const btn = document.getElementById('vortexFeaturedBtn');
  if (btn) btn.addEventListener('click', togglePanel);
  window.VortexFeatured = { open: togglePanel, list: fetchStreams, watch: openStream };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
