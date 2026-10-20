#!/usr/bin/env bash
#
# tools/broadcast/install_ingest.sh — Echo Radar's RTMP server (MediaMTX) on the
# 24/7 broadcast box, so chasers' OBS streams land on a machine with a public
# IP and free bandwidth instead of the main app's home connection.
#
# No DNS records and no certificates: OBS connects to this box's IP on port
# 1935, and viewers reach the video through a Cloudflare Tunnel on this box.
#
#   cd ~/VortexRadar && git pull
#   sudo bash tools/broadcast/install_ingest.sh <MEDIAMTX_HOOK_SECRET> --tunnel-token <TOKEN>
#
# The secret must be the SAME value as MEDIAMTX_HOOK_SECRET in the MAIN app's
# .env (make one with: openssl rand -hex 32). Options:
#   --tunnel-token TOKEN  install the Cloudflare Tunnel connector with this token
#                         (Cloudflare dashboard > Networking > Tunnels > Create a
#                         tunnel > copy the token from the install command).
#                         Leave it out if this box already runs that tunnel.
#   --app URL             the main Echo Radar app (default https://echoradarwx.com)
#
# What it does: installs MediaMTX (latest release) as the `mediamtx` service
# with tools/mediamtx.yml; Caddy as a local-only router on 127.0.0.1:8099
# (HLS + status API) for the tunnel to publish; opens TCP 1935 in this box's
# firewall; and, with --tunnel-token, cloudflared. It does not touch the
# 24/7 broadcast.
#
# Still to do by hand (it prints these at the end):
#   - Oracle Cloud console: allow TCP 1935 in the subnet's security list
#   - Cloudflare tunnel: route stream.echoradarwx.com -> http://localhost:8099
#   - main app .env, then restart it

set -euo pipefail

SECRET="${1:-}"
APP_URL="https://echoradarwx.com"
TUNNEL_TOKEN=""
shift || true
while [ $# -gt 0 ]; do
    case "$1" in
        --tunnel-token) TUNNEL_TOKEN="$2"; shift 2 ;;
        --app) APP_URL="${2%/}"; shift 2 ;;
        *) echo "unknown option: $1" >&2; exit 1 ;;
    esac
done
if [ -z "$SECRET" ] || [ "${SECRET#--}" != "$SECRET" ]; then
    echo "usage: sudo bash tools/broadcast/install_ingest.sh <MEDIAMTX_HOOK_SECRET> [--tunnel-token TOKEN] [--app URL]" >&2
    exit 1
fi
if ! printf '%s' "$SECRET" | grep -Eq '^[A-Za-z0-9_-]{16,}$'; then
    echo "The secret should be 16+ letters/digits (openssl rand -hex 32 makes one)." >&2
    exit 1
fi
[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

case "$(uname -m)" in
    aarch64|arm64) ARCH=arm64 ;;
    x86_64|amd64) ARCH=amd64 ;;
    armv7l) ARCH=armv7 ;;
    *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

echo "== MediaMTX"
TAG="$(curl -fsSL https://api.github.com/repos/bluenviron/mediamtx/releases/latest | grep -m1 '"tag_name"' | cut -d'"' -f4)"
[ -n "$TAG" ] || { echo "Could not find the latest MediaMTX release." >&2; exit 1; }
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/mediamtx.tar.gz" "https://github.com/bluenviron/mediamtx/releases/download/${TAG}/mediamtx_${TAG}_linux_${ARCH}.tar.gz"
tar -xzf "$TMP/mediamtx.tar.gz" -C "$TMP" mediamtx
install -m 755 "$TMP/mediamtx" /usr/local/bin/mediamtx
rm -rf "$TMP"
echo "   installed $TAG"

id mediamtx >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin mediamtx
mkdir -p /etc/mediamtx
sed -e "s#CHANGE_ME_TO_THE_SAME_SECRET#${SECRET}#" \
    -e "s#https://echoradarwx.com/internal/#${APP_URL}/internal/#" \
    "$ROOT/tools/mediamtx.yml" > /etc/mediamtx/mediamtx.yml
