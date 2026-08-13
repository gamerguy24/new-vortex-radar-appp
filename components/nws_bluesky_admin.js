/*
 * components/nws_bluesky_admin.js
 * Admin panel section: "Automatic Warning Posts" (NWS → Bluesky).
 *
 * Talks only to the requireAdmin routes in nws_bluesky.js:
 *   GET/POST /admin/nwsx/config · GET /admin/nwsx/log · POST /admin/nwsx/test
 *   GET /admin/nwsx/graphic/:id
 * Renders the master toggle, per-event-type checkboxes, geographic scope editor,
 * a synthetic Test/Preview tool (never posts a real alert), and a recent-activity
 * log. No credentials are ever handled here — the server holds those in env.
 */

export const nwsxAdminStyles = `
.nwsx { display:flex; flex-direction:column; gap:14px; margin-top:8px; }
.nwsx h4 { display:flex; align-items:center; gap:8px; margin:0; font-size:1.05em; }
.nwsx .nwsx-pill { font-size:0.72em; font-weight:700; padding:2px 8px; border-radius:999px; letter-spacing:0.03em; }
.nwsx .pill-on { background:rgba(52,211,153,0.16); color:#34d399; border:1px solid rgba(52,211,153,0.4); }
.nwsx .pill-off { background:rgba(250,204,21,0.14); color:#facc15; border:1px solid rgba(250,204,21,0.4); }
.nwsx-card { background:rgba(0,0,0,0.28); border:1px solid var(--border-color,rgba(255,255,255,0.12)); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:12px; }
.nwsx-row { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.nwsx-row .lbl { font-weight:600; }
.nwsx-row .sub { font-size:0.82em; color:rgba(255,255,255,0.6); }
.nwsx-switch { position:relative; width:44px; height:24px; flex:0 0 auto; }
.nwsx-switch input { opacity:0; width:0; height:0; }
.nwsx-switch span { position:absolute; inset:0; background:rgba(255,255,255,0.18); border-radius:999px; transition:.15s; cursor:pointer; }
.nwsx-switch span:before { content:""; position:absolute; width:18px; height:18px; left:3px; top:3px; background:#fff; border-radius:50%; transition:.15s; }
.nwsx-switch input:checked + span { background:#27beff; }
.nwsx-switch input:checked + span:before { transform:translateX(20px); }
.nwsx-types { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:4px 14px; }
.nwsx-types label { display:flex; align-items:center; gap:8px; font-size:0.9em; padding:2px 0; cursor:pointer; }
.nwsx-scope label { display:block; font-size:0.85em; color:rgba(255,255,255,0.7); margin-bottom:4px; }
.nwsx-scope input { width:100%; padding:8px 10px; background:rgba(0,0,0,0.35); border:1px solid var(--border-color,rgba(255,255,255,0.14)); color:#fff; border-radius:8px; font-family:inherit; font-size:0.9em; }
.nwsx-scope-btns { display:flex; align-items:center; gap:8px; margin-top:6px; flex-wrap:wrap; }
.nwsx-mini { padding:4px 10px !important; font-size:0.8em !important; }
.nwsx-scope .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.nwsx-actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.nwsx-btn { background:rgba(255,255,255,0.08); border:1px solid var(--border-color,rgba(255,255,255,0.16)); color:#fff; border-radius:8px; padding:8px 14px; font-family:inherit; font-size:0.9em; cursor:pointer; }
.nwsx-btn:hover { background:rgba(255,255,255,0.14); }
.nwsx-btn.primary { background:#27beff; color:#04121c; border-color:#27beff; font-weight:700; }
.nwsx-btn.danger { color:#f87171; }
.nwsx-btn:disabled { opacity:0.5; cursor:not-allowed; }
.nwsx-test select, .nwsx-radar-sel { padding:8px 10px; background:rgba(0,0,0,0.35); border:1px solid var(--border-color,rgba(255,255,255,0.14)); color:#fff; border-radius:8px; font-family:inherit; }
.nwsx-preview { display:none; gap:10px; flex-direction:column; }
.nwsx-preview img { width:100%; max-width:640px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); }
.nwsx-preview .txt { font-size:0.9em; background:rgba(0,0,0,0.3); border-radius:8px; padding:8px 10px; color:#cfe0f2; white-space:pre-wrap; }
.nwsx-log { width:100%; border-collapse:collapse; font-size:0.85em; }
.nwsx-log th, .nwsx-log td { text-align:left; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.08); vertical-align:top; }
.nwsx-log th { color:rgba(255,255,255,0.6); font-weight:600; }
.nwsx-status { font-weight:700; font-size:0.9em; }
.st-posted { color:#34d399; } .st-skipped { color:#facc15; } .st-error { color:#f87171; } .st-baseline { color:#9fb0c3; }
.nwsx-note { font-size:0.8em; color:rgba(255,255,255,0.55); }
.nwsx-flash { font-size:0.85em; padding:8px 10px; border-radius:8px; display:none; }
.nwsx-flash.info { background:rgba(39,190,255,0.14); color:#7fd4ff; display:block; }
.nwsx-flash.err { background:rgba(248,113,113,0.14); color:#fca5a5; display:block; }
`;

