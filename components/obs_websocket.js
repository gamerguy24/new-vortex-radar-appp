/*
 * components/obs_websocket.js
 * A tiny obs-websocket v5 client for the browser — enough to remote-control OBS
 * running on a chaser's field laptop straight from Echo Radar's Chase Stream
 * Hub. No dependencies; uses the native WebSocket + WebCrypto for the auth
 * handshake.
 *
 * Protocol (obs-websocket 5.x, https://github.com/obsproject/obs-websocket):
 *   op 0 Hello       -> server greets, may include { authentication: {challenge, salt} }
 *   op 1 Identify    -> we reply with rpcVersion + auth string (if required)
 *   op 2 Identified   <- we're in
 *   op 6 Request     -> { requestType, requestId, requestData }
 *   op 7 RequestResponse <- matched by requestId
 *   op 5 Event        <- state changes (e.g. StreamStateChanged)
 *
 * Auth string = base64( sha256( base64( sha256(password + salt) ) + challenge ) )
 *
 * Every failure says WHY in words a chaser can act on (wrong password, OBS not
 * running, the browser blocking the connection...), because "could not
 * connect" on its own sends people round in circles.
 *
 * ES module — imported by stream_hub.js.
 */

const OP = { Hello: 0, Identify: 1, Identified: 2, Reidentify: 3, Event: 5, Request: 6, RequestResponse: 7 };
const CONNECT_TIMEOUT_MS = 20000;   // long enough to answer the browser's permission prompt
const STREAM_START_TIMEOUT_MS = 20000;

function b64(bytes) {
    let s = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
}
async function sha256(str) {
    const data = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', data);
}
async function makeAuth(password, salt, challenge) {
    const secret = b64(await sha256(password + salt));
    return b64(await sha256(secret + challenge));
}

// "ws://192.168.1.5:4455/", " localhost " -> "192.168.1.5", "localhost"
export function cleanHost(host) {
    let h = String(host || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
    if (/^\[.*\]/.test(h)) h = h.replace(/\]:\d+$/, ']');
    else if ((h.match(/:/g) || []).length === 1) h = h.replace(/:\d+$/, '');
    return h || 'localhost';
}
export const isLoopback = (h) => /^(localhost|127(\.\d+){3}|\[?::1\]?)$/i.test(h);

/*
 * Can this page talk to OBS at `host` at all? Answers the cases that fail
 * before a single byte is sent, with what to do about each.
 */
export async function obsPreflight(host) {
    const h = cleanHost(host);
    const secure = location.protocol === 'https:';
    // On a phone, "localhost" is the phone, not the laptop running OBS.
    if (isLoopback(h) && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) {
        return 'Echo Radar is open on a phone or tablet, so it cannot reach OBS on your laptop. Open Echo Radar in Chrome or Edge on the laptop that runs OBS and press Go Live there.';
    }
    // OBS's server is plain ws://. A secure page may open ws:// only to this
    // same computer; to another machine it is blocked as mixed content.
    if (secure && !isLoopback(h)) {
        return `OBS is set to "${h}", another computer. A secure web page can only reach OBS on the same computer it is open on. Open Echo Radar in a browser on the laptop that runs OBS and set the host to localhost.`;
    }
    // Chrome and Edge ask before a website may connect to programs on this
    // computer ("local network access"). If it was ever blocked, it stays blocked.
    if (navigator.permissions && navigator.permissions.query) {
        for (const name of ['loopback-network', 'local-network-access', 'local-network']) {
            try {
                const st = await navigator.permissions.query({ name });
                if (st && st.state === 'denied') {
                    return 'Your browser is blocking Echo Radar from connecting to OBS on this computer. Click the icon to the left of the web address, open Site settings, set "Local network access" (or "Apps on device") to Allow, then reload the page.';
                }
                break;   // the browser knows this permission and it is not denied
            } catch (e) { /* this browser does not know that name; try the next */ }
        }
    }
    return null;
}

