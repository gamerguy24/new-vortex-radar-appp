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
#   YT_STREAM_KEY     YouTube Studio -> Go Live -> Stream key
#   TWITCH_STREAM_KEY Twitch -> Creator Dashboard -> Settings -> Stream -> Primary Key
#                     At least one of the two is required; both streams the same
#                     picture to both services from a single encode.
#   TWITCH_INGEST_URL default rtmp://live.twitch.tv/app
#   CF_STREAM_KEY     Cloudflare Stream -> Live Inputs -> the key (RTMPS)
#   CF_INGEST_URL     default rtmps://live.cloudflare.com:443/live
#   EXTRA_RTMP_URLS   anything else, space separated, complete URLs with keys
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
# Which of these the CALLER set, captured before the file is read.
PRESET=""
for k in YT_STREAM_KEY TWITCH_STREAM_KEY TWITCH_INGEST_URL CF_STREAM_KEY CF_INGEST_URL \
         EXTRA_RTMP_URLS BROADCAST_URL STREAM_WIDTH STREAM_HEIGHT STREAM_FPS \
         STREAM_BITRATE STREAM_DISPLAY STREAM_BACKUP YT_PRIMARY_URL YT_BACKUP_URL; do
  eval "preset_v=\${$k+set}"
  [ -n "${preset_v:-}" ] && PRESET="$PRESET $k"
done

if [ -f "$ROOT/.env" ]; then
  # Only the keys this script uses, so a stray line in .env cannot execute.
  while IFS='=' read -r k v; do
    case "$k" in
      YT_STREAM_KEY|TWITCH_STREAM_KEY|TWITCH_INGEST_URL|CF_STREAM_KEY|CF_INGEST_URL|EXTRA_RTMP_URLS|BROADCAST_URL|STREAM_WIDTH|STREAM_HEIGHT|STREAM_FPS|STREAM_BITRATE|STREAM_DISPLAY|STREAM_BACKUP|YT_PRIMARY_URL|YT_BACKUP_URL)
        # A .env edited on Windows ends its lines with CR. A carriage return on
        # the end of the stream key makes an RTMP URL that no ingest will accept,
        # and the error it produces says nothing about a carriage return.
        v="${v%$'\r'}"
        v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
        # The real environment wins, so a single run can turn one service off
        # without editing the file:
        #   TWITCH_STREAM_KEY= bash tools/broadcast/echo-stream.sh
        # Set-but-empty counts as set, which is what makes that work.
        #
        # Within the FILE, though, a later line beats an earlier one — the
        # template ships empty placeholders and people append real values below
        # them. PRESET is captured before any parsing precisely so that a value
        # this loop exported a moment ago is not mistaken for one the caller set.
        case " $PRESET " in
          *" $k "*) ;;
          *) [ -n "$v" ] && export "$k=$v" ;;
        esac ;;
    esac
  done < <(grep -E '^[A-Z_]+=' "$ROOT/.env" || true)
fi

KEY="${YT_STREAM_KEY:-}"
TWITCH_KEY="${TWITCH_STREAM_KEY:-}"
TWITCH_URL="${TWITCH_INGEST_URL:-rtmp://live.twitch.tv/app}"
CF_KEY="${CF_STREAM_KEY:-}"
CF_URL="${CF_INGEST_URL:-rtmps://live.cloudflare.com:443/live}"
EXTRA="${EXTRA_RTMP_URLS:-}"
URL="${BROADCAST_URL:-http://127.0.0.1:3333/broadcast}"
W="${STREAM_WIDTH:-1920}"
H="${STREAM_HEIGHT:-1080}"
FPS="${STREAM_FPS:-30}"
BITRATE="${STREAM_BITRATE:-4500k}"
DISP="${STREAM_DISPLAY:-:99}"

# Where the page reports in. Derived once: the watchdog and --diagnose both
# ask the same question of it.
ALIVE_URL="${URL%%\?*}"
ALIVE_URL="${ALIVE_URL%/}/alive"

# ── where this keeps its things ─────────────────────────────────────────────
# Plainly named, and NOT hidden. Snap confinement gives a snap its own $HOME
# but only the non-hidden parts of it, so a browser profile under ~/.cache is
# refused — as root, where that looks like confinement, and as the user who
# owns the directory, where it looks impossible. It cost an evening of black
# stream to work out, and it is one dot.
WORKDIR="${HOME:-/tmp}/echo-broadcast"
mkdir -p "$WORKDIR"

