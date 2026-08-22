#!/usr/bin/env bash
# tools/ptt_linux_gateway.sh
# ─────────────────────────────────────────────────────────────────────────────
# Runs the WHOLE Global PTT capture on the Linux server — no Windows PC needed.
#
#   Xvfb (virtual display) → Chromium (logged into dispatch.global-ptt.com,
#   audio sent to a virtual PulseAudio sink) → FFmpeg (captures the sink) →
#   POST /scanner/ingest on this same server → app listeners.
#
# Global PTT has no API, so a browser must play the console somewhere; this keeps
# that browser on the Linux box instead of a separate Windows machine.
#
# ── Install prerequisites (Debian/Ubuntu) ────────────────────────────────────
#   sudo apt update
#   sudo apt install -y chromium xvfb pulseaudio ffmpeg x11vnc
#   # (on some distros the package is 'chromium-browser')
#
# ── One-time login (the console has no API, so you log in once by hand) ───────
#   1) Start this gateway once:                     ./tools/ptt_linux_gateway.sh
#   2) In another shell, expose the virtual screen: x11vnc -display :99 -localhost -nopw
#   3) From your laptop, tunnel + connect a VNC viewer:
#        ssh -L 5900:localhost:5900 you@your-server
#        (open a VNC viewer to localhost:5900)
#   4) Log into dispatch.global-ptt.com in that Chromium window and open the
#      intercom. The login is saved in the profile dir, so you only do this once.
#   Audio starts flowing to listeners as soon as the console is playing.
#
# ── Config (env vars, with defaults) ─────────────────────────────────────────
set -u
CHANNEL="${PTT_CHANNEL:-global-ptt}"
SERVER="${PTT_SERVER:-http://127.0.0.1:${PORT:-3333}}"   # local ingest on this box
URL="${PTT_URL:-https://dispatch.global-ptt.com/#/intercom/map}"
PROFILE="${PTT_PROFILE:-$HOME/.ptt-chrome}"              # persists the login
DISPLAY_NUM="${PTT_DISPLAY:-99}"
BITRATE="${PTT_BITRATE:-32k}"
SINK="ptt"

# SCANNER_INGEST_KEY must match the one in the server's .env.
: "${SCANNER_INGEST_KEY:?Set SCANNER_INGEST_KEY (same value as the server .env)}"

# Pick a chromium binary.
CHROME="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
[ -z "$CHROME" ] && { echo "chromium not found — sudo apt install chromium (or chromium-browser)"; exit 1; }
command -v Xvfb >/dev/null   || { echo "Xvfb not found — sudo apt install xvfb"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg not found — sudo apt install ffmpeg"; exit 1; }
command -v pactl >/dev/null  || { echo "pactl not found — sudo apt install pulseaudio"; exit 1; }

export DISPLAY=":${DISPLAY_NUM}"
mkdir -p "$PROFILE"

cleanup() { echo "[ptt-linux] stopping…"; kill "${XVFB_PID:-}" "${CHROME_PID:-}" 2>/dev/null; }
trap cleanup EXIT INT TERM

# 1) virtual display
if ! xdpyinfo -display ":${DISPLAY_NUM}" >/dev/null 2>&1; then
  Xvfb ":${DISPLAY_NUM}" -screen 0 1280x800x24 >/dev/null 2>&1 &
  XVFB_PID=$!
  sleep 1
fi

# 2) pulseaudio + a virtual sink Chromium plays into; ffmpeg reads its .monitor
pulseaudio --start --exit-idle-time=-1 >/dev/null 2>&1 || true
pactl load-module module-null-sink sink_name="$SINK" sink_properties=device.description=GlobalPTT >/dev/null 2>&1 || true
pactl set-default-sink "$SINK" >/dev/null 2>&1 || true

# 3) Chromium playing the console (autoplay allowed, audio → default sink)
"$CHROME" \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check --disable-gpu --no-sandbox \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --disable-features=Translate,MediaRouter \
  --start-maximized "$URL" >/dev/null 2>&1 &
CHROME_PID=$!
echo "[ptt-linux] Chromium started (profile: $PROFILE). If first run, log in via x11vnc — see header."

# 4) FFmpeg: capture the sink monitor → local ingest, auto-reconnect forever
echo "[ptt-linux] streaming ${SINK}.monitor → ${SERVER}/scanner/ingest/${CHANNEL}"
while true; do
  ffmpeg -hide_banner -loglevel warning \
    -f pulse -i "${SINK}.monitor" \
    -ac 1 -ar 44100 -c:a libmp3lame -b:a "$BITRATE" \
    -f mp3 -content_type audio/mpeg -method POST \
    "${SERVER}/scanner/ingest/${CHANNEL}?key=${SCANNER_INGEST_KEY}" || true
  echo "[ptt-linux] ffmpeg/ingest ended; reconnecting in 3s…"
  sleep 3
done
