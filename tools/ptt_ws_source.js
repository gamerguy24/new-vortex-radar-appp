#!/usr/bin/env node
/*
 * tools/ptt_ws_source.js — Global PTT audio source over WebSocket
 * ────────────────────────────────────────────────────────────────────────────
 * Same job as ptt_source.js (capture with FFmpeg, encode MP3, push to the
 * server), but over a WebSocket instead of a long HTTP POST.
 *
 * WHY: a CDN in front of the origin — Cloudflare, and most others — buffers a
 * request body and only forwards it to the origin once the upload finishes. A
 * live feed is an upload that never finishes, so the POST never arrives and the
 * channel reads "offline" no matter how good the audio is. WebSocket frames are
 * proxied through as they happen, so the same bytes get there in real time.
 *
 * Use the plain HTTP POST client instead when you push straight to the origin
 * with nothing in between (e.g. the gateway running on the server itself).
 *
 * Config (env):
 *   PTT_SERVER   base URL of the streaming server        (required)
 *   PTT_KEY      SCANNER_INGEST_KEY set on the server    (required)
 *   PTT_INPUT    FFmpeg capture device                   (required)
 *   PTT_CHANNEL  channel id                              (default: global-ptt)
 *   PTT_BITRATE  MP3 bitrate                             (default: 32k)
 *   PTT_INPUT_FORMAT  ffmpeg -f value                    (default: per platform)
 *   PTT_FFMPEG   path to ffmpeg                          (default: ffmpeg)
 *   PTT_BUFFER_MS  dshow -audio_buffer_size              (default: 50)
 *
 * Exit codes:  1 = bad config/FFmpeg   3 = server has no WebSocket ingest yet
 */

const { spawn } = require('child_process');

const SERVER = (process.env.PTT_SERVER || '').replace(/\/+$/, '');
const KEY = process.env.PTT_KEY || '';
const INPUT = process.env.PTT_INPUT || '';
const CHANNEL = process.env.PTT_CHANNEL || 'global-ptt';
const BITRATE = process.env.PTT_BITRATE || '32k';
const FFMPEG = process.env.PTT_FFMPEG || 'ffmpeg';
const BUFFER_MS = process.env.PTT_BUFFER_MS || '50';
const INPUT_FORMAT = process.env.PTT_INPUT_FORMAT
    || (process.platform === 'win32' ? 'dshow' : (process.platform === 'darwin' ? 'avfoundation' : 'alsa'));

const RECONNECT_MS = 3000;
// Stop feeding the socket if the network falls behind; better to drop a little
// audio than to grow the buffer without limit.
const MAX_BUFFERED = 2 * 1024 * 1024;
// Retry a failed handshake this many times before deciding the endpoint is absent.
const MAX_FAILED_OPENS = 4;

if (!SERVER || !KEY || !INPUT) {
    console.error('[ptt-ws] Missing config. Required: PTT_SERVER, PTT_KEY, PTT_INPUT.');
    process.exit(1);
}

// Node >= 22 ships a global WebSocket; older versions can use the `ws` package.
let WS = typeof WebSocket !== 'undefined' ? WebSocket : null;
if (!WS) {
    try { WS = require('ws'); } catch (e) {
        console.error('[ptt-ws] No WebSocket support in this Node build.');
        console.error('  Upgrade to Node 22+ (https://nodejs.org), or run "npm install ws".');
        process.exit(1);
    }
}

const wsUrl = SERVER.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    + `/scanner/ingest-ws/${encodeURIComponent(CHANNEL)}?key=${encodeURIComponent(KEY)}`;
const shownUrl = wsUrl.replace(/key=[^&]*/, 'key=***');

let ff = null;
let ws = null;
let stopping = false;
let restartTimer = null;
let dropped = 0;
let failedOpens = 0;   // consecutive connects that never completed a handshake