# Keep what the browser says. This went to /dev/null for the whole of this
# script's life, and the one time it mattered — a black picture on a box with
# no screen — the only account of what went wrong had been thrown away.
# Error level only, and truncated each run, so it cannot grow without bound.
BROWSER_LOG="$WORKDIR/browser.log"

# ── looking at the picture ──────────────────────────────────────────────────
# Average luma of one frame off the virtual screen, 0-255. The page is a dark
# theme, so a good picture still reads low — but not zero, which is the whole
# point: zero means nothing was drawn at all.
BLACK_SHOT="$WORKDIR/screen.png"
screen_brightness() {
  ffmpeg -hide_banner -loglevel error -y -f x11grab -video_size "${W}x${H}" \
    -draw_mouse 0 -i "$DISP" -frames:v 1 "$BLACK_SHOT" 2>/dev/null || return 1
  ffmpeg -hide_banner -v error -i "$BLACK_SHOT" \
    -vf signalstats,metadata=print:file=- -f null - 2>/dev/null \
    | sed -n "s/.*YAVG=//p" | head -1
}

# True only when there IS a reading and it is zero. A failed measurement is
# not evidence of a black screen, and must never be acted on as if it were.
is_black() {
  BRIGHT="$(screen_brightness)"
  [ -n "$BRIGHT" ] || return 1
  awk -v v="$BRIGHT" 'BEGIN { exit !(v < 1.0) }'
}

# ── how much memory the browser is using ────────────────────────────────────
# All of it: a browser is a dozen processes and the renderer that dies is not
# the one with the recognisable name. Summed by command name, which catches
# chromium, chrome and brave alike, and the renderers they spawn.
# A ceiling on the browser, because the crash this keeps catching is a
# renderer dying for memory ("Aw, Snap!", SIGTRAP) after hours of decoding
# radar into textures. Restarting at a number of our choosing costs the same
# few seconds as any other restart; waiting for the crash costs a crash page
# on air and the time it takes to notice.
#
# The page reloading itself every six hours does not help here: a same-origin
# reload reuses the process that is leaking.
#
# 3 GB suits a box with a few spare; lower it on a small one. 0 turns the
# ceiling off and goes back to waiting for the crash.
MAX_BROWSER_MB="${STREAM_MAX_BROWSER_MB:-3000}"

browser_mb() {
  ps -eo rss,comm 2>/dev/null \
    | awk '$2 ~ /chrom|brave/ { s += $1 } END { if (s > 0) print int(s / 1024) }'
}

