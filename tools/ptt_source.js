#!/usr/bin/env node
/*
 * tools/ptt_source.js — Global PTT audio source client (runs on the Windows PC)
 * ────────────────────────────────────────────────────────────────────────────
 * Captures the radio-gateway audio with FFmpeg, encodes it to MP3, and pushes it
 * to the Linux streaming server (POST /scanner/ingest). Auto-reconnects if the
 * network drops or the server restarts. Listeners connect to the SERVER, never
 * to this PC.
 *
 *   Global PTT radio → audio out → this PC (FFmpeg) → server → app listeners
 *
 * Prereqrequisites: FFmpeg installed and on PATH (https://ffmpeg.org).
 *
 * List your Windows audio input devices:
 *   ffmpeg -list_devices true -f dshow -i dummy
 * then set PTT_INPUT to the exact device name it prints (in quotes).
 *
 * Run (PowerShell):
 *   $env:PTT_SERVER   = "https://radar.twistcasterlivemedia.com"
 *   $env:PTT_KEY      = "the-same-value-as-SCANNER_INGEST_KEY-on-the-server"
 *   $env:PTT_INPUT    = "CABLE Output (VB-Audio Virtual Cable)"   # your device
 *   $env:PTT_CHANNEL  = "global-ptt"
 *   node tools/ptt_source.js
 *
 * Config (all via env, with sensible defaults):
 *   PTT_SERVER   base URL of the streaming server        (required)
 *   PTT_KEY      SCANNER_INGEST_KEY set on the server     (required)
 *   PTT_INPUT    FFmpeg dshow audio device name           (required on Windows)
 *   PTT_CHANNEL  channel id to publish to                 (default: global-ptt)
 *   PTT_BITRATE  MP3 bitrate, e.g. 32k / 48k / 64k        (default: 32k)
 *   PTT_INPUT_FORMAT  ffmpeg -f value                     (default: dshow [Windows])
 *   PTT_FFMPEG   path to ffmpeg                           (default: ffmpeg)
 */

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const SERVER = (process.env.PTT_SERVER || '').replace(/\/+$/, '');
const KEY = process.env.PTT_KEY || '';
const INPUT = process.env.PTT_INPUT || '';
const CHANNEL = process.env.PTT_CHANNEL || 'global-ptt';
const BITRATE = process.env.PTT_BITRATE || '32k';
const INPUT_FORMAT = process.env.PTT_INPUT_FORMAT || (process.platform === 'win32' ? 'dshow' : (process.platform === 'darwin' ? 'avfoundation' : 'alsa'));
const FFMPEG = process.env.PTT_FFMPEG || 'ffmpeg';
const RECONNECT_MS = 3000;

if (!SERVER || !KEY || !INPUT) {
    console.error('Missing config. Required: PTT_SERVER, PTT_KEY, PTT_INPUT.');
    console.error('List devices with:  ffmpeg -list_devices true -f dshow -i dummy');
    process.exit(1);
}

const ingestUrl = `${SERVER}/scanner/ingest/${encodeURIComponent(CHANNEL)}?key=${encodeURIComponent(KEY)}`;
const lib = ingestUrl.startsWith('https:') ? https : http;

let ff = null;
let req = null;
let stopping = false;

function ffmpegArgs() {
    // -ac 1 mono, resample to 44.1k, encode MP3, stream to stdout.
    return [
        '-hide_banner', '-loglevel', 'error',
        '-f', INPUT_FORMAT, '-i', INPUT,
        '-ac', '1', '-ar', '44100',
        '-c:a', 'libmp3lame', '-b:a', BITRATE,
        '-f', 'mp3', 'pipe:1',
    ];
}

function start() {
    if (stopping) return;
    console.log(`[ptt] starting FFmpeg (${INPUT_FORMAT} "${INPUT}" → mp3 ${BITRATE}) → ${SERVER} [${CHANNEL}]`);

    ff = spawn(FFMPEG, ffmpegArgs(), { stdio: ['ignore', 'pipe', 'pipe'] });
    ff.stderr.on('data', (d) => process.stderr.write('[ffmpeg] ' + d));
    ff.on('error', (e) => { console.error('[ptt] FFmpeg failed to start:', e.message); scheduleRestart(); });

    const u = new URL(ingestUrl);
    req = lib.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'audio/mpeg', 'Transfer-Encoding': 'chunked', 'Connection': 'keep-alive' },
    }, (res) => {
        console.log(`[ptt] server responded ${res.statusCode}`);
        res.resume();
        // The server closes the request after its requestTimeout window; that's
        // normal — we just reconnect.
        scheduleRestart();
    });
    req.on('error', (e) => { console.error('[ptt] upload error:', e.message); scheduleRestart(); });

    ff.stdout.pipe(req);
    ff.on('close', (code) => { console.error(`[ptt] FFmpeg exited (${code}).`); try { req.end(); } catch (e) {} scheduleRestart(); });
    console.log('[ptt] connected — streaming. Listeners: ' + SERVER + '/scanner/stream');
}

let restartTimer = null;
function scheduleRestart() {
    if (stopping || restartTimer) return;
    cleanup();
    restartTimer = setTimeout(() => { restartTimer = null; start(); }, RECONNECT_MS);
    console.log(`[ptt] reconnecting in ${RECONNECT_MS / 1000}s…`);
}
function cleanup() {
    try { if (ff) ff.kill('SIGKILL'); } catch (e) {}
    try { if (req) req.destroy(); } catch (e) {}
    ff = null; req = null;
}
process.on('SIGINT', () => { stopping = true; cleanup(); console.log('\n[ptt] stopped.'); process.exit(0); });

start();
