/*
 * tools/ptt_e2e_test.js
 * End-to-end PTT test: real HTTP server, real WebSocket upgrade, real session
 * cookies. Run: node tools/ptt_e2e_test.js
 *
 * Covers what the unit test cannot -- that the upgrade rejects a request with no
 * session, that WebRTC signalling actually crosses the wire, and that an abrupt
 * disconnect frees the channel.
 */
// End to end: real HTTP server, real WebSocket upgrade, real session cookies.
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { attachPtt } = require('../backend/ptt');

const mem = {};
const app = express();
app.use(express.json());

// Stand-in for Vortex's session layer, shaped the same way.
const SESSIONS = { 'tok-nick': { id: 'u1', username: 'Nick' },
                   'tok-dave': { id: 'u2', username: 'David' },
                   'tok-adm':  { id: 'u3', username: 'Nathan', isAdmin: true } };
const userFromRequest = (req) => {
  const m = /vr_session=([^;]+)/.exec(req.headers.cookie || '');
  return m ? SESSIONS[m[1]] || null : null;
};
app.use((req, res, next) => { req.user = userFromRequest(req); next(); });
const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'no' });
const requireAdmin = (req, res, next) => req.user && req.user.isAdmin ? next() : res.status(403).json({ error: 'no' });

const ptt = attachPtt({
  app, requireAuth, requireAdmin, DATA_DIR: '.',
  readJson: (f, d) => (mem[f] === undefined ? d : mem[f]),
  writeJson: (f, v) => { mem[f] = v; },
  userFromRequest,
});

const server = http.createServer(app);
ptt.attachUpgrade(server);

let pass = 0, fail = 0;
const check = (l, c, x) => { if (c) { pass++; console.log('  pass  ' + l); } else { fail++; console.log('  FAIL  ' + l + (x ? ' -> ' + x : '')); } };

function client(tok) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ptt/socket`, { headers: { Cookie: `vr_session=${tok}` } });
  const rx = [];
  ws.on('message', (d) => rx.push(JSON.parse(String(d))));
  return {
    ws, rx,
    open: () => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); }),
    send: (o) => ws.send(JSON.stringify(o)),
    last: (t) => [...rx].reverse().find((m) => m.type === t),
    clear: () => { rx.length = 0; },
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let PORT;
server.listen(0, '127.0.0.1', async () => {
  PORT = server.address().port;
  console.log('--- unauthenticated upgrade ---');
  const anon = new WebSocket(`ws://127.0.0.1:${PORT}/ptt/socket`);
  const anonFailed = await new Promise((r) => { anon.on('error', () => r(true)); anon.on('open', () => r(false)); });
  check('socket without a session is rejected', anonFailed);

  console.log('--- real sockets ---');
  const nick = client('tok-nick'), dave = client('tok-dave'), adm = client('tok-adm');
  await Promise.all([nick.open(), dave.open(), adm.open()]);
  await wait(120);
  check('Nick got hello with his identity', (nick.last('ptt:hello') || {}).user?.name === 'Nick');
  check('server assigned a connection id', !!(nick.last('ptt:hello') || {}).connId);
  // Capture ids BEFORE any clear() wipes the message log.
  const nickConnId = nick.last('ptt:hello').connId, daveConnId = dave.last('ptt:hello').connId;

  nick.send({ type: 'ptt:join', channelId: 'storm-chasers' });
  dave.send({ type: 'ptt:join', channelId: 'storm-chasers' });
  await wait(150);
  check('both joined', !!nick.last('ptt:joined') && !!dave.last('ptt:joined'));
  check('David sees Nick as an existing peer', (dave.last('ptt:joined').peers || []).some((p) => p.name === 'Nick'));

  console.log('--- floor over the wire ---');
  nick.clear(); dave.clear();
  nick.send({ type: 'ptt:request' });
  await wait(120);
  check('Nick granted', !!nick.last('ptt:granted'));
  check('David notified Nick is on air', (dave.last('ptt:start') || {}).name === 'Nick');

  dave.clear();
  dave.send({ type: 'ptt:request' });
  await wait(120);
  check('David gets BUSY over the wire', !!dave.last('ptt:busy'));

  console.log('--- webrtc relay over the wire ---');
  dave.clear();
  nick.send({ type: 'webrtc:offer', to: daveConnId, payload: { sdp: 'v=0' } });
  await wait(120);
  check('offer reached David with the sender identified',
    (dave.last('webrtc:offer') || {}).fromName === 'Nick' && dave.last('webrtc:offer').payload.sdp === 'v=0');

  console.log('--- REST alongside ---');
  const r = await fetch(`http://127.0.0.1:${PORT}/api/ptt/channels`, { headers: { Cookie: 'vr_session=tok-nick' } });
  const j = await r.json();
  check('channel list shows live occupancy', (j.channels.find((c) => c.id === 'storm-chasers') || {}).users === 2,
    JSON.stringify((j.channels.find((c) => c.id === 'storm-chasers') || {}).users));
  check('staff channel hidden from ordinary user', !j.channels.some((c) => c.id === 'staff'));
  const r2 = await fetch(`http://127.0.0.1:${PORT}/api/ptt/channels`, { headers: { Cookie: 'vr_session=tok-adm' } });
  check('staff channel visible to admin', (await r2.json()).channels.some((c) => c.id === 'staff'));

  console.log('--- abrupt disconnect frees the channel ---');
  nick.ws.terminate();
  await wait(200);
  const r3 = await fetch(`http://127.0.0.1:${PORT}/api/ptt/channels`, { headers: { Cookie: 'vr_session=tok-dave' } });
  const ch = (await r3.json()).channels.find((c) => c.id === 'storm-chasers');
  check('floor released when the transmitter drops', !ch.transmitting, JSON.stringify(ch.transmitting));
  check('occupancy fell to 1', ch.users === 1, String(ch.users));

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
});
