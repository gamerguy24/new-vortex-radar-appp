/*
 * components/obs_websocket.js
 * A tiny obs-websocket v5 client for the browser — enough to remote-control OBS
 * running on a chaser's field laptop straight from Vortex Radar's Chase Stream
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
 * ES module — imported by stream_hub.js.
 */

const OP = { Hello: 0, Identify: 1, Identified: 2, Reidentify: 3, Event: 5, Request: 6, RequestResponse: 7 };

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

    connect(host, port, password) {
        return new Promise((resolve, reject) => {
            // OBS ships a plain-ws server; wss only if the user fronts it with TLS.
            const scheme = (location.protocol === 'https:' && host !== 'localhost' && host !== '127.0.0.1') ? 'wss' : 'ws';
            let ws;
            try { ws = new WebSocket(`${scheme}://${host}:${port}`); }
            catch (e) { this._statusFn('error', e.message); return reject(e); }
            this.ws = ws;
            this._statusFn('connecting');

            let settled = false;
            const fail = (msg) => { if (!settled) { settled = true; this._statusFn('error', msg); reject(new Error(msg)); } };

            ws.onerror = () => fail('Could not reach OBS. Is obs-websocket enabled and reachable?');
            ws.onclose = (e) => {
                this.connected = false;
                this._statusFn('disconnected', e && e.reason);
                if (!settled) fail('Connection to OBS closed before it was established.');
            };
            ws.onmessage = async (raw) => {
                let msg; try { msg = JSON.parse(raw.data); } catch { return; }
                const { op, d } = msg;
                if (op === OP.Hello) {
                    const identify = { rpcVersion: 1 };
                    if (d.authentication) {
                        if (!password) return fail('OBS requires a password, but none was set.');
                        identify.authentication = await makeAuth(password, d.authentication.salt, d.authentication.challenge);
                    }
                    this._send(OP.Identify, identify);
                } else if (op === OP.Identified) {
                    this.connected = true;
                    settled = true;
                    this._statusFn('connected');
                    resolve();
                } else if (op === OP.RequestResponse) {
                    const p = this._pending.get(d.requestId);
                    if (p) {
                        this._pending.delete(d.requestId);
                        if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {});
                        else p.reject(new Error((d.requestStatus && d.requestStatus.comment) || 'OBS request failed'));
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
    startStream() { return this.request('StartStream'); }
    stopStream() { return this.request('StopStream'); }
    async isStreaming() {
        try { const r = await this.request('GetStreamStatus'); return !!r.outputActive; } catch { return false; }
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
