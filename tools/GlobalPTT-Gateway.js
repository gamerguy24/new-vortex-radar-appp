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

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ═══════════════════════════ EDIT THESE ═════════════════════════════════════
// Your streaming server. Use the public domain if this PC can reach it, OR the
// server's address on your network, e.g. "http://192.168.1.50:3333"
const SERVER  = process.env.PTT_SERVER || 'https://radar.twistcasterlivemedia.com';
// The capture device. Leave as 'auto' to find the VB-Cable by itself; override
// with a name from `node GlobalPTT-Gateway.js --list` if you have several.
let INPUT     = process.env.PTT_INPUT || 'auto';
// ════════════════════════════════════════════════════════════════════════════

const CHANNEL = process.env.PTT_CHANNEL || 'global-ptt';
const BITRATE = process.env.PTT_BITRATE || '32k';
const FFMPEG  = process.env.PTT_FFMPEG || 'ffmpeg';
const RECONNECT_MS = 3000;

/*
 * The ingest key (= SCANNER_INGEST_KEY on the server) is a secret, so it lives
 * outside this file: either in the PTT_KEY environment variable, or in a plain
 * text file named ptt.key.txt / ptt.local.env sitting next to this script.
 */
function resolveKey() {
    if (process.env.PTT_KEY) return process.env.PTT_KEY.trim();
    for (const name of ['ptt.key.txt', 'ptt.local.env']) {
        const file = path.join(__dirname, name);
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, 'utf8');
        const m = text.match(/^\s*(?:PTT_KEY|SCANNER_INGEST_KEY)\s*=\s*(.+)$/m);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
        const bare = text.trim();
        if (bare && !bare.includes('=')) return bare;          // ptt.key.txt holding just the key
    }
    return '';
}
const KEY = resolveKey();

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

// Ask FFmpeg what it can record from, so nobody has to type a device name.
function listAudioDevices(cb) {
  const p = spawn(FFMPEG, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
  let text = '';
  p.stderr.on('data', (d) => { text += d; });
  p.on('error', () => cb([]));
  p.on('close', () => {
    const names = [];
    let section = '';
    for (const line of text.split(/\r?\n/)) {
      const head = line.match(/DirectShow (video|audio) devices/);
      if (head) { section = head[1]; continue; }
      if (/Alternative name/.test(line)) continue;
      const withKind = line.match(/"([^"]+)"\s*\((audio|video)\)/);
      if (withKind) { if (withKind[2] === 'audio') names.push(withKind[1]); continue; }
      const bare = line.match(/^\s*\[[^\]]+\]\s+"([^"]+)"\s*$/);
      if (bare && section === 'audio') names.push(bare[1]);
    }
    cb(names);
  });
}

function pickDevice(names) {
  const patterns = [/^CABLE Output/i, /VB-Audio/i, /VoiceMeeter Out/i, /^Stereo Mix/i];
  for (const re of patterns) {
    const hit = names.find((n) => re.test(n));
    if (hit) return hit;
  }
  return null;
}

function launch() {
  console.log('Global PTT gateway starting… (Ctrl+C to stop). Leave this window open.');
  start();
}

if (!KEY) {
  console.error('No ingest key found.');
  console.error('It must match SCANNER_INGEST_KEY on the server. Provide it either way:');
  console.error('  - set the PTT_KEY environment variable, or');
  console.error(`  - save it in ${path.join(__dirname, 'ptt.key.txt')}`);
  process.exit(1);
}

if (INPUT === 'auto') {
  listAudioDevices((names) => {
    if (!names.length) {
      console.error('[GlobalPTT] FFmpeg found no audio capture devices. Install FFmpeg');
      console.error('  (winget install Gyan.FFmpeg) and VB-Audio Virtual Cable, then retry.');
      process.exit(1);
    }
    const picked = pickDevice(names);
    if (!picked) {
      console.error('[GlobalPTT] No virtual cable among the capture devices:');
      names.forEach((n) => console.error('    ' + n));
      console.error('Install VB-Audio Virtual Cable (https://vb-audio.com/Cable/), or set');
      console.error('PTT_INPUT to one of the names above.');
      process.exit(1);
    }
    INPUT = picked;
    console.log(`[GlobalPTT] auto-detected capture device: "${INPUT}"`);
    launch();
  });
} else {
  launch();
}