# ── the report ──────────────────────────────────────────────────────────────
# Written once, used twice: against a stream already on air, and against one
# started for the purpose. $1 is how long to wait for a heartbeat — nothing,
# when the page has been up for hours already.
diagnose_report() {
  echo
  echo "── is the browser running? ─────────────────────────────────────────"
  BPID="${CHROME_PID:-}"
  # Matched on the directory this script hands the browser, so that renaming
  # it cannot quietly turn this into a report of a browser that is not there.
  [ -n "$BPID" ] || BPID="$(pgrep -f "user-data-dir=$WORKDIR" 2>/dev/null | head -1)"
  [ -n "$BPID" ] || BPID="$(pgrep -f "$WORKDIR" 2>/dev/null | head -1)"
  if [ -n "$BPID" ] && kill -0 "$BPID" 2>/dev/null; then
    echo "   yes (pid $BPID)"
    D_BROWSER=1
  else
    echo "   NO — there is no browser process, which on its own explains a black screen."
    D_BROWSER=
  fi
  # Which browser it is changes what the answer can be: a snap is confined and
  # cannot reach /root, a .deb is not and can.
  echo "   using: ${CHROME:-none found}"
  case "$CHROME" in
    /snap/*) echo "   (a snap — confined, and cannot be run as root)" ;;
  esac
  echo "   running as: $(id -un) (uid $(id -u)), HOME=${HOME:-unset}"

  echo
  echo "── is the PAGE running? ────────────────────────────────────────────"
  # The decisive test. A black screen looks identical whether the browser
  # never loaded the page or loaded it and then painted nothing, and those two
  # have nothing in common to fix. The heartbeat tells them apart: the page
  # posts it itself, so an answer means the page is alive.
  if [ "${1:-0}" -gt 0 ]; then
    echo "   waiting ${1}s for a heartbeat (the page posts one every 30)…"
    sleep "$1"
  fi
  ANS="$(curl -fsS --max-time 5 "$ALIVE_URL" 2>/dev/null)"
  echo "   $ALIVE_URL"
  echo "   -> ${ANS:-<no answer: is the app new enough to have /broadcast/alive?>}"

  # The page reports what it is showing, which is the difference between "the
  # stream is running" and "the stream is showing the right thing". Printed
  # one field per line, because the one that matters is never the same one.
  # One field at a time, on the whole line. Splitting on commas would have cut
  # "Franklin, FL" in half — a value with a comma in it, and the very field
  # somebody runs this to read.
  shotfield() {
    V="$(echo "$ANS" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" | head -1)"
    [ -n "$V" ] || V="$(echo "$ANS" | sed -E -n "s/.*\"$1\":([^,}\"]*).*/\1/p" | head -1)"
    echo "$V"
  }

  # "shot":{ and not just "shot": — a server that has never had a beat replies
  # with shot:null, which would otherwise print a block of empty fields.
  if echo "$ANS" | grep -q '"shot":{'; then
    echo
    echo "   on air:"
    for k in mode shot site event where radarLayer scanLoaded scanAgeSeconds \
             loopSteps stallWorstMs stallCount heapMb \
             loopFrames lat lon zoom warnings; do
      printf "     %-15s %s\n" "$k" "$(shotfield "$k")"
    done
  fi
  D_AGE="$(echo "$ANS" | sed -n 's/.*"ageSeconds":\([0-9]*\).*/\1/p')"

  echo
  echo "── what is actually on the screen? ─────────────────────────────────"
  YAVG="$(screen_brightness)"
  echo "   a still frame is saved at $BLACK_SHOT"
  echo "   average brightness: ${YAVG:-could not measure}   (0 = entirely black)"

  echo
  echo "── what the browser complained about ───────────────────────────────"
  if [ -s "$BROWSER_LOG" ]; then
    tail -40 "$BROWSER_LOG" | sed "s/^/   /"
  else
    echo "   (nothing — which is what a happy browser logs, and also what one"
    echo "    that started before this build was deployed logs)"
  fi

  echo
  echo "── memory ──────────────────────────────────────────────────────────"
  # The browser first: it is the number that explains a crashed renderer, and
  # the machine having plenty free says nothing about one process hitting its
  # own ceiling.
  echo "   the browser is using: $(browser_mb) MB (restarts past ${MAX_BROWSER_MB} MB)"
  free -m 2>/dev/null | sed "s/^/   /"
  KILLED="$(journalctl -k --no-pager 2>/dev/null | grep -i "killed process" | tail -3)"
  if [ -n "$KILLED" ]; then
    echo "   the kernel has been killing things for memory:"
    echo "$KILLED" | sed "s/^/     /"
  fi

  # The facts above have twice been right and still needed interpreting, so
  # here is the reading of them. The page reporting in and the screen being
  # drawn are what matter; a browser this cannot find while both of those are
  # true is this script failing to look, not the stream failing to run.
  echo
  echo "── in short ────────────────────────────────────────────────────────"
  D_PAGE=
  [ -n "$D_AGE" ] && [ "$D_AGE" -lt 60 ] && D_PAGE=1
  D_DRAWN=
  [ -n "$YAVG" ] && awk -v v="$YAVG" 'BEGIN { exit !(v >= 1.0) }' && D_DRAWN=1

  if [ -n "$D_PAGE" ] && [ -n "$D_DRAWN" ]; then
    echo "   The page is alive and the screen is being drawn. The stream itself"
    echo "   is working — if it looks wrong, look at the page rather than here."
  elif [ -n "$D_PAGE" ]; then
    echo "   The page is alive and drawing nothing. That is the page failing, not"
    echo "   the browser or the encoder; the browser log above says why."
  elif [ -n "$D_BROWSER" ]; then
    echo "   The browser is running but the page is not reporting in. Check the"
    echo "   app is up (systemctl status echo-radar) and that BROADCAST_URL"
    echo "   points at it."
  else
    echo "   Nothing is running: no browser and no page. The browser log above is"
    echo "   where the reason will be."
  fi
}
PRIMARY="${YT_PRIMARY_URL:-rtmp://a.rtmp.youtube.com/live2}"
BACKUP="${YT_BACKUP_URL:-rtmp://b.rtmp.youtube.com/live2?backup=1}"
USE_BACKUP="${STREAM_BACKUP:-0}"

