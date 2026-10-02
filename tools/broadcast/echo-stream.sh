#!/usr/bin/env bash
#
# tools/broadcast/echo-stream.sh — run the 24/7 national radar stream.
#
#   Xvfb (virtual screen) -> Chromium (kiosk, /broadcast) -> FFmpeg -> YouTube
#
# Nothing here needs a desktop, a GPU or a logged-in user; it is meant to be
# started by systemd (tools/broadcast/echo-stream.service) and left alone.
#
#   bash tools/broadcast/echo-stream.sh
#
# Settings come from the app's .env (or the environment):
#
#   YT_STREAM_KEY     required — YouTube Studio -> Go Live -> Stream key
#   BROADCAST_URL     default http://127.0.0.1:3333/broadcast
#   STREAM_WIDTH      default 1920      STREAM_HEIGHT  default 1080
#   STREAM_FPS        default 30        STREAM_BITRATE default 4500k
#   STREAM_DISPLAY    default :99
#   STREAM_BACKUP     default 0 — see "About the backup ingest" below
#
# The key is a password: anyone holding it can broadcast to the channel. It
# lives in .env, which is gitignored, and is never printed by this script.
set -uo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

# ── settings ────────────────────────────────────────────────────────────────
if [ -f "$ROOT/.env" ]; then
  # Only the keys this script uses, so a stray line in .env cannot execute.
  while IFS='=' read -r k v; do
    case "$k" in
      YT_STREAM_KEY|BROADCAST_URL|STREAM_WIDTH|STREAM_HEIGHT|STREAM_FPS|STREAM_BITRATE|STREAM_DISPLAY|STREAM_BACKUP|YT_PRIMARY_URL|YT_BACKUP_URL)
        # A .env edited on Windows ends its lines with CR. A carriage return on
        # the end of the stream key makes an RTMP URL that no ingest will accept,
        # and the error it produces says nothing about a carriage return.
        v="${v%$'\r'}"
        v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
        export "$k=$v" ;;
    esac
  done < <(grep -E '^[A-Z_]+=' "$ROOT/.env" || true)
fi

KEY="${YT_STREAM_KEY:-}"
URL="${BROADCAST_URL:-http://127.0.0.1:3333/broadcast}"
W="${STREAM_WIDTH:-1920}"
H="${STREAM_HEIGHT:-1080}"
FPS="${STREAM_FPS:-30}"
BITRATE="${STREAM_BITRATE:-4500k}"
DISP="${STREAM_DISPLAY:-:99}"
PRIMARY="${YT_PRIMARY_URL:-rtmp://a.rtmp.youtube.com/live2}"
BACKUP="${YT_BACKUP_URL:-rtmp://b.rtmp.youtube.com/live2?backup=1}"
USE_BACKUP="${STREAM_BACKUP:-0}"

if [ -z "$KEY" ]; then
  echo "YT_STREAM_KEY is not set. Put it in $ROOT/.env:"
  echo "  YT_STREAM_KEY=xxxx-xxxx-xxxx-xxxx-xxxx"
  exit 1
fi

for bin in Xvfb ffmpeg; do
  command -v "$bin" >/dev/null 2>&1 || { echo "$bin is not installed. See tools/BROADCAST_SETUP.md"; exit 1; }
done

# ── diagnostics ─────────────────────────────────────────────────────────────
#   --check    stream SMPTE bars and a tone straight to YouTube, no browser.
#              If the bars go live, the ingest, the key and the encoder
#              settings are all fine and the problem is the page. If the bars
#              also sit on "Preparing stream", it is not the page.
#   --probe    record ten seconds of what the browser is actually showing and
#              report the codec, size, frame rate and keyframe spacing of it.
MODE="${1:-run}"

# A browser is only needed to put the PAGE on air. --check deliberately does
# not use one: its whole purpose is to take the page out of the question.
if [ "$MODE" != "--check" ]; then
  CHROME="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
  [ -n "$CHROME" ] || { echo "No chromium/google-chrome found. See tools/BROADCAST_SETUP.md"; exit 1; }
fi

if [ "$MODE" = "--check" ]; then
  echo "Streaming test bars to YouTube for 60 seconds (no browser, no page)."
  echo "Watch the preview in YouTube Studio."
  ffmpeg -hide_banner -loglevel warning \
    -f lavfi -i "smptebars=size=${W}x${H}:rate=${FPS}" \
    -f lavfi -i "sine=frequency=440:sample_rate=44100" \
    -t 60 -map 0:v:0 -map 1:a:0 \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -profile:v high -level 4.1 \
    -b:v "$BITRATE" -maxrate "$BITRATE" -bufsize "$(( ${BITRATE%k} * 2 ))k" \
    -g "$(( FPS * 2 ))" -keyint_min "$(( FPS * 2 ))" -sc_threshold 0 -r "$FPS" \
    -c:a aac -b:a 128k -ar 44100 -ac 2 -flvflags no_duration_filesize \
    -f flv "${PRIMARY}/${KEY}"
  echo "Test finished. Bars live = encoder and key are good."
  exit 0
fi

echo "Echo Radar broadcast"
echo "  page    $URL"
echo "  video   ${W}x${H} @ ${FPS}fps, $BITRATE"
echo "  display $DISP"
echo "  ingest  $PRIMARY/********  (backup: $([ "$USE_BACKUP" = "1" ] && echo on || echo off))"

