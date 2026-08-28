/*
 * tools/ptt_test.js
 * Floor-control regression test for VORTEX PTT. Run: node tools/ptt_test.js
 *
 * Half duplex is the property this radio cannot get wrong -- two people keyed
 * up at once during a warning is the failure mode that matters. These drive the
 * real signalling module with fake sockets, so the rules are checked without a
 * browser or a network.
 */
// Drive the real radio with fake sockets. Floor control is the property that
// must hold: two people transmitting at once is the failure a radio cannot have.
const { createStore } = require('../backend/ptt/channels');
const { createRadio } = require('../backend/ptt/signaling');

const mem = {};
const store = createStore({
  DATA_DIR: '.',
  readJson: (f, d) => (mem[f] === undefined ? d : mem[f]),
  writeJson: (f, v) => { mem[f] = v; },
});
const logged = [];
const radio = createRadio({ store, log: (t, d) => logged.push(t) });

function fakeSocket(name) {
  const rx = [];
  const handlers = {};
  return {
    name, rx, readyState: 1,
    send: (s) => rx.push(JSON.parse(s)),
    on: (ev, fn) => { handlers[ev] = fn; },
    emit: (ev, data) => handlers[ev] && handlers[ev](data),
    msg: (o) => handlers.message && handlers.message(JSON.stringify(o)),
    last: (type) => [...rx].reverse().find((m) => m.type === type),
    types: () => rx.map((m) => m.type),
    clear: () => { rx.length = 0; },
  };
}

const users = {
  nick:   { id: 'u1', username: 'Nick' },
  david:  { id: 'u2', username: 'David' },
  nathan: { id: 'u3', username: 'Nathan', isAdmin: true },   // -> RADIO_ADMIN, priority
};

const s = {};
const c = {};
for (const k of Object.keys(users)) { s[k] = fakeSocket(k); c[k] = radio.attachClient(s[k], users[k]); }

let pass = 0, fail = 0;
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  pass  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra ? '  -> ' + extra : '')); }
};

console.log('--- join ---');
s.nick.msg({ type: 'ptt:join', channelId: 'storm-chasers' });
s.david.msg({ type: 'ptt:join', channelId: 'storm-chasers' });
check('Nick joined', !!s.nick.last('ptt:joined'));
check('David joined', !!s.david.last('ptt:joined'));
check('Nick sees David as a peer after David joins', (s.nick.last('ptt:presence') || {}).users?.length === 2);

console.log('--- half duplex ---');
s.nick.clear(); s.david.clear();
s.nick.msg({ type: 'ptt:request' });
check('Nick granted the floor', !!s.nick.last('ptt:granted'));
check('David told Nick is transmitting', (s.david.last('ptt:start') || {}).name === 'Nick');

s.david.clear();
s.david.msg({ type: 'ptt:request' });
check('David gets BUSY, not the floor', !!s.david.last('ptt:busy') && !s.david.last('ptt:granted'),
  s.david.types().join(','));
check('busy names the holder', (s.david.last('ptt:busy') || {}).holder?.name === 'Nick');

console.log('--- release then re-key ---');
s.nick.msg({ type: 'ptt:stop' });
s.david.clear();
s.david.msg({ type: 'ptt:request' });
check('David gets the floor once Nick releases', !!s.david.last('ptt:granted'));

console.log('--- priority pre-empt ---');
s.nathan.msg({ type: 'ptt:join', channelId: 'storm-chasers' });
s.david.clear(); s.nathan.clear();
s.nathan.msg({ type: 'ptt:request', priority: true });
check('admin with priority seizes the floor', !!s.nathan.last('ptt:granted'));
check('displaced user is told why', (s.david.last('ptt:stop') || {}).reason === 'pre-empted',
  JSON.stringify(s.david.last('ptt:stop')));
check('priority transmission is logged', logged.includes('PRIORITY_TRANSMISSION'));

console.log('--- non-priority user cannot pre-empt ---');
s.nick.clear();
s.nick.msg({ type: 'ptt:request', priority: true });
check('ordinary user denied priority', !!s.nick.last('ptt:denied') && !s.nick.last('ptt:granted'));
check('floor still held by Nathan', !!radio.liveFor('storm-chasers').transmitting
  && radio.liveFor('storm-chasers').transmitting.name === 'Nathan');

console.log('--- only the holder can stop ---');
s.nick.msg({ type: 'ptt:stop' });
check('a non-holder cannot end someone else transmission',
  !!radio.liveFor('storm-chasers').transmitting);
s.nathan.msg({ type: 'ptt:stop' });
check('holder can end their own', !radio.liveFor('storm-chasers').transmitting);

console.log('--- rate limiting ---');
s.nick.clear();
let denials = 0;
for (let i = 0; i < 20; i++) { s.nick.msg({ type: 'ptt:request' }); s.nick.msg({ type: 'ptt:stop' }); }
denials = s.nick.rx.filter((m) => m.type === 'ptt:denied' && /slow down/i.test(m.reason || '')).length;
check('PTT spam is rate limited', denials > 0, denials + ' denials');

console.log('--- webrtc relay is channel-scoped ---');
s.david.msg({ type: 'ptt:join', channelId: 'global' });     // different channel now
s.nathan.clear();
s.david.msg({ type: 'webrtc:offer', to: c.nathan.id, payload: { sdp: 'x' } });
check('offer across channels is dropped', !s.nathan.last('webrtc:offer'));
s.david.msg({ type: 'ptt:join', channelId: 'storm-chasers' });
s.nathan.clear();
s.david.msg({ type: 'webrtc:offer', to: c.nathan.id, payload: { sdp: 'x' } });
check('offer within a channel is relayed', !!s.nathan.last('webrtc:offer'));

console.log('--- restricted channel ---');
s.nick.clear();
s.nick.msg({ type: 'ptt:join', channelId: 'staff' });
check('ordinary user refused the staff channel', !!s.nick.last('ptt:denied'));
s.nathan.clear();
s.nathan.msg({ type: 'ptt:join', channelId: 'staff' });
check('admin admitted to the staff channel', !!s.nathan.last('ptt:joined'));

console.log('--- disconnect frees the floor ---');
s.david.msg({ type: 'ptt:join', channelId: 'storm-chasers' });
s.david.msg({ type: 'ptt:request' });
check('David transmitting before drop', !!radio.liveFor('storm-chasers').transmitting);
s.david.emit('close');
check('dropping the socket releases the floor', !radio.liveFor('storm-chasers').transmitting);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