function ffmpegArgs() {
    const args = ['-hide_banner', '-loglevel', 'error', '-f', INPUT_FORMAT];
    if (INPUT_FORMAT === 'dshow' && Number(BUFFER_MS) > 0) args.push('-audio_buffer_size', String(BUFFER_MS));
    args.push(
        '-i', INPUT_FORMAT === 'dshow' ? `audio=${INPUT}` : INPUT,
        '-ac', '1', '-ar', '44100',
        '-c:a', 'libmp3lame', '-b:a', BITRATE,
        // No ID3/Xing headers: this stream never ends, and on a reconnect those
        // would land in the middle of what listeners are hearing.
        '-f', 'mp3', '-id3v2_version', '0', '-write_xing', '0',
        'pipe:1',
    );
    return args;
}

function cleanup() {
    try { if (ff) ff.kill('SIGKILL'); } catch (e) {}
    try { if (ws) ws.close(); } catch (e) {}
    ff = null; ws = null;
}

function scheduleRestart(why) {
    if (stopping || restartTimer) return;
    cleanup();
    console.error(`[ptt-ws] ${why} — reconnecting in ${RECONNECT_MS / 1000}s…`);
    restartTimer = setTimeout(() => { restartTimer = null; start(); }, RECONNECT_MS);
}

function startFfmpeg() {
    ff = spawn(FFMPEG, ffmpegArgs(), { stdio: ['ignore', 'pipe', 'pipe'] });
    ff.stderr.on('data', (d) => process.stderr.write('[ffmpeg] ' + d));
    ff.on('error', () => {
        console.error('[ptt-ws] FFmpeg failed to start — install it and make sure it is on PATH.');
        scheduleRestart('ffmpeg missing');
    });
    ff.on('close', (code) => scheduleRestart(`ffmpeg exited (${code}) — is "${INPUT}" the right device?`));

    ff.stdout.on('data', (chunk) => {
        if (!ws || ws.readyState !== 1) return;              // 1 = OPEN
        if (ws.bufferedAmount > MAX_BUFFERED) {
            dropped += chunk.length;
            return;
        }
        try { ws.send(chunk); } catch (e) { scheduleRestart('send failed: ' + e.message); }
    });
}

function start() {
    if (stopping) return;
    console.log(`[ptt-ws] connecting to ${shownUrl}`);

    let opened = false;
    let lastError = '';
    try { ws = new WS(wsUrl); } catch (e) { return scheduleRestart('bad server URL: ' + e.message); }
    if ('binaryType' in ws) ws.binaryType = 'arraybuffer';

    const onOpen = () => {
        opened = true;
        console.log(`[ptt-ws] connected — streaming "${INPUT}" → ${CHANNEL} [${BITRATE} mono mp3]`);
        startFfmpeg();
    };
    const onClose = () => {
        if (opened) { failedOpens = 0; return scheduleRestart('connection closed'); }

        // Never completed the handshake. That can just be a transient blip
        // (server still starting, network hiccup), so retry a few times before
        // concluding the endpoint really is not there.
        failedOpens++;
        console.error(`[ptt-ws] could not open a WebSocket to ${shownUrl}`);
        if (lastError) console.error(`  ${lastError}`);
        if (failedOpens >= MAX_FAILED_OPENS && !stopping) {
            console.error(`  Gave up after ${failedOpens} attempts. The server most likely does not`);
            console.error('  have the WebSocket ingest yet — redeploy it, or use -Transport http.');
            process.exit(3);
        }
        scheduleRestart(`handshake failed (attempt ${failedOpens}/${MAX_FAILED_OPENS})`);
    };
    const onError = (ev) => {
        const why = (ev && (ev.message || (ev.error && ev.error.message))) || 'unknown error';
        lastError = why;
    };

    if (typeof ws.addEventListener === 'function') {
        ws.addEventListener('open', onOpen);
        ws.addEventListener('close', onClose);
        ws.addEventListener('error', onError);
    } else {
        ws.on('open', onOpen); ws.on('close', onClose); ws.on('error', onError);
    }
}

setInterval(() => {
    if (dropped) { console.error(`[ptt-ws] dropped ${dropped} bytes while the network was behind.`); dropped = 0; }
}, 30000).unref();

process.on('SIGINT', () => { stopping = true; cleanup(); console.log('\n[ptt-ws] stopped.'); process.exit(0); });

start();
