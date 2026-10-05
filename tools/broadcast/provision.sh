#!/usr/bin/env bash
#
# tools/broadcast/provision.sh — turn a bare Ubuntu/Debian box into a broadcast
# node: the app, a virtual screen, a browser and the encoder, as two systemd
# services that come back by themselves.
#
# The point of a separate box is that the encoder is the expensive part. The
# browser rendering a map in software, the Level 2 decoding and ffmpeg between
# them want a couple of cores and a few gigabytes, continuously — which is
# exactly what you do not want sharing a machine with the app your users are on.
#
#   git clone <your repo> ~/VortexRadar
#   cd ~/VortexRadar
#   scp your-main-box:/path/to/.env .env          # or write one, see below
#   sudo bash tools/broadcast/provision.sh
#
# Options:
#   --user NAME     run the services as this user (default: whoever invoked sudo)
#   --go-live       start streaming at the end, rather than leaving it to you
#   --no-swap       skip adding swap, even on a small box
#
# WHY THE APP RUNS HERE TOO
# The radar volumes reach the browser through the app's own relay, because the
# NEXRAD bucket refuses a listing request from a browser origin. Point this node
# at the app on your main box and every scan travels S3 -> your box -> here, and
# your bandwidth goes UP. With its own copy, this node talks to S3 directly and
# your main box is out of the loop entirely.
#
# It is bound to 127.0.0.1 for the same reason it exists: this is a second copy
# of your whole application, admin pages and all, and it has no business being
# reachable from the internet. Nothing here needs a port open.

set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

RUN_USER="${SUDO_USER:-$(id -un)}"
GO_LIVE=0
WANT_SWAP=1

while [ $# -gt 0 ]; do
  case "$1" in
    --user) RUN_USER="$2"; shift 2 ;;
    --go-live) GO_LIVE=1; shift ;;
    --no-swap) WANT_SWAP=0; shift ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1"; exit 1 ;;
  esac
