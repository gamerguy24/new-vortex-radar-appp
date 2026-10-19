# Echo Radar RTMP server — setup

Gives every approved streamer an RTMP URL and private stream key for OBS,
shown in the Chase Stream Hub under **Stream key (RTMP)**. Viewers watch inside
Echo Radar. The video is received by **MediaMTX** (one free program, no
dependencies) on the same Linux box as Echo Radar.

```
OBS ──RTMP :1935──▶ MediaMTX ──"is this key allowed?"──▶ Echo Radar
                       └── HLS (local) ──▶ Echo Radar /live/<id>/ ──▶ viewers
```

## 1. Install MediaMTX

On the Linux box (64-bit Intel/AMD; pick the `arm64` file for a Raspberry Pi):

1. Open https://github.com/bluenviron/mediamtx/releases/latest and copy the
   link to `mediamtx_<version>_linux_amd64.tar.gz`.
2. Then:

```bash
cd /tmp
curl -LO <the link you copied>
tar xzf mediamtx_*_linux_amd64.tar.gz mediamtx
sudo install -m 755 mediamtx /usr/local/bin/mediamtx
sudo mkdir -p /etc/mediamtx
sudo cp /path/to/VortexRadar/tools/mediamtx.yml /etc/mediamtx/mediamtx.yml
```

## 2. Pick a secret and put it in two places

```bash
openssl rand -hex 32
```

- In `/etc/mediamtx/mediamtx.yml`, replace `CHANGE_ME_TO_THE_SAME_SECRET` with it.
  If Echo Radar does not run on port 3333, change that port too.
- In Echo Radar's `.env`, add `MEDIAMTX_HOOK_SECRET=<the same value>`.

Restart Echo Radar. Its log should no longer say "Echo Radar RTMP server is off".

## 3. Run MediaMTX as a service

`/etc/systemd/system/mediamtx.service`:

```ini
[Unit]
Description=MediaMTX (Echo Radar RTMP server)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/mediamtx /etc/mediamtx/mediamtx.yml
Restart=always
RestartSec=3
DynamicUser=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mediamtx
journalctl -u mediamtx -f      # should list "[RTMP] listener opened on :1935"
```

## 4. Let OBS reach it from the internet

RTMP cannot go through the Cloudflare Tunnel (the tunnel only carries web
traffic), so port 1935 has to reach the box directly:

1. **Router:** forward **TCP 1935** to the Linux box's local IP.
2. **Firewall on the box** (if ufw is on): `sudo ufw allow 1935/tcp`
3. **Cloudflare DNS** for echoradarwx.com: add an **A** record, name `ingest`,
   value = your home's public IP (https://ifconfig.me), and set Proxy status to
   **DNS only** (grey cloud). An orange cloud will not work for RTMP.
   - This makes your home IP visible for `ingest.echoradarwx.com`.
   - If your home IP changes, update this record (or use Cloudflare DDNS).

Streamers then use `rtmp://ingest.echoradarwx.com/live`. To use a different
address, set `RTMP_PUBLIC_URL` in `.env`.

## 5. Test

1. Open the Chase Stream Hub. Under **Stream key (RTMP)** you should see your
   server and key, and the status **Waiting for OBS**. "Server offline" means
   Echo Radar cannot reach MediaMTX (step 3), and "not switched on" means
   MEDIAMTX_HOOK_SECRET is missing (step 2).
2. In OBS: Settings ▸ Stream ▸ Service **Custom**, paste the Server and Stream
   key, then Start Streaming. Or press **Use for Go Live** in the Hub and Echo
   Radar fills them into OBS for you at Go Live.
3. Within about 10 seconds the Hub shows **Receiving your stream**, and other
   users can watch from your live marker.

OBS settings that work well: Settings ▸ Output ▸ Keyframe Interval **2 s**,
video bitrate **2500–4500 Kbps**.

## Limits

- Viewers' video is sent out over this box's internet **upload**. A 4 Mbps
  stream to 5 viewers uses about 20 Mbps of upload, so check your upload speed
  before many people watch at once.
- Latency is roughly 6–10 seconds behind live.
- Only approved streamers' keys work. **New key** in the Hub replaces a leaked
  key; the old one stops working on its next connection.
