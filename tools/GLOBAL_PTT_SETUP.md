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

## 2. Windows PC (the radio gateway)

Get the radio audio into the PC (a hardware line-in, or a virtual cable like
**VB-Audio Virtual Cable** fed by your PTT app), then push it up.

### Capturing a browser-based console (e.g. Global PTT `dispatch.global-ptt.com`)

Global PTT has no API — the audio is played by the dispatch web page — so we
capture what the browser plays and route only that into FFmpeg:

1. Install **VB-Audio Virtual Cable** (free): https://vb-audio.com/Cable/ — it
   adds a playback device **"CABLE Input"** and a matching recording device
   **"CABLE Output"**.
2. On the gateway PC, open the console in a browser, log in, and open
   `#/intercom/map` so it's receiving audio. (Do the log-in yourself in the
   browser — no credentials go anywhere else.)
3. Send **only the browser's** sound to the cable so you don't capture other
   system noise: Windows **Settings → System → Sound → Volume mixer**, find your
   browser, and set its **Output device → "CABLE Input (VB-Audio Virtual Cable)"**.
   (Do this per-app so alerts/other apps stay on your speakers.)
4. Set `PTT_INPUT="CABLE Output (VB-Audio Virtual Cable)"` in the run command below.
5. Keep the browser tab **open and not minimized** (browsers throttle/mute fully
   backgrounded tabs), keep the PC awake, and make sure autoplay is allowed for
   the site (click into the intercom once so audio is flowing).

> Want to *also* hear it on the PC while capturing? Use **VoiceMeeter** (same
> vendor) to split the browser audio to both the cable and your speakers, or set
> the CABLE playback device's "Listen to this device" to your speakers.
>
> Simpler-but-blunter alternative: enable **"Stereo Mix"** on your sound card and
> set `PTT_INPUT="Stereo Mix (…)"` — but that captures *all* system audio, so run
> it on a machine that makes no other sound.

Install **FFmpeg** (https://ffmpeg.org) and confirm it's on PATH: `ffmpeg -version`.

Find your audio input device name:

```powershell
ffmpeg -list_devices true -f dshow -i dummy
```

Copy the exact device name it prints (e.g. `CABLE Output (VB-Audio Virtual Cable)`).

### Option A — the bundled source client (recommended)

Auto-reconnects if the network drops or the server restarts:

```powershell
$env:PTT_SERVER  = "https://radar.twistcasterlivemedia.com"
$env:PTT_KEY     = "the-same-value-as-SCANNER_INGEST_KEY"
$env:PTT_INPUT   = "CABLE Output (VB-Audio Virtual Cable)"
$env:PTT_CHANNEL = "global-ptt"
node tools/ptt_source.js
```

(Optional: `PTT_BITRATE=48k`. Copy just `tools/ptt_source.js` to the Windows PC —
it only needs Node, no other project files.)

### Option B — FFmpeg pushing directly

```powershell
ffmpeg -f dshow -i audio="CABLE Output (VB-Audio Virtual Cable)" ^
  -ac 1 -ar 44100 -c:a libmp3lame -b:a 32k -f mp3 ^
  -content_type audio/mpeg -method POST ^
  "https://radar.twistcasterlivemedia.com/scanner/ingest/global-ptt?key=THE_KEY"
```

To keep it running unattended, wrap Option A in a **Windows Scheduled Task** (or
`nssm`) set to restart on failure and run at logon.

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
