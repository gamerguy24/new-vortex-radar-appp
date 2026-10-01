# 24/7 national radar stream — setup

Streams `/broadcast` (national MRMS radar + live NWS warnings) to YouTube,
continuously, from the Linux server. Nobody has to be at a computer: the box
renders its own copy of the page on a virtual screen and encodes it. Your PC
can be off.

```
Xvfb (virtual screen) → Chromium (kiosk, /broadcast) → FFmpeg (x11grab) → YouTube RTMP
```

## 1. Install what it needs

```bash
sudo apt update
sudo apt install -y xvfb ffmpeg chromium curl
# Debian/Ubuntu sometimes name it chromium-browser; either is fine.
```

No GPU required — Chromium renders WebGL in software (SwiftShader). That is
most of the CPU cost; see **Sizing** below.

## 2. Put the stream key in .env

YouTube Studio → **Go Live** → **Stream key** (use a *reusable* key so the URL
never changes).

```bash
# in the app's .env — gitignored, never commit this
YT_STREAM_KEY=xxxx-xxxx-xxxx-xxxx-xxxx
```

Anyone holding that key can broadcast to your channel. If it leaks, reset it in
YouTube Studio and update `.env`.

Optional, all with sensible defaults:

```bash
BROADCAST_URL=http://127.0.0.1:3333/broadcast
STREAM_WIDTH=1920
STREAM_HEIGHT=1080
STREAM_FPS=30
STREAM_BITRATE=4500k
STREAM_BACKUP=0
```

## 3. Try it by hand first

```bash
bash tools/broadcast/echo-stream.sh
```

Within ~30 seconds YouTube Studio should show the stream as **live and
healthy**. Stop it with Ctrl-C. Common stumbles:

| What you see | What it means |
| --- | --- |
| `YT_STREAM_KEY is not set` | the key is not in `.env` |
| `http://…/broadcast never answered` | the app itself is not running |
| YouTube says "no data" | the key is wrong, or the firewall blocks outbound 1935 |
| Black video | Chromium could not do WebGL — check the SwiftShader flags are intact |

## 4. Leave it running

```bash
sudo cp tools/broadcast/echo-stream.service /etc/systemd/system/
sudo nano /etc/systemd/system/echo-stream.service     # set User= and WorkingDirectory=
sudo systemctl daemon-reload
sudo systemctl enable --now echo-stream
journalctl -u echo-stream -f
```

It restarts on failure, and restarts itself once a day to keep a long-running
browser from leaking.

## Sizing

| Output | CPU (x264 veryfast) | Upload |
| --- | --- | --- |
| 1080p30 @ 4500k | ~2–4 cores sustained | ~5 Mbps |
| 720p30 @ 2500k | ~1–2 cores | ~3 Mbps |

If the radar app ever feels slow while streaming, that is the encoder competing
with your users — exactly when it matters most. Drop to 720p
(`STREAM_WIDTH=1280 STREAM_HEIGHT=720 STREAM_BITRATE=2500k`) or give the
encoder its own machine; it only needs to reach the app over HTTP.

## What is on screen

`broadcast/index.html` — deliberately standalone: no app bundle, no menus, and
**no login**, because a session that lapses would put a sign-in page on air.

* National MRMS composite reflectivity, refreshing itself every 2 minutes
* Active tornado / severe thunderstorm / flash flood warnings, every 60 seconds
* Counters, a scrolling warning ticker, clock, and the MRMS legend with the
  frame's age — it says **STALE** on its own if the feed stops
* It reloads itself every 6 hours, and sooner if the radar has not updated in
  25 minutes. A frozen national radar during severe weather is worse than a
  black screen, because it looks fine.

To change what is shown, edit that one file — the product id (`ref_comp`) comes
straight from `components/mrms_products.js`, so any MRMS product in the app can
go on air.

## About the backup ingest

`rtmp://b.rtmp.youtube.com/live2?backup=1` is for a **second encoder on other
hardware** feeding the same broadcast. Sending both from this machine doubles
the upload and protects against nothing — if this box or its link goes down,
both feeds go with it. `STREAM_BACKUP=1` enables it anyway if you want it.

## Before you go public

* The page already says it is unofficial and points at weather.gov. Keep that.
* NOAA data (MRMS, NWS warnings) is public domain. The **basemap is Mapbox** —
  check your Mapbox plan covers a continuous video broadcast of their tiles,
  and note the renderer pulls tiles 24/7. If that becomes a problem, the
  Graphics Studio already draws its own map with no Mapbox at all, and the
  broadcast page could be moved onto it.