if [ -z "$KEY" ] && [ -z "$TWITCH_KEY" ] && [ -z "$CF_KEY" ] && [ -z "$EXTRA" ]; then
  echo "No stream key. Put at least one in $ROOT/.env:"
  echo "  YT_STREAM_KEY=xxxx-xxxx-xxxx-xxxx-xxxx"
  echo "  TWITCH_STREAM_KEY=live_000000000_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  echo "  CF_STREAM_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  exit 1
fi

# ── where this is going ─────────────────────────────────────────────────────
# Built once and used by both the stream and --check, so a test cannot end up
# pointed somewhere the real stream is not.
DESTS=()
LABELS=()
if [ -n "$KEY" ]; then
  DESTS+=("${PRIMARY}/${KEY}");           LABELS+=("YouTube")
  if [ "$USE_BACKUP" = "1" ]; then
    DESTS+=("${BACKUP}/${KEY}");          LABELS+=("YouTube backup")
  fi
fi
if [ -n "$TWITCH_KEY" ]; then
  DESTS+=("${TWITCH_URL}/${TWITCH_KEY}"); LABELS+=("Twitch")
fi
if [ -n "$CF_KEY" ]; then
  DESTS+=("${CF_URL}/${CF_KEY}");         LABELS+=("Cloudflare Stream")
fi
for u in $EXTRA; do
  DESTS+=("$u");                          LABELS+=("Extra")
done

# RTMPS needs an ffmpeg built with TLS. Most distro builds have it; finding out
# at 3am from a cryptic protocol error does not.
case " ${DESTS[*]} " in
  *rtmps://*)
    # A MISSING ffmpeg is not an ffmpeg without TLS, and saying so sends you off
    # to install the wrong thing. The binary check further down reports that
    # case properly, so this one only speaks when there is an ffmpeg to judge.
    if command -v ffmpeg >/dev/null 2>&1; then
      if ! ffmpeg -hide_banner -protocols 2>/dev/null | grep -qw rtmps; then
        echo "ERROR: a destination uses rtmps:// but this ffmpeg has no rtmps support."
        echo "       ffmpeg -protocols | grep rtmps   (install a build with TLS)"
        exit 1
      fi
    fi ;;
esac

# Twitch refuses anything much over 6000 kbps and will simply drop the stream;
# YouTube is happy far higher, so the cap is only worth mentioning when Twitch
# is actually one of the destinations.
if [ -n "$TWITCH_KEY" ] && [ "${BITRATE%k}" -gt 6000 ] 2>/dev/null; then
  echo "WARNING: $BITRATE is above the ~6000k Twitch accepts; Twitch may drop the stream."
fi

# A destination list with every key masked. Never print $DESTS itself.
describe_dests() {
  local i
  for i in "${!DESTS[@]}"; do
    echo "    ${LABELS[$i]}: $(echo "${DESTS[$i]}" | sed -E 's#/[^/]+$#/********#')"
  done
}

# ── one encode, every destination ───────────────────────────────────────────
# tee splits the ALREADY ENCODED stream, so adding Twitch costs upload and
# nothing else. Encoding a second time would double the CPU on a box that is
# already rendering a map in software.
#
# onfail=ignore is the whole reason for using tee rather than two ffmpeg runs:
# if one service drops at 3am the other keeps going, instead of one dead ingest
# taking the broadcast down with it.
OUTPUT_ARGS=()
if [ "${#DESTS[@]}" -eq 1 ]; then
  OUTPUT_ARGS=(-f flv "${DESTS[0]}")
