# Global PTT — live audio streaming setup

Stream your organization's **Global PTT / radio communications** into the Vortex
Radar website and app as a live listening feature. This is your own feed — it is
**not** Broadcastify or any public scanner service.

```
Global PTT radio → audio out → Windows PC (FFmpeg) ─┐
                                                    │  (HTTPS, authenticated)
                                                    ▼
                 radar.twistcasterlivemedia.com  (Node streaming server)
                                                    │
                        ┌───────────────────────────┴───────────────┐
                        ▼                                            ▼
                  Website player                              Mobile app player
```

Listeners connect to the **server**, never to the Windows PC.

---

## 1. Server (Linux) — one-time

Set a long random shared secret so only your gateway can push audio:

```bash
# in your .env on the server
SCANNER_INGEST_KEY=<a long random string>
```

Restart the server. On boot you'll see:
`[SCANNER] Global PTT streaming ready (1 channel(s), ingest ENABLED).`

If `SCANNER_INGEST_KEY` is unset, ingest is **disabled** (no one can push a feed).

The key is a **secret**: it is the only thing stopping a stranger from
publishing audio to your channel. Keep it in the server's `.env` and, on a
gateway PC, in `tools/ptt.local.env` or `tools/ptt.key.txt` (both gitignored) or
the `PTT_KEY` environment variable — never committed to the repo. If it has ever
been committed or shared, generate a new one and update every gateway:

```bash
openssl rand -hex 32
```

## 2. Capture the audio — pick ONE gateway

Global PTT has no API, so a browser must play the console somewhere and we capture
its audio. Pick by where you can keep a machine running:

| | Runs on | Use when |
|---|---|---|
| **Option 1** | Linux server | you have a server and want no second machine |
| **Option 2** | Windows PC | there is no Linux box for the browser |
| **Option 3** | Windows PC | something else already plays the console audio |

Options 1 and 2 are the same design on two operating systems: a browser plays the
console, a virtual audio device carries that sound, FFmpeg records it and pushes
it to `/scanner/ingest`.

---

### Option 1 (Linux): everything on the server — no Windows PC

Runs a virtual display + Chromium (logged into the console) + FFmpeg entirely on
the server, pushing to its own local `/scanner/ingest`.

```bash
# install deps (Debian/Ubuntu; package may be 'chromium-browser' on some distros)
sudo apt update && sudo apt install -y chromium xvfb pulseaudio ffmpeg x11vnc

# run it (uses SCANNER_INGEST_KEY from the environment / .env)
export SCANNER_INGEST_KEY=... # same as the server .env
./tools/ptt_linux_gateway.sh
```

**One-time login** (no API = you sign in by hand once; it persists in the Chromium
profile): with the gateway running, in another shell expose the virtual screen and
VNC in to log into the console once —

```bash
x11vnc -display :99 -localhost -nopw          # on the server
ssh -L 5900:localhost:5900 you@your-server    # from your laptop, then open a VNC viewer to localhost:5900
```

Log into `dispatch.global-ptt.com`, open the intercom, done — audio flows to
listeners. To keep it running across reboots, install the systemd unit:

```bash
sudo cp tools/ptt-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ptt-gateway
journalctl -u ptt-gateway -f
```

(Edit `User=`, `WorkingDirectory=`, and `EnvironmentFile=` in the unit to match
your box.)

---
### Option 2 (Windows): the all-in-one gateway script

The Windows counterpart of Option 1. One command opens the console in its own
browser, captures that audio, and pushes it to the server, reconnecting on its
own. Use this if you have no Linux box to run the browser on.

Linux gets its virtual audio path from a PulseAudio null sink. Windows has no
equivalent, so the browser plays into a **virtual audio cable** and FFmpeg
records the other end of it:

```
Edge/Chrome (console) -> "CABLE Input" -> "CABLE Output" -> FFmpeg -> server
```

**Prerequisites** (both free, installed once):

- **FFmpeg** - `winget install Gyan.FFmpeg`, then reopen the terminal
- **VB-Audio Virtual Cable** - https://vb-audio.com/Cable/ (installer must be run
  as administrator, then reboot)

**First run:**

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ptt_windows_gateway.ps1 -Setup
```

It checks that the cable is present, asks once for the ingest key (saved to
`tools\ptt.local.env`, which is gitignored), and opens the per-app volume mixer
so you can send the browser's audio to **CABLE Input**. Windows remembers that
routing per app, so it really is a one-time step - the same spirit as the
one-time console login on Linux.

**Every run after that** - double-click `tools\Start-GlobalPTT-Windows.bat`, or:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ptt_windows_gateway.ps1
```

What it does each time:

1. Finds FFmpeg (PATH, winget, or a downloaded build) and picks the capture
   device automatically - CABLE Output, then any VB-Audio/VoiceMeeter device,
   then Stereo Mix.
2. Opens the console at `dispatch.global-ptt.com` in a **dedicated browser
   profile** (`%LOCALAPPDATA%\VortexPTT\browser-profile`), so your normal
   browser is untouched and the console login persists. It also disables
   Chromium's background/occlusion throttling, which is what silently kills a
   minimized tab's audio on Windows.
3. **Measures the audio** before streaming and warns you if the cable is silent,
   instead of quietly sending nothing.
4. Streams mono 32k MP3 to `/scanner/ingest/<channel>` and reconnects every time
   the server recycles the long POST.

Log into the console once in that browser window and open the intercom; audio
flows from then on.

Useful switches:

