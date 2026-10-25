# Echo Radar RTMP server — setup

Gives every approved streamer an RTMP server and private stream key for OBS,
shown in the Chase Stream Hub under **Stream key (RTMP)**. Viewers watch inside
Echo Radar. The video is handled by **nginx** (Ubuntu's `nginx` plus its RTMP
module) on the **24/7 broadcast box** (the free Oracle server), which has a
public IP and plenty of bandwidth. The main app only checks keys and signs
watch links; no video passes through it. Nothing here costs money.

No DNS records and no certificates to manage:

```
OBS ──RTMP──▶ rtmp://193.122.152.119/live  (port 1935, the only port opened)
                 │  nginx asks the main app: "is this key allowed?"
viewer ──▶ main app /live/<id>/index.m3u8 (signed in)
       ──redirect, signed link──▶ https://stream.echoradarwx.com/w/…  (Cloudflare
                                  Tunnel on the Oracle box → nginx :8099)
```

nginx checks each watch link's signature itself, so the main app is not
asked once per viewer.

## 1. Make a secret

On any Linux box or Git Bash:

```bash
openssl rand -hex 32
```

Keep it somewhere safe; it goes in two places (steps 2 and 4).

## 2. Main app: new code + `.env`, then restart it

Update the main app (the box people use) to this version, add one line to its
`.env`, and restart it:

```
INGEST_SECRET=<the secret>
```

Only if the Oracle box's IP is not `193.122.152.119`, also add
`RTMP_PUBLIC_URL=rtmp://<its IP>/live`.

## 3. Make a Cloudflare Tunnel for the Oracle box

Skip this if the box already has its `oracle-stream` tunnel from the earlier
setup.

Cloudflare dashboard ▸ **Networking ▸ Tunnels ▸ Create a tunnel** ▸ Cloudflared ▸
name it `oracle-stream` ▸ Save. On the install page, pick **Debian** and
**arm64**. The command shown ends with a long token after `service install`:
copy just that token. (Don't run Cloudflare's command; the script below does it.)

## 4. Run the installer on the Oracle box

```bash
ssh -i <your key> ubuntu@193.122.152.119
cd ~/VortexRadar && git pull
sudo bash tools/broadcast/install_ingest.sh <the secret> --tunnel-token <the token>
```

(Leave out `--tunnel-token …` if you skipped step 3.)

It installs nginx and its RTMP module from Ubuntu, switches off the earlier
MediaMTX and Caddy if they are there, and opens port 1935 in the box's own
firewall. It does not touch the 24/7 broadcast. At the end it checks that it
can reach the main app and prints the result:

- `key check: OK` — all good.
- `secret does not match` — the secret in step 2 and step 4 differ.
- `does not have the new code yet` — step 2 is not done.
- `could not reach Echo Radar` — the main app is down, or Cloudflare is
  blocking the request (check Security ▸ Events for echoradarwx.com).

## 5. Oracle Cloud console: open port 1935

Skip if it is already open from the earlier setup.

Networking ▸ Virtual cloud networks ▸ **vortex radar** ▸ Security Lists ▸
Default Security List ▸ **Add Ingress Rules**: source CIDR `0.0.0.0/0`,
IP protocol TCP, destination port `1935`. This is the only port needed.

## 6. Cloudflare: publish the video

Skip if the `stream` route already exists from the earlier setup (it points at
the same `localhost:8099`).

On the tunnel (Networking ▸ Tunnels ▸ `oracle-stream`) ▸ **Routes ▸ Add
route ▸ Published application**: subdomain `stream`, domain `echoradarwx.com`,
service type **HTTP**, URL `localhost:8099`. Save. Cloudflare creates the DNS
entry itself; there is nothing to add under DNS.

## 7. Test

1. Chase Stream Hub ▸ **Your Echo Radar stream server** should say
   **Waiting for OBS**, and Server should read `rtmp://193.122.152.119/live`.
   "Server offline" means the main app cannot reach
   `https://stream.echoradarwx.com/stat` (steps 2, 4 or 6).
2. In OBS: Settings ▸ Stream ▸ Service **Custom**, paste the Server and the
   whole Stream key (it looks like `a1b2c3d4e5?pass=erx_…`). Or press
   **Use for Go Live** and Echo Radar fills them into OBS at Go Live.
3. Start streaming. Within about 10 seconds the Hub shows **Receiving your
   stream**, and signed-in users can watch from your live marker.

If OBS cannot connect at all: port 1935 (steps 4–5). If it connects and drops
straight away, the key was refused (wrong or old key, or the account is not
approved to stream): the main app's log shows `[ingest] refused a stream key`.

OBS settings that work: Output ▸ Keyframe Interval **2 s**, video bitrate
**2500–4500 Kbps**, video encoder **H.264** (x264 or the graphics card's
H.264) and audio **AAC**, which are OBS's defaults. HEVC/AV1 streams connect
but do not play.

Phone apps with a single URL box (Moblin, Larix): paste the Hub's
**One-line URL** (`rtmp://193.122.152.119/live/<id>?pass=erx_…`). Moblin
starts every new stream on **H.265/HEVC**, which nginx accepts but cannot turn
into HLS, so viewers get no picture: set Settings ▸ Streams ▸ the stream ▸
Video ▸ Codec to **H.264/AVC**. The Hub shows a red warning while it is
receiving a stream that is not H.264. The streamer still presses **Go Live**
in the Hub (on the phone or another device) for their map marker.

## Notes

- If the Oracle box's public IP ever changes, set `RTMP_PUBLIC_URL` and
  restart the main app; streamers then copy the new Server.
- Watch links are signed by the main app and last 6 hours; the stream key never
  appears in one. Only signed-in Echo Radar users get a link.
- nginx's RTMP module gets few updates upstream; Ubuntu ships and patches it as
  `libnginx-mod-rtmp`. Keep the box updated (`sudo apt upgrade`). Only port
  1935 faces the internet; nginx's other ports listen on 127.0.0.1 only.
- nginx runs with one worker on purpose: its stream status page only sees the
  worker that answers. One worker easily carries a few chase streams, since
  nothing is re-encoded.
- Viewers' video goes through Cloudflare's network via the tunnel. Cloudflare's
  terms discourage using its free plan mainly for video, so heavy use could
  draw their attention; light chase-stream use is unlikely to.
- Latency is about 6–12 seconds. **New key** in the Hub replaces a leaked key.