chown root:mediamtx /etc/mediamtx/mediamtx.yml
chmod 640 /etc/mediamtx/mediamtx.yml      # it holds the secret
install -m 644 "$ROOT/tools/broadcast/mediamtx.service" /etc/systemd/system/mediamtx.service

echo "== Caddy (local router on 127.0.0.1:8099 for the tunnel)"
command -v caddy >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq caddy; }
mkdir -p /etc/caddy
if [ -f /etc/caddy/Caddyfile ] && ! grep -q 'echo-radar-ingest' /etc/caddy/Caddyfile; then
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M%S)"
    echo "   kept the old Caddyfile as /etc/caddy/Caddyfile.bak-*"
fi
install -m 644 "$ROOT/tools/broadcast/Caddyfile.ingest" /etc/caddy/Caddyfile

echo "== Firewall (TCP 1935 for OBS)"
# Oracle's Ubuntu images ship iptables rules that REJECT everything but SSH;
# the ACCEPT has to go above that line.
if command -v iptables >/dev/null 2>&1; then
    if ! iptables -C INPUT -p tcp --dport 1935 -m state --state NEW -j ACCEPT 2>/dev/null; then
        at="$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')"
        if [ -n "$at" ]; then iptables -I INPUT "$at" -p tcp --dport 1935 -m state --state NEW -j ACCEPT
        else iptables -A INPUT -p tcp --dport 1935 -m state --state NEW -j ACCEPT; fi
    fi
    if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save >/dev/null
    elif [ -d /etc/iptables ]; then iptables-save > /etc/iptables/rules.v4; fi
fi
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
    ufw allow 1935/tcp >/dev/null
fi

if [ -n "$TUNNEL_TOKEN" ]; then
    echo "== Cloudflare Tunnel connector"
    if ! command -v cloudflared >/dev/null 2>&1; then
        mkdir -p --mode=0755 /usr/share/keyrings
        curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
        echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
        apt-get update -qq && apt-get install -y -qq cloudflared
    fi
    if systemctl list-unit-files cloudflared.service >/dev/null 2>&1 && systemctl is-enabled cloudflared >/dev/null 2>&1; then
        echo "   cloudflared is already installed as a service here; leaving it as it is."
        echo "   (To switch it to this token: sudo cloudflared service uninstall, then run this again.)"
    else
        cloudflared service install "$TUNNEL_TOKEN"
    fi
fi

echo "== Starting"
systemctl daemon-reload
systemctl enable --now mediamtx
systemctl restart mediamtx
systemctl enable --now caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 2
systemctl --no-pager --lines=0 status mediamtx caddy | grep -E '●|Active:' || true
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8099/v3/paths/list || true)"
echo "   local router answers: HTTP $code (401 is right: only Echo Radar may read it)"

IP="$(curl -fsS4 https://ifconfig.me 2>/dev/null || echo '<this box public IP>')"
cat <<EOF

Done on this box. What is left:

1. Oracle Cloud console: Networking > Virtual cloud networks > your VCN >
   Security Lists > Default Security List > Add Ingress Rules:
   source 0.0.0.0/0, TCP, destination port 1935.

2. Cloudflare: Networking > Tunnels > this box's tunnel > Routes > Add route >
   Published application:
     subdomain stream   domain echoradarwx.com   service HTTP  localhost:8099
   (Cloudflare makes the DNS entry for it by itself.)

3. The MAIN app's .env (the box people use), then restart it:
     MEDIAMTX_HOOK_SECRET=<the same secret>
     RTMP_PUBLIC_URL=rtmp://${IP}/live
     MEDIAMTX_HLS_PUBLIC_URL=https://stream.echoradarwx.com
     MEDIAMTX_API_URL=https://stream.echoradarwx.com

Check: the Chase Stream Hub should say "Waiting for OBS" under Your Echo Radar
stream server. Logs: journalctl -u mediamtx -f   journalctl -u cloudflared -f
EOF
