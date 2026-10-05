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
# Which package manager? Oracle Cloud hands out Oracle Linux unless you change
# the image, so this is the first thing most people trip over.
if command -v apt-get >/dev/null 2>&1; then PKG=apt
elif command -v dnf >/dev/null 2>&1; then PKG=dnf
elif command -v yum >/dev/null 2>&1; then PKG=yum
else die "no apt-get, dnf or yum — this needs Debian/Ubuntu or Enterprise Linux."; fi
id "$RUN_USER" >/dev/null 2>&1 || die "no such user: $RUN_USER (pass --user NAME)."

ARCH="$(dpkg --print-architecture)"
RAM_MB="$(awk '/MemTotal/ { print int($2/1024) }' /proc/meminfo)"
DISK_MB="$(df -Pm "$ROOT" | awk 'NR==2 { print $4 }')"
CORES="$(nproc)"
OS_NAME="$( . /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-unknown}" )"
ok "user $RUN_USER, $ARCH, ${CORES} core(s), ${RAM_MB} MB RAM, ${DISK_MB} MB free"
ok "$OS_NAME (package manager: $PKG)"
if [ "$PKG" != "apt" ]; then
  warn "Debian/Ubuntu is the tested path. On Enterprise Linux neither ffmpeg nor"
  warn "chromium ships in the base repositories, so this will add EPEL and fall"
  warn "back to a static ffmpeg. Each piece is verified before it is relied on;"
  warn "if one cannot be had, you will be told which."
fi

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

# Answer the questions before they are asked. DEBIAN_FRONTEND stops dpkg
# prompting; needrestart is the one that catches people out, because on Ubuntu
# it interrupts an install to ask which services to restart — and a script that
# hides output turns that into a blinking cursor and no explanation.
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

# One place that knows the difference, so the rest of the script does not.
# Output is NOT hidden. Installing a browser on a small ARM box takes minutes,
# and silence for minutes is indistinguishable from a hang — which is exactly
# how this was first reported.
pkg_install() {
  wait_for_apt
  case "$PKG" in
    apt) apt-get install -y \
           -o Dpkg::Options::=--force-confold \
           -o Dpkg::Options::=--force-confdef "$@" ;;
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
  esac
}

# Is something else mid-install? fuser is the precise answer but lives in
# psmisc, which a minimal image may not carry — and a missing command returns
# non-zero, which would have turned this whole wait into a silent no-op.
lock_held() {
  if command -v fuser >/dev/null 2>&1; then
    fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1 && return 0
    return 1
  fi
  pgrep -f unattended-upgrade >/dev/null 2>&1 && return 0
  pgrep -x dpkg >/dev/null 2>&1 && return 0
  return 1
}

wait_for_apt() {
  [ "$PKG" = "apt" ] || return 0
  local waited=0 holder
  while lock_held; do
    if [ "$waited" = "0" ]; then
      holder="$(pgrep -a -f "unattended-upgrade|apt-get|dpkg" 2>/dev/null | head -1 | cut -d" " -f2-)"
      warn "another package manager holds the lock${holder:+ ($holder)} — waiting."
      warn "A fresh instance runs its own updates first; this is normal and finishes."
    fi
    sleep 5
    waited=$(( waited + 5 ))
    [ $(( waited % 30 )) = 0 ] && printf "   still waiting (%ss)\n" "$waited"
    if [ "$waited" -ge 900 ]; then
      die "the package lock has been held for 15 minutes.
   Something is wedged rather than busy. In another session:
     sudo systemctl stop unattended-upgrades
     sudo pkill -f unattended-upgrade
     sudo dpkg --configure -a
   then run this again."
    fi
  done
  [ "$waited" -gt 0 ] && ok "lock released after ${waited}s"
  return 0
}

if [ "$PKG" = "apt" ]; then
  wait_for_apt
  apt-get update
else
  # EPEL carries the pieces Red Hat leaves out. Oracle Linux ships its own
  # EPEL release package; everyone else uses the upstream one.
  EL_VER="$( . /etc/os-release 2>/dev/null && echo "${VERSION_ID%%.*}" )"
  pkg_install "oracle-epel-release-el${EL_VER}" 2>/dev/null \
    || pkg_install epel-release 2>/dev/null \
    || warn "could not add EPEL; chromium and ffmpeg may not be installable"
  if command -v dnf >/dev/null 2>&1; then
    dnf config-manager --set-enabled ol${EL_VER}_developer_EPEL >/dev/null 2>&1 || true
  fi
fi
# fonts matter more than they look: the page asks for Onest from Google Fonts,
# and without fontconfig and a real fallback installed, every label on air
# renders as empty boxes.
if [ "$PKG" = "apt" ]; then
  pkg_install xvfb ffmpeg curl ca-certificates gnupg git nano \
    fontconfig fonts-liberation fonts-dejavu-core