done

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32mok\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mstopped:\033[0m %s\n' "$*" >&2; exit 1; }

# ── preflight ───────────────────────────────────────────────────────────────
say "Checking the box"

[ "$(id -u)" = "0" ] || die "run this with sudo."
command -v apt-get >/dev/null 2>&1 || die "this expects Debian or Ubuntu (apt-get)."
id "$RUN_USER" >/dev/null 2>&1 || die "no such user: $RUN_USER (pass --user NAME)."

ARCH="$(dpkg --print-architecture)"
RAM_MB="$(awk '/MemTotal/ { print int($2/1024) }' /proc/meminfo)"
DISK_MB="$(df -Pm "$ROOT" | awk 'NR==2 { print $4 }')"
CORES="$(nproc)"
ok "user $RUN_USER, $ARCH, ${CORES} core(s), ${RAM_MB} MB RAM, ${DISK_MB} MB free"

[ "$DISK_MB" -ge 3000 ] || die "needs ~3 GB free; this box has ${DISK_MB} MB."
if [ "$CORES" -lt 2 ]; then
  warn "one core. 1080p30 encoding plus a browser rendering a map in software"
  warn "will not keep up — expect a stuttering stream. Two cores is the floor."
fi
if [ "$RAM_MB" -lt 1800 ]; then
  die "under 2 GB of RAM. The browser alone needs more than this box has."
fi

# ── swap, because the browser spikes ────────────────────────────────────────
# Decoding a radar volume is hundreds of megabytes, briefly, several times an
# hour. On a small box that spike is the difference between a stream and an
# OOM kill, and swap costs nothing when it is not being used.
if [ "$WANT_SWAP" = "1" ] && [ "$RAM_MB" -lt 6000 ]; then
  say "Adding swap"
  if [ "$(swapon --show --noheadings | wc -l)" -gt 0 ]; then
    ok "swap already configured"
  else
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "2 GB swapfile added and made permanent"
  fi
fi

# ── packages ────────────────────────────────────────────────────────────────
say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# fonts matter more than they look: the page asks for Onest from Google Fonts,
# and without fontconfig and a real fallback installed, every label on air
# renders as empty boxes.
apt-get install -y -qq \
  xvfb ffmpeg curl ca-certificates gnupg git \
  fontconfig fonts-liberation fonts-dejavu-core >/dev/null
ok "xvfb, ffmpeg, fonts"

ffmpeg -hide_banner -protocols 2>/dev/null | grep -qw rtmps \
  && ok "ffmpeg has rtmps (needed for Cloudflare Stream)" \
  || warn "ffmpeg has no rtmps; fine for YouTube and Twitch, not for Cloudflare"

# ── the browser ─────────────────────────────────────────────────────────────
# Google Chrome has no arm64 .deb, and Ubuntu's chromium is a snap stub that is
# awkward inside a systemd unit. So: Chrome on amd64, Chromium from apt on arm.
say "Installing a browser"
if command -v google-chrome >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1 \
   || command -v chromium-browser >/dev/null 2>&1; then
  ok "a browser is already installed"
elif [ "$ARCH" = "amd64" ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list
  apt-get update -qq
  apt-get install -y -qq google-chrome-stable >/dev/null
  ok "google-chrome-stable"
else
  apt-get install -y -qq chromium >/dev/null 2>&1 || apt-get install -y -qq chromium-browser >/dev/null
  ok "chromium ($ARCH)"
fi

# Does it actually run? A snap that cannot start, or a chromium missing a
# library, looks exactly like a working install until the stream is black.
BROWSER="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
SMOKE="/home/$RUN_USER/.cache/echo-provision-smoke"
rm -rf "$SMOKE"; mkdir -p "$SMOKE"; chown -R "$RUN_USER" "$SMOKE"
if sudo -u "$RUN_USER" env HOME="/home/$RUN_USER" timeout 90 xvfb-run -a "$BROWSER" \
     --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
     --user-data-dir="$SMOKE/profile" --screenshot="$SMOKE/shot.png" \
     --window-size=800,600 about:blank >/dev/null 2>&1 \
   && [ -s "$SMOKE/shot.png" ]; then
  ok "the browser renders ($(basename "$BROWSER"))"
  rm -rf "$SMOKE"
else
  warn "$(basename "$BROWSER") did not produce a screenshot."
  warn "On Ubuntu ARM this is usually snap confinement. Try:"
  warn "  sudo snap install chromium   # then re-run this script"
  warn "Continuing, but the stream will be black until the browser runs."
fi

# ── node ────────────────────────────────────────────────────────────────────
say "Installing Node"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$NODE_MAJOR" -ge 18 ] && NODE_OK=1
fi
if [ "$NODE_OK" = "1" ]; then
  ok "node $(node -v) already installed"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
  ok "node $(node -v)"
fi

say "Installing app dependencies"
sudo -u "$RUN_USER" npm ci --no-audit --no-fund --prefix "$ROOT" >/dev/null 2>&1 \
  || die "npm ci failed. Run it by hand to see why: sudo -u $RUN_USER npm ci"
ok "node_modules"

# ── .env ────────────────────────────────────────────────────────────────────
say "Checking .env"
[ -f "$ROOT/.env" ] || die "no .env. Copy the one from your main box into $ROOT/.env first.
   It holds the stream keys and the app's settings; this script will not invent one."

envget() { grep -E "^$1=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"'"'"''; }

# Rewritten with awk, and the value handed over through the environment rather
# than interpolated. The obvious `sed -i "s|^$1=.*|$1=$2|"` corrupts the line
# whenever the value contains an ampersand, because sed expands & to the whole
# match — a URL with two query parameters was enough to do it. This file holds
# every secret the app has; it does not get edited by anything clever.
envset() {
  local k="$1" v="$2" tmp
  if ! grep -qE "^$k=" "$ROOT/.env"; then
    printf '%s=%s\n' "$k" "$v" >> "$ROOT/.env"
    return
  fi
  tmp="$(mktemp)"
  ENVSET_VALUE="$v" awk -v k="$k" \
    'BEGIN { FS = "=" } $1 == k { print k "=" ENVIRON["ENVSET_VALUE"]; next } { print }' \
    "$ROOT/.env" > "$tmp"
  # Written back through the existing file so its ownership and mode survive.
  cat "$tmp" > "$ROOT/.env"
  rm -f "$tmp"
}

HAVE_KEY=0
for k in YT_STREAM_KEY TWITCH_STREAM_KEY CF_STREAM_KEY EXTRA_RTMP_URLS; do
  [ -n "$(envget "$k")" ] && HAVE_KEY=1
done
[ "$HAVE_KEY" = "1" ] || die "no stream key in .env (YT_STREAM_KEY / TWITCH_STREAM_KEY / CF_STREAM_KEY)."
ok "at least one stream key present"

# THIS IS A SECOND COPY OF THE WHOLE APPLICATION. The server binds 0.0.0.0 by
# default, which on a box with a public IP puts your admin pages on the
# internet with no gate in front of them. Nothing here needs to be reachable.
if [ "$(envget HOST)" != "127.0.0.1" ]; then
  envset HOST 127.0.0.1
  ok "HOST pinned to 127.0.0.1 (this node must not be reachable from outside)"
else
  ok "HOST already 127.0.0.1"
fi

# Loop frames are the biggest thing this page costs in memory: each one is a
# radar volume decoded in the browser. Small box, shorter loop.
if [ -z "$(envget BROADCAST_URL)" ]; then
  if [ "$RAM_MB" -lt 4000 ]; then
    envset BROADCAST_URL "http://127.0.0.1:3333/broadcast?loop=2"
    ok "BROADCAST_URL set with a 2-frame loop (${RAM_MB} MB RAM)"
  else
    envset BROADCAST_URL "http://127.0.0.1:3333/broadcast"
    ok "BROADCAST_URL set"
  fi
else
  ok "BROADCAST_URL already set, left alone"
fi

chown "$RUN_USER" "$ROOT/.env"
chmod 600 "$ROOT/.env"
ok ".env readable only by $RUN_USER"

# ── services ────────────────────────────────────────────────────────────────
say "Installing services"

cat > /etc/systemd/system/echo-radar.service <<UNIT
# The app, for this broadcast node only. Bound to localhost; see provision.sh.
[Unit]
Description=Echo Radar app (broadcast node)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$ROOT
Environment=HOME=/home/$RUN_USER
ExecStart=/usr/bin/env node server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

# HOME is added explicitly: a confined snap browser needs one, and a unit
# that merely inherits it is a unit that works until it does not.
sed -e "s|^User=.*|User=$RUN_USER|" \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$ROOT\nEnvironment=HOME=/home/$RUN_USER|" \
    -e "s|^After=.*|After=network-online.target echo-radar.service|" \
    -e "s|^Wants=.*|Wants=network-online.target echo-radar.service|" \
    "$ROOT/tools/broadcast/echo-stream.service" > /etc/systemd/system/echo-stream.service

systemctl daemon-reload
systemctl enable echo-radar >/dev/null 2>&1
systemctl enable echo-stream >/dev/null 2>&1
ok "echo-radar and echo-stream installed and enabled"

# ── start the app and prove it serves the page ──────────────────────────────
say "Starting the app"
systemctl restart echo-radar
URL="$(envget BROADCAST_URL)"
URL="${URL:-http://127.0.0.1:3333/broadcast}"
for i in $(seq 1 45); do
  if curl -fsS -o /dev/null --max-time 3 "$URL"; then
    ok "the broadcast page is being served"
    break
  fi
  if [ "$i" = "45" ]; then
    echo
    journalctl -u echo-radar -n 25 --no-pager || true
    die "the app never served $URL. The log above is why; .env is the usual cause."
  fi
  sleep 2
done

# ── done ────────────────────────────────────────────────────────────────────
say "Where this will stream"
sudo -u "$RUN_USER" bash "$ROOT/tools/broadcast/echo-stream.sh" --where || true

if [ "$GO_LIVE" = "1" ]; then
  say "Going live"
  systemctl restart echo-stream
  ok "streaming — watch it with: journalctl -u echo-stream -f"
else
  cat <<NEXT

Everything is installed and the app is running. Two commands left:

  sudo -u $RUN_USER bash tools/broadcast/echo-stream.sh --check
      60 seconds of colour bars to every destination above. If the bars
      appear, the keys and the ingests are good and the page is not the
      question.

  sudo systemctl start echo-stream
      go live for real.

Watch it:   journalctl -u echo-stream -f
Stop it:    sudo systemctl stop echo-stream

NEXT
fi