else
  TEE=""
  for d in "${DESTS[@]}"; do
    [ -n "$TEE" ] && TEE="${TEE}|"
    TEE="${TEE}[f=flv:onfail=ignore]${d}"
  done
  OUTPUT_ARGS=(-f tee "$TEE")
fi

if [ "${1:-run}" = "--where" ]; then
  echo "This stream would go to:"
  describe_dests
  if [ "${#DESTS[@]}" -eq 1 ]; then
    echo "  ffmpeg output: -f flv (single destination)"
  else
    echo "  ffmpeg output: -f tee, ${#DESTS[@]} destinations, each onfail=ignore"
    echo "    $(echo "$TEE" | sed -E 's#/[^/|]+(\||$)#/********\1#g')"
  fi
  exit 0
fi

for bin in Xvfb ffmpeg; do
  command -v "$bin" >/dev/null 2>&1 || { echo "$bin is not installed. See tools/BROADCAST_SETUP.md"; exit 1; }
done

# ── diagnostics ─────────────────────────────────────────────────────────────
#   --check    stream SMPTE bars and a tone straight to YouTube, no browser.
#              If the bars go live, the ingest, the key and the encoder
#              settings are all fine and the problem is the page. If the bars
#              also sit on "Preparing stream", it is not the page.
#   --diagnose why the picture is black. Says whether the browser is running,
#              whether the PAGE is running — which a black screen cannot tell
#              you, and which separates "never loaded" from "loaded, painted
#              nothing" — how bright the screen actually is, what the browser
#              complained about, and whether the kernel has been killing
#              things for memory.
#   --probe    record ten seconds of what the browser is actually showing and
#              report the codec, size, frame rate and keyframe spacing of it.
MODE="${1:-run}"

# A browser is only needed to put the PAGE on air. --check deliberately does
# not use one: its whole purpose is to take the page out of the question.
if [ "$MODE" != "--check" ]; then
  # /snap/bin is not on root's secure_path, so a snap browser is invisible to
  # a systemd unit that merely inherits PATH.
  PATH="$PATH:/snap/bin"
  CHROME="$(command -v chromium || command -v chromium-browser \
    || command -v google-chrome || command -v brave-browser || true)"
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
    "${OUTPUT_ARGS[@]}"
  echo "Test finished. Bars live = encoder and key are good."
  exit 0
fi

# ── one encoder per key ─────────────────────────────────────────────────────
# Two streams on one ingest is not a settings problem and does not look like
# one: YouTube says "More than one ingestion is using the primary URL", the
# preview sits on "Preparing stream" for ever, and the health reads Poor.
# Twitch has no backup ingest at all, so there the two simply fight.
# --diagnose, --probe and --where push nothing anywhere, and refusing to look
# at a stream because a stream is running would fail exactly when the answer
# is most wanted. --check is guarded with the real run: it does push.
case "${1:-run}" in
  --diagnose|--probe|--where) OTHER_FF="" ;;
  *) OTHER_FF="$(pgrep -af "ffmpeg.*rtmp" 2>/dev/null | grep -v "^$$ " | head -3)" ;;
esac
if [ -n "$OTHER_FF" ] && [ "${STREAM_FORCE:-0}" != "1" ]; then
  echo "Another encoder is already streaming from this machine:"
  # Every key on the line. The previous mask anchored on end-of-line, so with
  # a tee string — several destinations separated by "|" — it hid the last key
  # and printed the rest, in output written to be shown to somebody.
  echo "$OTHER_FF" | sed -E "s#(rtmps?://[^ |]*/)[^ |]*#\1********#g" | sed "s/^/    /"
  echo
  echo "Two encoders on one key is what makes YouTube sit on \"Preparing stream\"."
  echo "Stop the other one first:"
  echo "    sudo systemctl stop echo-stream"
  echo "    pkill -f \"ffmpeg.*rtmp\"        # if it was started by hand"
  echo
  echo "If the other encoder is on a DIFFERENT machine — the box this was moved"
  echo "from, say — stop it there; nothing here can see it. STREAM_FORCE=1"
  echo "overrides this check if you are certain."
  exit 1
fi

echo "Echo Radar broadcast"
echo "  page    $URL"
echo "  video   ${W}x${H} @ ${FPS}fps, $BITRATE"
echo "  display $DISP"
echo "  ingest"
describe_dests

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