export function nwsxAdminHTML() {
  return `
  <div class="nwsx" id="nwsx-root">
    <h4><i class="ti ti-brand-bluesky"></i> Automatic Warning Posts
      <span class="nwsx-pill" id="nwsx-bsky-pill">…</span></h4>
    <div class="nwsx-note" id="nwsx-poll-note"></div>
    <div class="nwsx-flash" id="nwsx-flash"></div>

    <div class="nwsx-card">
      <div class="nwsx-row">
        <div><div class="lbl">Enabled</div><div class="sub">Master switch — when off, nothing is posted.</div></div>
        <label class="nwsx-switch"><input type="checkbox" id="nwsx-enabled"><span></span></label>
      </div>
      <div class="nwsx-row">
        <div><div class="lbl">Post significant updates</div><div class="sub">Re-post when a warning's polygon or threat materially changes.</div></div>
        <label class="nwsx-switch"><input type="checkbox" id="nwsx-updates"><span></span></label>
      </div>
      <div class="nwsx-row">
        <div><div class="lbl">Post cancellations</div><div class="sub">Announce when a warning is cancelled early.</div></div>
        <label class="nwsx-switch"><input type="checkbox" id="nwsx-cancels"><span></span></label>
      </div>
      <div class="nwsx-row">
        <div><div class="lbl">Radar product</div><div class="sub">Super-res NEXRAD Level 2 — the same data the main radar uses.</div></div>
        <select id="nwsx-radar" class="nwsx-radar-sel">
          <option value="reflectivity">Base Reflectivity</option>
          <option value="velocity">Base Velocity</option>
        </select>
      </div>
    </div>

    <div class="nwsx-card">
      <div class="lbl">Alert types to post</div>
      <div class="nwsx-types" id="nwsx-types"></div>
    </div>

    <div class="nwsx-card nwsx-scope">
      <div class="lbl">Geographic scope <span class="sub">(leave all blank to cover the entire US)</span></div>
      <div>
        <label>States (USPS codes, comma-separated — e.g. GA, AL, TN)</label>
        <input id="nwsx-states" placeholder="GA, AL, TN">
        <div class="nwsx-scope-btns">
          <button type="button" class="nwsx-btn nwsx-mini" id="nwsx-all-states">All 50 states</button>
          <button type="button" class="nwsx-btn nwsx-mini" id="nwsx-clear-states">Clear</button>
          <span class="nwsx-note" id="nwsx-states-count"></span>
        </div>
      </div>
      <div class="grid">
        <div>
          <label>NWS offices (name contains)</label>
          <input id="nwsx-offices" placeholder="Nashville, Peachtree City">
        </div>
        <div>
          <label>Counties (exact names)</label>
          <input id="nwsx-counties" placeholder="Davidson, Fulton">
        </div>
      </div>
    </div>

    <div class="nwsx-actions">
      <button class="nwsx-btn primary" id="nwsx-save">Save settings</button>
    </div>

    <div class="nwsx-card nwsx-test">
      <div class="lbl">Test &amp; preview <span class="sub">(uses a synthetic alert — never a real warning)</span></div>
      <div class="nwsx-actions">
        <select id="nwsx-sample">
          <option value="tornado">Tornado Warning</option>
          <option value="severe">Severe Thunderstorm Warning</option>
          <option value="flash-flood">Flash Flood Warning</option>
          <option value="update">Tornado Warning (Update)</option>
          <option value="cancellation">Tornado Warning (Cancellation)</option>
        </select>
        <button class="nwsx-btn" id="nwsx-preview-btn">Preview graphic</button>
        <button class="nwsx-btn danger" id="nwsx-testpost-btn">Send test post to Bluesky</button>
      </div>
      <div class="nwsx-preview" id="nwsx-preview">
        <div class="txt" id="nwsx-preview-txt"></div>
        <img id="nwsx-preview-img" alt="Warning graphic preview">
      </div>
    </div>

    <div class="nwsx-card">
      <div class="nwsx-row">
        <div class="lbl">Recent activity</div>
        <button class="nwsx-btn" id="nwsx-log-refresh">Refresh</button>
      </div>
      <div style="overflow-x:auto;">
        <table class="nwsx-log">
          <thead><tr><th>Time</th><th>Event</th><th>Area</th><th>Status</th><th>Graphic</th></tr></thead>
          <tbody id="nwsx-log-rows"><tr><td colspan="5" class="nwsx-note">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>`;
}

