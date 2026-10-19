#!/usr/bin/env bash
#
# tools/broadcast/install_ingest.sh — Echo Radar's RTMP server (MediaMTX) on the
# 24/7 broadcast box, so chasers' OBS streams land on a machine with a public
# IP and free bandwidth instead of the main app's home connection.
#
#   cd ~/VortexRadar && git pull
#   sudo bash tools/broadcast/install_ingest.sh <MEDIAMTX_HOOK_SECRET>
#
# The secret must be the SAME value as MEDIAMTX_HOOK_SECRET in the MAIN app's
# .env (make one with: openssl rand -hex 32). Options:
#   --host NAME   public name for RTMP and HLS   (default ingest.echoradarwx.com)
#   --app URL     the main Echo Radar app        (default https://echoradarwx.com)
#
# What it does: installs MediaMTX (latest release) as the `mediamtx` service
# with tools/mediamtx.yml, installs Caddy to put MediaMTX's HLS and status API
# on https://<host> with an automatic certificate, and opens TCP 80, 443 and
# 1935 in this box's firewall. It changes nothing about the broadcast itself.
#
# Still to do by hand (it prints these at the end):
#   - Oracle Cloud console: allow TCP 80, 443, 1935 in the subnet's security list
#   - Cloudflare DNS: A record <host> -> this box's public IP, DNS only (grey cloud)
#   - main app .env: MEDIAMTX_HLS_PUBLIC_URL and MEDIAMTX_API_URL, then restart it

set -euo pipefail

SECRET="${1:-}"
HOST_NAME="ingest.echoradarwx.com"
APP_URL="https://echoradarwx.com"
shift || true
while [ $# -gt 0 ]; do
    case "$1" in
        --host) HOST_NAME="$2"; shift 2 ;;
        --app) APP_URL="${2%/}"; shift 2 ;;
        *) echo "unknown option: $1" >&2; exit 1 ;;
    esac
done
if [ -z "$SECRET" ] || [ "${SECRET#--}" != "$SECRET" ]; then
    echo "usage: sudo bash tools/broadcast/install_ingest.sh <MEDIAMTX_HOOK_SECRET> [--host NAME] [--app URL]" >&2
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

echo "== Caddy (HTTPS for $HOST_NAME)"
command -v caddy >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq caddy; }
mkdir -p /etc/caddy
if [ -f /etc/caddy/Caddyfile ] && ! grep -q 'echo-radar-ingest' /etc/caddy/Caddyfile; then
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M%S)"
    echo "   kept the old Caddyfile as /etc/caddy/Caddyfile.bak-*"
fi
sed "s#ingest.echoradarwx.com#${HOST_NAME}#" "$ROOT/tools/broadcast/Caddyfile.ingest" > /etc/caddy/Caddyfile

echo "== Firewall (TCP 80, 443, 1935)"
# Oracle's Ubuntu images ship iptables rules that REJECT everything but SSH;
# the ACCEPTs have to go above that line.
if command -v iptables >/dev/null 2>&1; then
    for port in 80 443 1935; do
        if ! iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
            at="$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')"
            if [ -n "$at" ]; then iptables -I INPUT "$at" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
            else iptables -A INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT; fi
        fi
    done
    if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save >/dev/null
    elif [ -d /etc/iptables ]; then iptables-save > /etc/iptables/rules.v4; fi
fi
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 1935/tcp >/dev/null
fi

echo "== Starting"
systemctl daemon-reload
systemctl enable --now mediamtx
systemctl restart mediamtx
systemctl enable --now caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 2
systemctl --no-pager --lines=0 status mediamtx caddy | grep -E '●|Active:' || true

IP="$(curl -fsS4 https://ifconfig.me 2>/dev/null || echo '<this box public IP>')"
cat <<EOF

Done on this box. Three things left:

1. Oracle Cloud console: Networking > Virtual cloud networks > your VCN >
   Security lists (or the instance's subnet) > Add ingress rules:
   source 0.0.0.0/0, TCP, destination ports 80, 443 and 1935.

2. Cloudflare DNS for echoradarwx.com: A record
     name ${HOST_NAME%%.*}   value ${IP}   Proxy status: DNS only (grey cloud)
   Caddy fetches the HTTPS certificate by itself once that resolves.

3. The MAIN app's .env (the box people use), then restart it:
     MEDIAMTX_HOOK_SECRET=<the same secret>
     MEDIAMTX_HLS_PUBLIC_URL=https://${HOST_NAME}
     MEDIAMTX_API_URL=https://${HOST_NAME}
     RTMP_PUBLIC_URL=rtmp://${HOST_NAME}/live

Check: the Chase Stream Hub should say "Waiting for OBS" under Your Echo Radar
stream server. Logs: journalctl -u mediamtx -f   and   journalctl -u caddy -f
EOF