# If a stream is already running, --diagnose inspects THAT one rather than
# starting a second Xvfb on the same display, which would fail and would then
# report on Xvfb instead of on the picture it was run to explain.
if [ "$MODE" = "--diagnose" ] && pgrep -f "Xvfb $DISP" >/dev/null 2>&1; then
  echo "A stream is already running on $DISP — reporting on that one."
  diagnose_report 0
  exit 0
fi

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
# The browser profile lives under HOME, not in /tmp.
#
# On Ubuntu ARM — which is what the free Oracle tier gives you — chromium is a
# snap, and snap confinement hands each snap its OWN private /tmp. A profile
# directory created with mktemp is then invisible to the browser that is
# supposed to use it, and it fails in a way that looks nothing like the cause.
# HOME is readable under confinement and works everywhere else unchanged.
PROFILE="$WORKDIR/profile"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# Chromium wants a runtime directory, and tries to create /run/user/<uid> if
# it has none — which fails under sudo and for any user without a login
# session. Handing it one removes a failure that has nothing to do with
# streaming. Here too: not hidden, or a confined browser cannot use it.
export XDG_RUNTIME_DIR="$WORKDIR/run"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

DISPLAY="$DISP" "$CHROME" \
  --kiosk --window-size="${W},${H}" --window-position=0,0 \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check --disable-infobars \
  --disable-session-crashed-bubble --disable-features=TranslateUI \
  --disable-dev-shm-usage --no-sandbox \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --autoplay-policy=no-user-gesture-required \
  --hide-scrollbars --disable-notifications \
  --enable-logging=stderr --log-level=2 \
  "$URL" >"$BROWSER_LOG" 2>&1 &
CHROME_PID=$!
sleep 12   # first paint: style, MRMS fetch, the CONUS grid

# The browser has had its twelve seconds; now say what came of it.
if [ "$MODE" = "--diagnose" ]; then
  diagnose_report 35
  exit 0
fi

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

# ── is there anything to broadcast? ─────────────────────────────────────────
# A browser that aborts at startup is invisible to everything downstream: Xvfb
# is still running, ffmpeg still encodes it, and both services still call the
# result Excellent. What goes out is an empty screen, for as long as it takes
# somebody to look at it.
browser_log_tail() {
  if [ -s "$BROWSER_LOG" ]; then tail -20 "$BROWSER_LOG" | sed "s/^/   /"
  else echo "   (it logged nothing at all)"; fi
}

if ! kill -0 "$CHROME_PID" 2>/dev/null; then
  echo "The browser exited within twelve seconds of starting. It said:"
  browser_log_tail
  # The one cause specific enough to name. A snap-packaged browser is denied
  # /root by its confinement whoever runs it, so under sudo it cannot create
  # its own profile and aborts — and "permission denied as root" is confusing
  # enough to be worth spelling out where it happens.
  if grep -qi "permission denied" "$BROWSER_LOG" 2>/dev/null; then
    echo
    echo "A permission error on $WORKDIR, from a browser running as $(id -un)."
    echo "If this is a snap (it says which, above), check nothing in that path"
    echo "is hidden: confinement allows a snap its own \$HOME, but refuses"
    echo "anything under a dot directory, and reports it as permission denied"
    echo "even to the user who owns it."
  fi
  exit 1
fi

# A running browser is not yet a page that is drawing. Where the app is new
# enough to answer for itself, wait for the page to report in before going
# live — an ARM box fetching the national grid takes a good deal longer than
# the twelve seconds allowed for the window to appear.
if curl -fsS --max-time 5 "$ALIVE_URL" 2>/dev/null | grep -q "seen"; then
  PAGE_OK=""
  for i in $(seq 1 18); do
    AGE="$(curl -fsS --max-time 5 "$ALIVE_URL" 2>/dev/null | sed -n 's/.*"ageSeconds":\([0-9]*\).*/\1/p')"
    if [ -n "$AGE" ] && [ "$AGE" -lt 60 ]; then PAGE_OK=1; break; fi
    if ! kill -0 "$CHROME_PID" 2>/dev/null; then
      echo "The browser died while the page was loading. It said:"
      browser_log_tail
      exit 1
    fi
    sleep 5
  done
  if [ -z "$PAGE_OK" ]; then
    echo "The browser is running, but the page never reported in (90 seconds)."
    echo "That is the page failing rather than the stream. The browser said:"
    browser_log_tail
    echo
    echo "    bash tools/broadcast/echo-stream.sh --diagnose     # for the rest"
    exit 1
  fi