export function initNwsxAdmin(root) {
  // Inject styles once.
  if (!document.getElementById('nwsx-admin-styles')) {
    const s = document.createElement('style');
    s.id = 'nwsx-admin-styles';
    s.textContent = nwsxAdminStyles;
    document.head.appendChild(s);
  }

  const $ = (id) => root.querySelector('#' + id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // All 50 US states (USPS). DC/PR are covered too when the field is left blank.
  const ALL_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

  async function api(method, url, body) {
    const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  function flash(msg, kind) {
    const el = $('nwsx-flash');
    el.textContent = msg; el.className = 'nwsx-flash ' + (kind || 'info');
    if (kind !== 'err') setTimeout(() => { el.className = 'nwsx-flash'; }, 4000);
  }

  let catalog = [];

  async function load() {
    let d;
    try { d = await api('GET', '/admin/nwsx/config'); }
    catch (e) { flash('Could not load settings: ' + e.message, 'err'); return; }
    const c = d.config;
    catalog = d.alertTypeCatalog || [];

    const pill = $('nwsx-bsky-pill');
    pill.textContent = d.blueskyConfigured ? `BLUESKY: ${d.blueskyHandle || 'configured'}` : 'BLUESKY: not configured';
    pill.className = 'nwsx-pill ' + (d.blueskyConfigured ? 'pill-on' : 'pill-off');
    $('nwsx-poll-note').textContent =
      `Polls NWS every ${d.pollSeconds}s. ${d.blueskyConfigured ? 'Posting is live.' : 'Detection & graphics run now; posting starts once Bluesky env vars are set.'} Tracking ${d.storeSize} recent alerts.`;

    $('nwsx-enabled').checked = !!c.enabled;
    $('nwsx-updates').checked = !!c.postUpdates;
    $('nwsx-cancels').checked = !!c.postCancellations;
    if ($('nwsx-radar')) $('nwsx-radar').value = c.radarProduct === 'velocity' ? 'velocity' : 'reflectivity';

    const types = $('nwsx-types');
    types.innerHTML = catalog.map((name) =>
      `<label><input type="checkbox" data-type="${esc(name)}" ${c.alertTypes[name] ? 'checked' : ''}>${esc(name)}</label>`
    ).join('');

    $('nwsx-states').value = (c.scope.states || []).join(', ');
    $('nwsx-offices').value = (c.scope.offices || []).join(', ');
    $('nwsx-counties').value = (c.scope.counties || []).join(', ');
    updateStatesCount();

    loadLog();
  }

  function collectConfig() {
    const alertTypes = {};
    root.querySelectorAll('#nwsx-types input[data-type]').forEach((cb) => { alertTypes[cb.dataset.type] = cb.checked; });
    const splitList = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
    return {
      enabled: $('nwsx-enabled').checked,
      postUpdates: $('nwsx-updates').checked,
      postCancellations: $('nwsx-cancels').checked,
      radarProduct: $('nwsx-radar') ? $('nwsx-radar').value : 'reflectivity',
      alertTypes,
      scope: {
        states: splitList($('nwsx-states').value).map((s) => s.toUpperCase()),
        offices: splitList($('nwsx-offices').value),
        counties: splitList($('nwsx-counties').value),
      },
    };
  }

  // States quick-fill helpers.
  function updateStatesCount() {
    const n = String($('nwsx-states').value || '').split(',').map((x) => x.trim()).filter(Boolean).length;
    const el = $('nwsx-states-count');
    if (el) el.textContent = n ? `${n} selected — click Save settings to apply` : 'blank = entire US';
  }
  $('nwsx-all-states').addEventListener('click', () => { $('nwsx-states').value = ALL_STATES.join(', '); updateStatesCount(); });
  $('nwsx-clear-states').addEventListener('click', () => { $('nwsx-states').value = ''; updateStatesCount(); });
  $('nwsx-states').addEventListener('input', updateStatesCount);

  $('nwsx-save').addEventListener('click', async () => {
    const btn = $('nwsx-save'); btn.disabled = true;
    try { await api('POST', '/admin/nwsx/config', collectConfig()); flash('Settings saved.'); }
    catch (e) { flash('Save failed: ' + e.message, 'err'); }
    finally { btn.disabled = false; }
  });

  async function runTest(post) {
    const sample = $('nwsx-sample').value;
    const btn = post ? $('nwsx-testpost-btn') : $('nwsx-preview-btn');
    btn.disabled = true;
    if (post && !confirm('Send a clearly-labeled [TEST] post to the connected Bluesky account?')) { btn.disabled = false; return; }
    try {
      const radarProduct = $('nwsx-radar') ? $('nwsx-radar').value : 'reflectivity';
      const d = await api('POST', '/admin/nwsx/test', { sample, post, radarProduct });
      $('nwsx-preview').style.display = 'flex';
      $('nwsx-preview-txt').textContent = d.previewText || '';
      $('nwsx-preview-img').src = d.image || '';
      flash(post ? 'Test post sent to Bluesky.' : 'Preview generated.');
    } catch (e) { flash((post ? 'Test post failed: ' : 'Preview failed: ') + e.message, 'err'); }
    finally { btn.disabled = false; }
  }
  $('nwsx-preview-btn').addEventListener('click', () => runTest(false));
  $('nwsx-testpost-btn').addEventListener('click', () => runTest(true));

  async function loadLog() {
    const tbody = $('nwsx-log-rows');
    try {
      const d = await api('GET', '/admin/nwsx/log?limit=50');
      if (!d.rows.length) { tbody.innerHTML = '<tr><td colspan="5" class="nwsx-note">No activity yet.</td></tr>'; return; }
      tbody.innerHTML = d.rows.map((r) => {
        const t = r.ts ? new Date(r.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        const cls = { posted: 'st-posted', skipped: 'st-skipped', error: 'st-error', baseline: 'st-baseline' }[r.status] || '';
        const statusTxt = r.status + (r.reason ? ` (${r.reason})` : '') + (r.error ? `: ${r.error}` : '');
        const gfx = r.graphicPath ? `<a class="nwsx-btn" href="/admin/nwsx/graphic/${encodeURIComponent(r.id)}" target="_blank">View</a>` : '—';
        return `<tr>
          <td>${esc(t)}</td>
          <td>${esc(r.event || '')}</td>
          <td>${esc(shorten(r.id))}</td>
          <td class="nwsx-status ${cls}">${esc(statusTxt)}</td>
          <td>${gfx}</td>
        </tr>`;
      }).join('');
    } catch (e) { tbody.innerHTML = `<tr><td colspan="5" class="st-error">${esc(e.message)}</td></tr>`; }
  }
  function shorten(id) { return String(id || '').replace(/^urn:oid:/, '').slice(-22); }
  $('nwsx-log-refresh').addEventListener('click', loadLog);

  load();
}
