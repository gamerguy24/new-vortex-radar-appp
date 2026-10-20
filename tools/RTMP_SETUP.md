# Echo Radar RTMP server — setup

Gives every approved streamer an RTMP server and private stream key for OBS,
shown in the Chase Stream Hub under **Stream key (RTMP)**. Viewers watch inside
Echo Radar. The video is handled by **MediaMTX** on the **24/7 broadcast box**
(the Oracle server), which has a public IP and plenty of bandwidth. The main
app only checks keys and signs watch links; no video passes through it.

No DNS records and no certificates to manage:

```
OBS ──RTMP──▶ rtmp://<Oracle IP>/live  (port 1935, the only port opened)
                 │  MediaMTX asks the main app: "is this key allowed?"
viewer ──▶ main app /live/<id>/index.m3u8 (signed in)
       ──redirect + signed token──▶ https://stream.echoradarwx.com  (Cloudflare Tunnel
                                    on the Oracle box → Caddy :8099 → MediaMTX)
```

## 1. Make a secret

```bash
openssl rand -hex 32
```

## 2. Make a Cloudflare Tunnel for the Oracle box

Cloudflare dashboard ▸ **Networking ▸ Tunnels ▸ Create a tunnel** ▸ Cloudflared ▸
name it `oracle-stream` ▸ Save. On the install page, pick **Debian** and
**arm64**. The command shown ends with a long token after `service install`:
copy just that token. (Don't run Cloudflare's command; the script below does it.)

## 3. Run the installer on the Oracle box

```bash
ssh -i <your key> ubuntu@193.122.152.119
cd ~/VortexRadar && git pull          # or copy the new files over
sudo bash tools/broadcast/install_ingest.sh <the secret> --tunnel-token <the token>
```

It installs MediaMTX, a local-only Caddy router, and the tunnel connector, and
opens port 1935 in the box's own firewall. It does not touch the 24/7 broadcast.
It prints the remaining steps and this box's public IP.

## 4. Oracle Cloud console: open port 1935

Networking ▸ Virtual cloud networks ▸ **vortex radar** ▸ Security Lists ▸
Default Security List ▸ **Add Ingress Rules**: source CIDR `0.0.0.0/0`,
IP protocol TCP, destination port `1935`. This is the only port needed.

## 5. Cloudflare: publish the video

Back on the tunnel (Networking ▸ Tunnels ▸ `oracle-stream`) ▸ **Routes ▸ Add
route ▸ Published application**: subdomain `stream`, domain `echoradarwx.com`,
service type **HTTP**, URL `localhost:8099`. Save. Cloudflare creates the DNS
entry itself; there is nothing to add under DNS.

## 6. Main app `.env`, then restart the main app

```
MEDIAMTX_HOOK_SECRET=<the same secret>
RTMP_PUBLIC_URL=rtmp://193.122.152.119/live
MEDIAMTX_HLS_PUBLIC_URL=https://stream.echoradarwx.com
MEDIAMTX_API_URL=https://stream.echoradarwx.com
```

## 7. Test

1. Chase Stream Hub ▸ **Your Echo Radar stream server** should say
   **Waiting for OBS**, and Server should read `rtmp://193.122.152.119/live`.
   "Server offline" means the main app cannot reach
   `https://stream.echoradarwx.com/v3/` (steps 2, 3, 5 or 6).
2. In OBS: Settings ▸ Stream ▸ Service **Custom**, paste the Server and the
   whole Stream key (it looks like `a1b2c3d4e5?pass=erx_…`). Or press
   **Use for Go Live** and Echo Radar fills them into OBS at Go Live.
3. Start streaming. Within about 10 seconds the Hub shows **Receiving your
   stream**, and signed-in users can watch from your live marker.

If OBS cannot connect at all: port 1935 (steps 3–4). If it connects and drops
straight away, the key was refused (wrong or old key, or the account is not
approved to stream): `journalctl -u mediamtx -f` shows `failed to authenticate`.

OBS settings that work well: Output ▸ Keyframe Interval **2 s**, video bitrate
**2500–4500 Kbps**.

## Cleaning up an earlier setup

- MediaMTX on the main (home) box: `sudo systemctl disable --now mediamtx`,
  and remove the router's port 1935 forward.
- An `ingest` DNS record in Cloudflare is no longer used; delete it.
- Ports 80/443 opened by the earlier version of the script have nothing
  listening on them now; you can remove those Oracle ingress rules.

## Notes

- If the Oracle box's public IP ever changes, update `RTMP_PUBLIC_URL` and
  restart the main app; streamers then copy the new Server.
- Watch links are signed by the main app and last 6 hours; the stream key never
  appears in one. Only signed-in Echo Radar users get a link. MediaMTX checks
  with the main app once per viewer and once per stream start.
- Viewers' video goes through Cloudflare's network via the tunnel. Cloudflare's
  terms discourage using its free plan mainly for video, so heavy use could
  draw their attention; light chase-stream use is unlikely to.
- Latency is about 6–10 seconds. **New key** in the Hub replaces a leaked key.
