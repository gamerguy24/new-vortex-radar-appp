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

It has three looks and switches between them on its own, and the radar site
pills from the app are on all of them — blue for a working WSR-88D, amber for
a TDWR, red for one that has not posted Level 2 in 15 minutes. Positions come
from the app's own site table and the status from the same NWS endpoint the
radar page uses, so the stream and the app never show a different set of
radars.

**Quiet — the national view.** MRMS composite reflectivity over the whole
country, refreshing itself every 2 minutes, with every active tornado, severe
thunderstorm and flash flood warning outlined, counters, a scrolling ticker,
the clock and the MRMS legend carrying the frame's age.

**Weather but nothing warned — the tour.** The mosaic is scanned for the
strongest cells in the country, and the nearest WSR-88D to each is a shot in
the rotation. So a wet afternoon with no warnings is still the app's own
super-res radar on the air rather than a 1 km national picture. No bulletin
card here, deliberately: no office has said anything about these storms, and
the card exists to repeat what an office said.

**A storm is warned — the storm view.** It picks the most urgent warning,
finds the nearest WSR-88D, and puts THAT radar on air: single-site base
reflectivity at super-res, zoomed to the warned polygon, with the storm's
specifications beside it — what the warning says about hail, gusts, storm
motion, whether a tornado is radar indicated or confirmed, who issued it and
when it expires. MRMS comes down while this is on, and goes back up afterwards.

Why the mosaic is still there: it is the right picture of the country and the
wrong picture
of a storm (1 km, pre-smoothed, merged across sites, no tilt), and a single
site is the right picture of a storm and cannot show the country at all.

The national view is a shot in the rotation rather than the absence of one, so
a quiet evening alternates between the country and whatever storms exist
instead of sitting on either. A warning outranks both by a factor of five and
interrupts immediately.

Which storm wins, in order: tornado emergency, confirmed large/destructive
tornado, confirmed tornado, radar-indicated tornado, then severe thunderstorm
by damage threat. It holds a storm for at least 90 seconds, cuts away
immediately for anything **more** urgent, and after 3 minutes shares the air
with equally urgent storms so an outbreak is not one county all afternoon.
Flash flood warnings are cut to as well. They were deliberately left out at
first, on the grounds that flooding is the rain that already fell and does not
photograph like a supercell — which was wrong in practice: on a night with nine
flash flood warnings and no severe ones, the stream sat on a static national map
and told a viewer less than the rain that caused them would have.

It never says more than the NWS said. "Confirmed tornado" appears only when
`tornadoDetection` is OBSERVED, and "tornado emergency" only when the office
put it in the headline; everything else is labelled RADAR INDICATED.

* It reloads itself every 6 hours, and sooner if the national radar has not
  updated in 25 minutes. A frozen radar during severe weather is worse than a
  black screen, because it looks fine.
* If a single site goes quiet or fails, it stands down from THAT radar for 10
  minutes and shows the country, rather than reloading and asking the same
  dead station again.

Useful query strings, mostly for checking it:

| | |
|---|---|
| `?tz=America/Chicago` | the zone every time on screen is shown in |
| `?mode=national` | never cut away; the quiet view only |
| `?site=KTLX` | force which radar a cut uses |

Full order of precedence, highest first: tornado warning (emergency, then
confirmed, then radar indicated), flash flood EMERGENCY, severe thunderstorm,
flash flood warning, flood warning, then watches, then a tour of the strongest
echo, and the national mosaic last. A watch therefore never displaces a
warning and the national view appears only when there is nothing else at all.

Watches are issued for lists of zones and carry no polygon, so the first zone
is fetched once to place the camera, and it then stands over the liveliest
weather inside the watch rather than its geometric middle.

A volume more than 30 minutes old is refused and that radar is stood down from
for ten minutes. The archive can hand back a stale realtime folder for a site
that stopped reporting, and one tour went on air with a scan 18 hours old
before this check existed.

To change what is shown, edit that one file — the MRMS product id (`ref_comp`)
comes straight from `components/mrms_products.js`, `TOUR_MIN_DBZ` (45) is how
strong an echo has to be before the stream leaves the national view for it,
and the weakest echo drawn
in the storm view is `MIN_DBZ` in `broadcast/site_radar.js` (20 dBZ: lower and
the palette's grey band sheets over the basemap).

### Where the radar comes from

Single-site scans are decoded **in the browser**, by the app's own Level 2
parser (`dist/l2_bundle.js`) and the same rasteriser the Graphics Studio uses.
There is no second decoder and no server-side render.

The volumes themselves come through this server (`/broadcast/l2-list` and
`/broadcast/l2-file`, the same handlers as the Studio's relay behind a public
door) for two reasons: the page has no session, and the NEXRAD bucket refuses a
listing request from a browser origin outright. Those two routes only ever
touch the NEXRAD buckets and are rate limited to 40 requests a minute — the
stream needs about two. Budget roughly **10-30 MB per scan** of extra download
on the server while a storm is on air, every few minutes.

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
