# Echo Radar RTMP server — setup

Gives every approved streamer an RTMP URL and private stream key for OBS,
shown in the Chase Stream Hub under **Stream key (RTMP)**. Viewers watch inside
Echo Radar. The video is handled by **MediaMTX** (one free program) on the
**24/7 broadcast box** (the Oracle Cloud server), which has a public IP and
plenty of free bandwidth. The main app only checks keys and signs watch links;
no video passes through it.

```
OBS ──RTMP :1935──▶ MediaMTX on the broadcast box ──"is this key allowed?"──▶ main app
viewer ──▶ main app /live/<id>/index.m3u8 (signed in) ──redirect + signed token──▶
           https://ingest.echoradarwx.com/live/<id>/index.m3u8 (Caddy → MediaMTX)
```

## 1. Pick a secret

On any machine:

```bash
openssl rand -hex 32
```

## 2. Broadcast box (Oracle)

```bash
ssh ubuntu@<broadcast box>
cd ~/VortexRadar && git pull          # or copy the new files over
sudo bash tools/broadcast/install_ingest.sh <the secret>
```

It installs MediaMTX and Caddy, opens TCP 80/443/1935 in the box's own
firewall, starts both as services, and prints the remaining steps. It does
not touch the 24/7 broadcast.

## 3. Oracle Cloud console

Networking ▸ Virtual cloud networks ▸ your VCN ▸ Security Lists ▸ Default
Security List ▸ **Add Ingress Rules**: source `0.0.0.0/0`, IP protocol TCP,
destination ports `80,443,1935`. (Without this, Oracle drops the traffic before
it reaches the box, whatever the box's firewall says.)

## 4. Cloudflare DNS

echoradarwx.com ▸ DNS ▸ Add record: type **A**, name `ingest`, IPv4 = the
broadcast box's public IP, Proxy status **DNS only** (grey cloud).
RTMP cannot go through Cloudflare's proxy or tunnel, and Caddy needs to reach
the box directly to get its HTTPS certificate.

If you had pointed `ingest` at your home IP before, change it to the Oracle IP
and remove the router's port 1935 forward.

## 5. Main app `.env`

```
MEDIAMTX_HOOK_SECRET=<the same secret>
MEDIAMTX_HLS_PUBLIC_URL=https://ingest.echoradarwx.com
MEDIAMTX_API_URL=https://ingest.echoradarwx.com
RTMP_PUBLIC_URL=rtmp://ingest.echoradarwx.com/live
```

Restart the main app. If MediaMTX was running on the main box from an earlier
setup, stop it there: `sudo systemctl disable --now mediamtx`.

## 6. Test

1. Chase Stream Hub ▸ **Your Echo Radar stream server** should say
   **Waiting for OBS**. "Server offline" means the main app cannot reach
   `https://ingest.echoradarwx.com/v3/` (steps 3–5, or Caddy still getting its
   certificate: `journalctl -u caddy -f` on the broadcast box).
2. In OBS: Settings ▸ Stream ▸ Service **Custom**, paste the Server and Stream
   key (the key looks like `a1b2c3d4e5?pass=erx_…`; paste all of it). Or press
   **Use for Go Live** and Echo Radar fills them into OBS at Go Live.
3. Start streaming. Within about 10 seconds the Hub shows **Receiving your
   stream**, and signed-in users can watch from your live marker.

If OBS says the connection failed: check port 1935 (steps 2–4). If it connects
and drops straight away, the key was refused (wrong or old key, or the account
is not approved to stream); `journalctl -u mediamtx -f` shows
`failed to authenticate`. If every stream is refused, check that Cloudflare
(Security ▸ Events) is not blocking MediaMTX's calls to
`echoradarwx.com/internal/mediamtx/auth`.

OBS settings that work well: Output ▸ Keyframe Interval **2 s**, video bitrate
**2500–4500 Kbps**.

## Notes

- Watch links are signed by the main app and last 6 hours; the stream key never
  appears in one. Only signed-in Echo Radar users get a link.
- MediaMTX checks with the main app once per viewer and once per stream start,
  not per video segment.
- Latency is about 6–10 seconds.
- **New key** in the Hub replaces a leaked key; the old one stops working on its
  next connection.
- Running MediaMTX on the main box instead: leave `MEDIAMTX_HLS_PUBLIC_URL`
  unset, point `authHTTPAddress` at `http://127.0.0.1:<PORT>`, forward port 1935
  there; the main app then relays the video itself (and uses its upload).