# ── clean up every child on the way out, however we leave ───────────────────
XVFB_PID=""; CHROME_PID=""; FF_PID=""
cleanup() {
  trap - EXIT INT TERM
  [ -n "$FF_PID" ] && kill "$FF_PID" 2>/dev/null
  [ -n "$CHROME_PID" ] && kill "$CHROME_PID" 2>/dev/null
  [ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# ── the virtual screen ──────────────────────────────────────────────────────
Xvfb "$DISP" -screen 0 "${W}x${H}x24" -nolisten tcp &
XVFB_PID=$!
sleep 2
kill -0 "$XVFB_PID" 2>/dev/null || { echo "Xvfb failed to start"; exit 1; }

# ── wait for the page to be servable, so we never air a connection error ────
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 3 "$URL"; then break; fi
  [ "$i" = "60" ] && { echo "$URL never answered — is the app running?"; exit 1; }
  sleep 2
done

# ── the browser ─────────────────────────────────────────────────────────────
# SwiftShader because the box has no GPU: Mapbox needs WebGL, and without this
# the page renders a blank canvas. --kiosk hides every scrap of browser chrome.
PROFILE="$(mktemp -d)"
DISPLAY="$DISP" "$CHROME" \
  --kiosk --window-size="${W},${H}" --window-position=0,0 \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check --disable-infobars \
  --disable-session-crashed-bubble --disable-features=TranslateUI \
  --disable-dev-shm-usage --no-sandbox \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --autoplay-policy=no-user-gesture-required \
  --hide-scrollbars --disable-notifications \
  "$URL" >/dev/null 2>&1 &
CHROME_PID=$!
sleep 12   # first paint: style, MRMS fetch, the CONUS grid

if [ "$MODE" = "--probe" ]; then
  OUT="$(mktemp -d)/probe.mp4"
  echo "Recording 10s of the page to $OUT ..."
  ffmpeg -hide_banner -loglevel error -y \
    -f x11grab -framerate "$FPS" -video_size "${W}x${H}" -draw_mouse 0 -i "$DISP" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
    -t 10 -map 0:v:0 -map 1:a:0 \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -profile:v high -level 4.1 -g "$(( FPS * 2 ))" -keyint_min "$(( FPS * 2 ))" \
    -sc_threshold 0 -r "$FPS" -c:a aac -b:a 128k -ar 44100 -ac 2 "$OUT"
  echo
  echo "--- what the encoder is sending ---"
  ffprobe -hide_banner -v error -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt,channels \
    -of default=noprint_wrappers=1 "$OUT"
  echo
  echo "--- keyframe spacing (seconds between them; YouTube wants 2) ---"
  ffprobe -v error -select_streams v:0 -show_entries frame=pkt_pts_time,key_frame \
    -of csv=p=0 "$OUT" | awk -F, '$2==1 { if (prev != "") print $1 - prev; prev = $1 }'
  echo
  echo "A still frame of what is on screen:"
  SHOT="$(dirname "$OUT")/frame.png"
  ffmpeg -hide_banner -loglevel error -y -i "$OUT" -frames:v 1 "$SHOT" && echo "  $SHOT"
  exit 0
fi

# ── the encoder ─────────────────────────────────────────────────────────────
# anullsrc because YouTube treats a stream with no audio track as unhealthy.
#
# KEYFRAMES ARE THE WHOLE GAME. YouTube wants one every two seconds and will
# sit on "Preparing stream" indefinitely if it does not get them — with the
# connection still reported as Excellent, because the bytes are arriving fine.
# -g alone is not enough: x264 also inserts keyframes at scene cuts, which
# makes the interval irregular, so scenecut is turned off and the GOP is fixed
# from both ends.
GOP=$(( FPS * 2 ))
COMMON=(
  -f x11grab -framerate "$FPS" -video_size "${W}x${H}" -draw_mouse 0 -i "$DISP"
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100
  # Explicit, so stream selection can never pick something unexpected.
  -map 0:v:0 -map 1:a:0
  -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p
  -profile:v high -level 4.1
  -b:v "$BITRATE" -maxrate "$BITRATE" -bufsize "$(( ${BITRATE%k} * 2 ))k"
  -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 -r "$FPS"
  -c:a aac -b:a 128k -ar 44100 -ac 2
  -flvflags no_duration_filesize
)

if [ "$USE_BACKUP" = "1" ]; then
  ffmpeg -hide_banner -loglevel warning "${COMMON[@]}" \
    -f tee -map 0:v -map 1:a \
    "[f=flv:onfail=ignore]${PRIMARY}/${KEY}|[f=flv:onfail=ignore]${BACKUP}/${KEY}" &
else
  ffmpeg -hide_banner -loglevel warning "${COMMON[@]}" -f flv "${PRIMARY}/${KEY}" &
fi
FF_PID=$!

echo "streaming (pid $FF_PID) — systemd will restart this if it stops"
echo "  keyframes every $(( GOP / FPS ))s (scenecut off), audio aac 44.1k stereo"
wait "$FF_PID"
EXIT=$?
echo "ffmpeg exited ($EXIT)"
exit "$EXIT"

# ── About the backup ingest ─────────────────────────────────────────────────
# YouTube's backup URL exists so a SECOND encoder, on other hardware, can feed
# the same broadcast. Sending both from this machine doubles the upload and
# protects against nothing: if this box or its link dies, both feeds die with
# it. STREAM_BACKUP=1 is there if you want it, off by default on purpose.