| Switch | What it does |
|---|---|
| `-Probe` | record 5s from the capture device and report the level in dB |
| `-ListDevices` | show every capture device FFmpeg can see |
| `-NoBrowser` | don't launch a browser (the PTT desktop app is the source) |
| `-Device "name"` | use a specific capture device |
| `-Channel dispatch` | publish to another channel |
| `-InstallTask` | run at logon automatically (`-UninstallTask` removes it) |

Settings can also come from `tools\ptt.local.env`, the repo `.env`, or the
environment: `PTT_SERVER`, `PTT_KEY`, `PTT_INPUT`, `PTT_CHANNEL`, `PTT_BITRATE`,
`PTT_URL`, `PTT_PROFILE`, `PTT_BROWSER`, `PTT_FFMPEG`.

**Troubleshooting**

- *Listeners hear silence* - run `-Probe` while the console is talking. Silence
  there means the browser's audio is not going to CABLE Input: Settings >
  System > Sound > Volume mixer, find the browser, set its Output to
  **CABLE Input**.
- *Want to hear it on the PC too* - use **VoiceMeeter** to split the audio to
  both the cable and your speakers, or turn on "Listen to this device" for CABLE
  Output in Sound control panel.
- *No virtual cable* - the script falls back to **Stereo Mix**, which captures
  *all* system audio, so only use that on a PC that makes no other sound.
- *401 / 503 / 404* - the key does not match `SCANNER_INGEST_KEY`, the server has
  no key set, or the channel does not exist. The script names which one it is.

---

### Option 3 (Windows): push only, console already running

Use this when something else is already playing the audio on the PC and routing
it into the cable, and you only want the upload half.

Get the radio audio into the PC (a hardware line-in, or a virtual cable fed by
your PTT app), then push it up. To capture a browser-based console, route the
browser's output to **CABLE Input** as described above.

Install **FFmpeg** and confirm it's on PATH: `ffmpeg -version`. Find your audio
input device name:

```powershell
ffmpeg -list_devices true -f dshow -i dummy
```

#### Option 3A - the standalone one-file gateway (recommended)

`tools/GlobalPTT-Gateway.js` needs only Node and FFmpeg - copy that single file
anywhere on the Windows PC. It auto-detects the capture device and auto-reconnects.

Put the ingest key next to it in `ptt.key.txt` (just the key on one line), or set
`PTT_KEY`, then:

```powershell
node GlobalPTT-Gateway.js          # or double-click Start-GlobalPTT.bat
node GlobalPTT-Gateway.js --list   # show the capture devices
```

#### Option 3B - the project's source client

Auto-reconnects too, and reads everything from the environment:

```powershell
$env:PTT_SERVER  = "https://radar.twistcasterlivemedia.com"
$env:PTT_KEY     = "the-same-value-as-SCANNER_INGEST_KEY"
$env:PTT_INPUT   = "CABLE Output (VB-Audio Virtual Cable)"
$env:PTT_CHANNEL = "global-ptt"
node tools/ptt_source.js
```

`tools/start_ptt.ps1` wraps that in a restart loop and reads `PTT_KEY` from
`tools\ptt.local.env`.

#### Option 3C - FFmpeg pushing directly

```powershell
ffmpeg -f dshow -i audio="CABLE Output (VB-Audio Virtual Cable)" ^
  -ac 1 -ar 44100 -c:a libmp3lame -b:a 32k -f mp3 ^
  -content_type audio/mpeg -method POST ^
  "https://radar.twistcasterlivemedia.com/scanner/ingest/global-ptt?key=THE_KEY"
```

To keep any of these running unattended, use `ptt_windows_gateway.ps1
-InstallTask`, or wrap it in a **Windows Scheduled Task** (or `nssm`) set to
restart on failure and run at logon.


## 3. Listen

- **In the app:** the 🎧 button in the bottom toolbar opens the Global PTT player.
- **Embed anywhere:** drop this where you want the player and it auto-mounts:
  ```html
  <div id="global-ptt-player"></div>
  ```
  or, for a specific channel: `<div data-global-ptt-player data-channel="global-ptt"></div>`
- **Programmatically:** `window.VortexPTT.mount(element, { channel: 'global-ptt' })`

---

## API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /scanner` or `/scanner/status[/:channel]` | JSON status: `online`, `listeners`, `lastAudioAt`, `bitrateKbps`, `connection`, `uptimeMs` |
| `GET /scanner/stream[/:channel]` | The live `audio/mpeg` stream (private channels require login) |
| `GET /scanner/channels` | List channels the caller may see |
| `POST /scanner/ingest[/:channel]` | Source push (needs the ingest key) |
| `GET /admin/scanner/channels` · `POST /admin/scanner/channels` · `DELETE /admin/scanner/channels/:id` | Admin channel management |

## Channels (add more later, no rebuild)

The default channel is **`global-ptt`** (private — logged-in listeners only). Add
or edit channels as an admin:

```bash
curl -X POST https://radar.twistcasterlivemedia.com/admin/scanner/channels \
  -H 'Content-Type: application/json' --cookie 'your-admin-session' \
  -d '{ "id":"dispatch", "name":"Dispatch", "public":false, "enabled":true }'
```

Then point a second gateway at `.../scanner/ingest/dispatch` and listeners at
`.../scanner/stream/dispatch`.

## Built to grow

The backend is channel-based so these can be layered on without re-architecting:
multiple channels + channel selection, per-channel listener counts (already
tracked), public/private + per-user channel permissions, talkgroup / current-caller
metadata, and recording / archive playback.

## Notes

- Audio is MP3 (`audio/mpeg`) for the widest browser + mobile compatibility.
- The server may recycle the long ingest connection periodically; the source
  client reconnects automatically, so listeners hear at most a brief blip.
- `scanner_channels.json` (in `DATA_DIR`) stores channel definitions.