export default class OBSClient {
    constructor() {
        this.ws = null;
        this.connected = false;      // socket open + identified
        this._nextId = 1;
        this._pending = new Map();   // requestId -> {resolve, reject}
        this._listeners = {};        // eventName -> [fn]
        this._statusFn = () => {};
    }

    // status(fn): called with ('connecting'|'connected'|'disconnected'|'error', detail?)
    onStatus(fn) { this._statusFn = fn || (() => {}); }
    on(eventType, fn) { (this._listeners[eventType] || (this._listeners[eventType] = [])).push(fn); }
    off(eventType, fn) { const l = this._listeners[eventType]; if (l) this._listeners[eventType] = l.filter((f) => f !== fn); }

    async connect(host, port, password) {
        const h = cleanHost(host);
        const p = parseInt(port, 10) || 4455;
        const blocked = await obsPreflight(h);
        if (blocked) { this._statusFn('error', blocked); throw new Error(blocked); }

        return new Promise((resolve, reject) => {
            // 127.0.0.1 rather than "localhost": OBS listens on IPv4, and a
            // browser that tries ::1 first can stall on it.
            const target = h.toLowerCase() === 'localhost' ? '127.0.0.1' : h;
            const where = `${h}:${p}`;
            let ws;
            try { ws = new WebSocket(`ws://${target.includes(':') && !target.startsWith('[') ? `[${target}]` : target}:${p}`); }
            catch (e) { this._statusFn('error', e.message); return reject(new Error(`Could not open a connection to OBS at ${where}: ${e.message}`)); }
            this.ws = ws;
            this._statusFn('connecting');

            let settled = false, gotHello = false;
            const fail = (msg) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this._statusFn('error', msg);
                try { ws.close(); } catch (e) {}
                reject(new Error(msg));
            };
            const timer = setTimeout(() => fail(gotHello
                ? 'OBS answered but did not finish logging in. Restart OBS and try again.'
                : `No answer from OBS at ${where}. Check OBS is open, Tools ▸ WebSocket Server Settings ▸ "Enable WebSocket server" is ticked, and the port there is ${p}. If your browser asked to allow access to this computer, choose Allow.`),
            CONNECT_TIMEOUT_MS);

            // onerror carries no detail; onclose (which always follows) has the
            // code that says what went wrong.
            ws.onerror = () => {};
            ws.onclose = (e) => {
                const wasConnected = this.connected;
                this.connected = false;
                for (const r of this._pending.values()) r.reject(new Error('OBS closed the connection.'));
                this._pending.clear();
                if (settled) { if (wasConnected) this._statusFn('disconnected', e && e.reason); return; }
                const code = e && e.code;
                if (code === 4009) return fail('OBS rejected the password. Copy it again from OBS (Tools ▸ WebSocket Server Settings ▸ Show Connect Info), paste it into "OBS password" and press Save settings.');
                if (code === 4010) return fail('This OBS is too old for Echo Radar. Update OBS to version 28 or newer (it has the WebSocket server built in).');
                if (code === 4011) return fail('OBS closed the session (another app may have the connection). Try again.');
                if (gotHello) return fail(`OBS dropped the connection while logging in${e && e.reason ? ` (${e.reason})` : ''}. Check the OBS password.`);
                fail(`Could not reach OBS at ${where}. Check that OBS is open, that Tools ▸ WebSocket Server Settings ▸ "Enable WebSocket server" is ticked, and that the port there is ${p}. If your browser asked to allow access to this computer, choose Allow.`);
            };
            ws.onmessage = async (raw) => {
                let msg; try { msg = JSON.parse(raw.data); } catch { return; }
                const { op, d } = msg;
                if (op === OP.Hello) {
                    gotHello = true;
                    const identify = { rpcVersion: 1 };
                    if (d.authentication) {
                        if (!password) return fail('OBS needs a password. Copy it from OBS (Tools ▸ WebSocket Server Settings ▸ Show Connect Info), paste it into "OBS password" and press Save settings.');
                        identify.authentication = await makeAuth(password, d.authentication.salt, d.authentication.challenge);
                    }
                    this._send(OP.Identify, identify);
                } else if (op === OP.Identified) {
                    this.connected = true;
                    settled = true;
                    clearTimeout(timer);
                    this._statusFn('connected');
                    resolve();
                } else if (op === OP.RequestResponse) {
                    const pend = this._pending.get(d.requestId);
                    if (pend) {
                        this._pending.delete(d.requestId);
                        if (d.requestStatus && d.requestStatus.result) pend.resolve(d.responseData || {});
                        else pend.reject(new Error((d.requestStatus && d.requestStatus.comment) || 'OBS request failed'));
                    }
                } else if (op === OP.Event) {
                    (this._listeners[d.eventType] || []).forEach((fn) => { try { fn(d.eventData || {}); } catch (e) {} });
                }
            };
        });
    }

    _send(op, d) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d })); }

    request(requestType, requestData) {
        return new Promise((resolve, reject) => {
            if (!this.connected) return reject(new Error('Not connected to OBS.'));
            const requestId = 'vr-' + (this._nextId++);
            this._pending.set(requestId, { resolve, reject });
            this._send(OP.Request, { requestType, requestId, requestData: requestData || {} });
            setTimeout(() => {
                if (this._pending.has(requestId)) { this._pending.delete(requestId); reject(new Error('OBS request timed out.')); }
            }, 8000);
        });
    }

    // ---- high-level helpers ----
    getVersion() { return this.request('GetVersion'); }
    startStream() { return this.request('StartStream'); }
    stopStream() { return this.request('StopStream'); }
    async isStreaming() {
        try { const r = await this.request('GetStreamStatus'); return !!r.outputActive; } catch { return false; }
    }

    /*
     * Start streaming and wait until OBS has actually connected to the
     * streaming service. StartStream only means "OBS is trying": a wrong RTMP
     * URL or key shows up a few seconds later as OBS's own "Failed to connect
     * to server" and the output stopping. Catching that here lets Go Live say
     * so instead of announcing a stream that is not there.
     */
    async startStreamAndWait() {
        if (await this.isStreaming()) return;
        let onState;
        const started = new Promise((resolve, reject) => {
            onState = (d) => {
                if (d.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED' || d.outputActive === true) resolve();
                else if (d.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') reject(new Error('OBS could not connect to your streaming service, so the stream stopped. In OBS open Settings ▸ Stream and check the server and stream key (or tick "Push my own RTMP URL + key" here and fill them in).'));
            };
            this.on('StreamStateChanged', onState);
        });
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('OBS is still trying to connect to your streaming service after 20 seconds. Check your internet connection and the server and stream key in OBS Settings ▸ Stream.')), STREAM_START_TIMEOUT_MS));
        started.catch(() => {}); timeout.catch(() => {});   // whichever loses the race
        try {
            try { await this.startStream(); }
            catch (e) { throw new Error(`OBS would not start streaming (${e.message}). In OBS open Settings ▸ Stream and check your service and stream key.`); }
            await Promise.race([started, timeout]);
        } finally { this.off('StreamStateChanged', onState); }
    }

    // Point OBS at a custom RTMP destination (e.g. YouTube's ingest URL + key)
    // so Go Live can create the broadcast and wire OBS to it in one step.
    setStreamService(server, key) {
        return this.request('SetStreamServiceSettings', {
            streamServiceType: 'rtmp_custom',
            streamServiceSettings: { server: String(server || ''), key: String(key || ''), use_auth: false },
        });
    }

    // Push overlay text into a Text (GDI+/FreeType) source, if the user named one.
    setOverlayText(sourceName, text) {
        if (!sourceName) return Promise.resolve();
        return this.request('SetInputSettings', { inputName: sourceName, inputSettings: { text: String(text || '') } });
    }

    disconnect() {
        this.connected = false;
        this._pending.clear();
        if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
    }
}