else
  pkg_install xorg-x11-server-Xvfb curl ca-certificates gnupg2 git nano \
    fontconfig liberation-fonts dejavu-sans-fonts tar xz
  # ffmpeg is not in the base or EPEL repositories on Enterprise Linux. Try the
  # package anyway in case a third-party repo is already enabled, then fall back
  # to an official static build, which is self-contained and works on any glibc.
  if ! command -v ffmpeg >/dev/null 2>&1; then
    pkg_install ffmpeg 2>/dev/null || true
  fi
  if ! command -v ffmpeg >/dev/null 2>&1; then
    case "$ARCH" in
      aarch64|arm64) FF_ARCH=arm64 ;;
      x86_64|amd64)  FF_ARCH=amd64 ;;
      *) FF_ARCH="" ;;
    esac
    if [ -n "$FF_ARCH" ]; then
      warn "no ffmpeg package; fetching a static build"
      TMPF="$(mktemp -d)"
      if curl -fsSL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${FF_ARCH}-static.tar.xz" \
           -o "$TMPF/ff.tar.xz" && tar xf "$TMPF/ff.tar.xz" -C "$TMPF"; then
        install -m 0755 "$TMPF"/ffmpeg-*/ffmpeg "$TMPF"/ffmpeg-*/ffprobe /usr/local/bin/ 2>/dev/null || true
      fi
      rm -rf "$TMPF"
    fi
  fi
fi
command -v ffmpeg >/dev/null 2>&1 \
  || die "no ffmpeg, and none could be installed. Nothing can be encoded without it."
ok "Xvfb, ffmpeg, fonts"

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
elif [ "$PKG" != "apt" ]; then
  # EPEL carries chromium for Enterprise Linux, including aarch64 on EL9.
  pkg_install chromium 2>/dev/null || true
  command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1 \
    || die "no chromium available from EPEL for $ARCH.
   The tested path is an Ubuntu 22.04 or 24.04 image; on Oracle Cloud that means
   creating the instance with the image changed from the Oracle Linux default."
  ok "chromium (EPEL)"
elif [ "$ARCH" = "amd64" ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list
  apt-get update
  apt-get install -y -qq google-chrome-stable >/dev/null
  ok "google-chrome-stable"
else
  # No Chrome .deb for this architecture, so: chromium. On Ubuntu that package
  # is a shim for the snap, and going through snapd directly is both faster to
  # explain and the only way to see a 150 MB download happening.
  if command -v snap >/dev/null 2>&1; then
    echo "   waiting for snapd to finish first-boot seeding (can take a few minutes)…"
    snap wait system seed.loaded || true
    echo "   installing the chromium snap — progress below"
    snap install chromium || true
  fi
  if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
    pkg_install chromium || pkg_install chromium-browser || true
  fi
  command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1 \
    || die "no chromium could be installed for $ARCH.
   Try by hand to see why:   sudo snap install chromium"
  ok "chromium ($ARCH)"
fi

# Does it actually run? A snap that cannot start, or a chromium missing a
# library, looks exactly like a working install until the stream is black.
# /snap/bin is not on root's secure_path, so a snap-installed browser is
# invisible to `command -v` under sudo even though it is perfectly installed.
PATH="$PATH:/snap/bin"
BROWSER="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[ -n "$BROWSER" ] || die "a browser was installed but cannot be found on PATH (checked /snap/bin too)."
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
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if [ "$NODE_OK" = "1" ]; then
  ok "node $(node -v) already installed"
else
  # The distribution first. Current Ubuntu and Debian both carry a Node new
  # enough for this, and it is the version that will keep getting security
  # updates from the same place as everything else on the box.
  pkg_install nodejs npm 2>/dev/null || pkg_install nodejs 2>/dev/null || true
  if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 18 ]; then
    ok "node $(node -v) from the distribution"
  else
    # NodeSource keeps per-release repositories and a just-released Ubuntu has
    # no entry for months, so this is the fallback rather than the first move.
    warn "the distribution has no usable node; trying NodeSource"
    if [ "$PKG" = "apt" ]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
    else
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
    fi
    pkg_install nodejs || true
    command -v node >/dev/null 2>&1 \
      || die "node could not be installed from the distribution or NodeSource."
    [ "$(node_major)" -ge 18 ] \
      || die "node $(node -v) is too old; this needs 18 or newer."
    ok "node $(node -v) from NodeSource"
  fi
fi

command -v npm >/dev/null 2>&1 || pkg_install npm || die "npm is missing and could not be installed."

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
