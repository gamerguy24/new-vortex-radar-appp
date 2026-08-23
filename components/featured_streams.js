/*
 * components/featured_streams.js
 * A hardcoded list of the admin team's live streams ("Featured Streams"), shown
 * in a panel and watchable in-app where the platform allows embedding.
 *
 *  • YouTube — embeds the live video. A /@handle/live link is resolved to the
 *    current live video id through the app's /api/proxy (youtube is allow-listed).
 *  • TikTok  — TikTok blocks embedding live, so it opens on TikTok in a new tab.
 *
 * Add/remove entries in FEATURED below. ES module, loaded via <script type=module>.
 */

const FEATURED = [
  { name: 'West GA Country Boy', platform: 'tiktok',  url: 'https://www.tiktok.com/@westgacountryboy/live' },
  { name: 'TCLM',                platform: 'youtube', url: 'https://www.youtube.com/@TCLM1/live' },
];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function injectStyles() {
  if (document.getElementById('vfs-styles')) return;
  const s = document.createElement('style');
  s.id = 'vfs-styles';
  s.textContent = `
  #vfsPanel{position:fixed;right:12px;top:64px;z-index:100060;width:min(300px,86vw);
    background:rgba(15,17,21,.97);border:1px solid rgba(255,255,255,.10);border-radius:14px;
    box-shadow:0 20px 60px rgba(0,0,0,.6);font-family:'Onest',system-ui,sans-serif;overflow:hidden}
  .vfs-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;
    border-bottom:1px solid rgba(255,255,255,.07);font-weight:800;font-size:15px;color:#eaf1fb}
  .vfs-x{background:none;border:none;color:#93a3b8;font-size:20px;cursor:pointer;line-height:1}
  .vfs-x:hover{color:#fff}
  .vfs-row{display:flex;align-items:center;gap:11px;padding:11px 14px;cursor:pointer;
    border-bottom:1px solid rgba(255,255,255,.05)}
  .vfs-row:last-child{border-bottom:none}
  .vfs-row:hover{background:rgba(255,255,255,.06)}
  .vfs-ico{width:34px;height:34px;border-radius:9px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#cfe0f5;font-size:14px;font-weight:800}
  .vfs-info{min-width:0;flex:1}
  .vfs-nm{font-size:14px;font-weight:700;color:#eaf1fb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .vfs-plat{font-size:11.5px;color:#93a3b8;text-transform:capitalize}
  .vfs-watch{font-size:11px;font-weight:800;color:#04121e;background:#27beff;border-radius:7px;padding:5px 10px;flex:0 0 auto}
  /* player */
  #vfsPlayer{position:fixed;inset:0;background:rgba(2,5,12,.85);z-index:100075;display:flex;
    align-items:center;justify-content:center;padding:18px;font-family:'Onest',system-ui,sans-serif}
  .vfs-pcard{width:min(960px,96vw);background:#0b1220;border:1px solid #1e2a44;border-radius:14px;overflow:hidden;
    box-shadow:0 24px 70px rgba(0,0,0,.7)}
  .vfs-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #1a2540}
  .vfs-ptitle{font-weight:800;font-size:15px;color:#fff;display:flex;align-items:center;gap:9px}
  .vfs-pdot{width:9px;height:9px;border-radius:50%;background:#ff3b30}
  .vfs-pactions{display:flex;align-items:center;gap:14px}
  .vfs-pext{color:#27beff;font-size:13px;font-weight:700;text-decoration:none}
  .vfs-px{background:none;border:none;color:#93a3b8;font-size:24px;cursor:pointer;line-height:1}
  .vfs-pstage{position:relative;width:100%;aspect-ratio:16/9;background:#000}
  .vfs-pstage>iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  .vfs-fallback{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;
    text-align:center;color:#cbd5e1;font-size:14px;padding:20px}
  .vfs-fallback a{background:#27beff;color:#04121e;font-weight:800;text-decoration:none;padding:10px 18px;border-radius:9px}
  `;
  document.head.appendChild(s);
}

function platformIcon(p) {
  return p === 'tiktok' ? 'TT' : p === 'youtube' ? 'YT' : p === 'twitch' ? 'TW' : '●';
}

// ── in-app player ──
function closePlayer() { const el = document.getElementById('vfsPlayer'); if (el) el.remove(); }

async function resolveYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(?:live|embed|shorts)\/([\w-]{6,})/);
    if (m) return m[1];
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0];
    // /@handle/live or /channel/xxx/live → resolve the current live video id via proxy
    const r = await fetch('/api/proxy?url=' + url, { credentials: 'same-origin' });
    const html = await r.text();
    const mm = html.match(/"videoId":"([\w-]{11})"/);
    if (mm) return mm[1];
  } catch (e) {}
  return null;
}

async function openPlayer(stream) {
  injectStyles();
  closePlayer();
  const wrap = document.createElement('div');
  wrap.id = 'vfsPlayer';
  wrap.innerHTML = `
    <div class="vfs-pcard">
      <div class="vfs-phead">
        <div class="vfs-ptitle"><span class="vfs-pdot"></span> ${esc(stream.name)}</div>
        <div class="vfs-pactions">
          <a class="vfs-pext" href="${esc(stream.url)}" target="_blank" rel="noopener">Open ↗</a>
          <button class="vfs-px" id="vfs-pclose" aria-label="Close">×</button>
        </div>
      </div>
      <div class="vfs-pstage" id="vfs-pstage">
        <div class="vfs-fallback">Loading…</div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#vfs-pclose').onclick = closePlayer;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closePlayer(); });
  document.addEventListener('keydown', function esc2(ev) { if (ev.key === 'Escape') { closePlayer(); document.removeEventListener('keydown', esc2); } });

  const stage = wrap.querySelector('#vfs-pstage');
  const externalFallback = (msg) => {
    stage.innerHTML = `<div class="vfs-fallback">${esc(msg)}<a href="${esc(stream.url)}" target="_blank" rel="noopener">Watch on ${esc(cap(stream.platform))} ↗</a></div>`;
  };

  if (stream.platform === 'youtube') {
    const id = await resolveYouTubeId(stream.url);
    if (id) {
      stage.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    } else {
      externalFallback("This channel isn't live right now (or the live video couldn't be found).");
    }
  } else if (stream.platform === 'tiktok') {
    // TikTok blocks embedding live streams.
    externalFallback('TikTok Live opens on TikTok.');
  } else {
    externalFallback('');
  }
}
function cap(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

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
        <div class="vfs-info"><div class="vfs-nm">${esc(s.name)}</div><div class="vfs-plat">${esc(s.platform)}</div></div>
        <span class="vfs-watch">Watch</span>
      </div>`).join('')}`;
  document.body.appendChild(p);
  p.querySelector('.vfs-x').onclick = () => p.remove();
  p.querySelectorAll('.vfs-row').forEach((row) => {
    row.onclick = () => { const s = FEATURED[+row.getAttribute('data-i')]; if (s) openPlayer(s); };
  });
}

function init() {
  injectStyles();
  const btn = document.getElementById('vortexFeaturedBtn');
  if (btn) btn.addEventListener('click', togglePanel);
  window.VortexFeatured = { open: togglePanel, list: FEATURED };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
