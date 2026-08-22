/*
 * GlobalPTT-Gateway.js — standalone Global PTT audio pusher for Windows.
 * ────────────────────────────────────────────────────────────────────────────
 * COPY THIS ONE FILE anywhere on the Windows PC (Desktop is fine). It needs only:
 *   • Node.js   (https://nodejs.org)
 *   • FFmpeg    (winget install Gyan.FFmpeg, then reopen the terminal)
 * It does NOT need your project, npm install, or anything else. It only reads the
 * audio from VB-Cable and sends it to your Linux server. It never touches your app.
 *
 * SETUP (once):
 *   1) Route the Global PTT voice app's sound into VB-Cable:
 *      Windows Settings → System → Sound → Volume mixer → (Global PTT app) →
 *      Output → "CABLE Input (VB-Audio Virtual Cable)".
 *   2) Edit the two marked lines below (SERVER and INPUT).
 *   3) Double-click Start-GlobalPTT.bat  — or run:  node GlobalPTT-Gateway.js
 *      (List your audio devices with:  node GlobalPTT-Gateway.js --list )
 *
 * It auto-reconnects if the network drops or the server restarts. Leave it running.
 */

// ═══════════════════════════ EDIT THESE ═════════════════════════════════════
// Your Linux streaming server. Use the public domain if the Windows PC can reach
// it, OR the Linux VM's address, e.g. "http://192.168.1.50:3333"
const SERVER  = 'https://radar.twistcasterlivemedia.com';
// The capture device (must match one from `node GlobalPTT-Gateway.js --list`).
const INPUT   = 'CABLE Output (VB-Audio Virtual Cable)';
// ════════════════════════════════════════════════════════════════════════════

// These are already correct — no need to change:
const KEY     = '46f05bbe5c877b9b2d61f95bcab1ba4fcd8d40cca6d25d4b50b95cb4ec06b6f2'; // = SCANNER_INGEST_KEY
const CHANNEL = 'global-ptt';
const BITRATE = '32k';
const FFMPEG  = 'ffmpeg';
const RECONNECT_MS = 3000;

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// `--list` → print the audio devices FFmpeg can see, then exit.
if (process.argv.includes('--list')) {
  console.log('Audio input devices FFmpeg can see:\n');
  const p = spawn(FFMPEG, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { stdio: 'inherit' });
  p.on('error', (e) => console.error('FFmpeg not found — install it (winget install Gyan.FFmpeg) and reopen this window.\n', e.message));
  p.on('close', () => process.exit(0));
  return;
}

const base = SERVER.replace(/\/+$/, '');
const ingestUrl = `${base}/scanner/ingest/${encodeURIComponent(CHANNEL)}?key=${encodeURIComponent(KEY)}`;
const lib = ingestUrl.startsWith('https:') ? https : http;

let ff = null, req = null, restartTimer = null, stopping = false;

function ffArgs() {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'dshow', '-i', `audio=${INPUT}`,
    '-ac', '1', '-ar', '44100',
    '-c:a', 'libmp3lame', '-b:a', BITRATE,
    '-f', 'mp3', 'pipe:1',
  ];
}
function cleanup() { try { if (ff) ff.kill('SIGKILL'); } catch (e) {} try { if (req) req.destroy(); } catch (e) {} ff = null; req = null; }
function scheduleRestart() {
  if (stopping || restartTimer) return;
  cleanup();
  console.log(`[GlobalPTT] reconnecting in ${RECONNECT_MS / 1000}s…`);
  restartTimer = setTimeout(() => { restartTimer = null; start(); }, RECONNECT_MS);
}
function start() {
  if (stopping) return;
  console.log(`[GlobalPTT] capturing "${INPUT}" → ${base}  [channel: ${CHANNEL}]`);
  ff = spawn(FFMPEG, ffArgs(), { stdio: ['ignore', 'pipe', 'pipe'] });
  ff.stderr.on('data', (d) => process.stderr.write('[ffmpeg] ' + d));
  ff.on('error', () => { console.error('[GlobalPTT] FFmpeg not found — install it (winget install Gyan.FFmpeg) and reopen this window.'); scheduleRestart(); });

  const u = new URL(ingestUrl);
  req = lib.request({
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search, method: 'POST',
    headers: { 'Content-Type': 'audio/mpeg', 'Transfer-Encoding': 'chunked', 'Connection': 'keep-alive' },
  }, (res) => {
    if (res.statusCode === 200) console.log('[GlobalPTT] connected — streaming ✓  Listeners hear it in the app.');
    else if (res.statusCode === 401) console.error('[GlobalPTT] server rejected the key (401). Check SCANNER_INGEST_KEY matches on the server.');
    else console.log('[GlobalPTT] server responded ' + res.statusCode);
    res.resume();
    scheduleRestart(); // server recycles the long POST periodically; reconnect
  });
  req.on('error', (e) => { console.error('[GlobalPTT] cannot reach server:', e.message, '\n  → Check SERVER is correct and the Linux box is reachable from Windows.'); scheduleRestart(); });

  ff.stdout.pipe(req);
  ff.on('close', (code) => { console.error(`[GlobalPTT] FFmpeg exited (${code}) — is "${INPUT}" the right device? Run:  node GlobalPTT-Gateway.js --list`); try { req.end(); } catch (e) {} scheduleRestart(); });
}
process.on('SIGINT', () => { stopping = true; cleanup(); console.log('\n[GlobalPTT] stopped.'); process.exit(0); });

console.log('Global PTT gateway starting… (Ctrl+C to stop). Leave this window open.');
start();