fi

# Brightness last, and only as a backstop. An empty display measures about 16
# rather than 0, so this does NOT catch a missing browser — the checks above
# do. What it catches is the case they cannot see: a page that is running,
# answering, and drawing nothing.
if is_black; then
  echo "The page is running but the screen is entirely black."
  echo "A still frame is at $BLACK_SHOT, and the browser said:"
  browser_log_tail
  exit 1
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


ffmpeg -hide_banner -loglevel warning "${COMMON[@]}" "${OUTPUT_ARGS[@]}" &
FF_PID=$!

echo "streaming (pid $FF_PID) — systemd will restart this if it stops"
echo "  keyframes every $(( GOP / FPS ))s (scenecut off), audio aac 44.1k stereo"
# ── watch the picture, not just the encoder ─────────────────────────────────
# ffmpeg will happily stream a browser crash page for hours: a dead tab is a
# screen like any other, and that is exactly what went to air. So the page
# reports in every thirty seconds and this checks that it is still doing so.
# Anything that stops it — a crashed renderer, a hung tab, the browser killed
# for memory — ends this run, and systemd starts a clean one.
#
# Three missed beats, not six. The page beats every 30 seconds, so 90 is as
# certain as 180 and holds a dead screen on air for half as long.
STALE_AFTER=90


while kill -0 "$FF_PID" 2>/dev/null; do
  sleep 30

  if ! kill -0 "$CHROME_PID" 2>/dev/null; then
    echo "the browser exited — restarting the stream"
    exit 1
  fi

  # The heartbeat proves the page is running, not that it is drawing. A page
  # that loads and paints nothing answers every check and shows nothing, so
  # the picture is checked on its own account.
  #
  # Every FOURTH pass, though. Measuring it costs two ffmpeg runs against the
  # X server that is being captured, on the CPU that is encoding — four times
  # a minute of that reaches the picture. The heartbeat already covers every
  # way of losing the page except this one, which is rare and can afford to be
  # caught in four minutes rather than two.
  TICK=$(( ${TICK:-0} + 1 ))
  if [ $(( TICK % 4 )) -eq 0 ]; then
    if is_black; then
      BLACK_STRIKES=$(( ${BLACK_STRIKES:-0} + 1 ))
      if [ "$BLACK_STRIKES" -ge 2 ]; then
        echo "the screen has been entirely black for four minutes — restarting"
        exit 1
      fi
    else
      BLACK_STRIKES=0
    fi
  fi

  AGE="$(curl -fsS --max-time 5 "$ALIVE_URL" 2>/dev/null \
    | sed -n 's/.*"ageSeconds":\([0-9]*\).*/\1/p')"
  # No answer at all means the app is down, which is its own service's problem
  # to solve; only a page that has genuinely gone quiet is acted on here.
  if [ -n "$AGE" ] && [ "$AGE" -gt "$STALE_AFTER" ]; then
    echo "the page has not checked in for ${AGE}s (crashed or hung) — restarting"
    exit 1
  fi

  # Restart BEFORE the renderer dies of it, rather than after.
  if [ "$MAX_BROWSER_MB" -gt 0 ] 2>/dev/null; then
    MB="$(browser_mb)"
    if [ -n "$MB" ] && [ "$MB" -gt "$MAX_BROWSER_MB" ]; then
      echo "the browser is using ${MB} MB (limit ${MAX_BROWSER_MB}) — restarting before it crashes"
      exit 1
    fi
  fi
done

wait "$FF_PID"
EXIT=$?
echo "ffmpeg exited ($EXIT)"
exit "$EXIT"

# ── About the backup ingest ─────────────────────────────────────────────────
# YouTube's backup URL exists so a SECOND encoder, on other hardware, can feed
# the same broadcast. Sending both from this machine doubles the upload and
# protects against nothing: if this box or its link dies, both feeds die with
# it. STREAM_BACKUP=1 is there if you want it, off by default on purpose.
