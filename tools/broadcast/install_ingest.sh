#!/usr/bin/env bash
#
# tools/broadcast/install_ingest.sh — Echo Radar's RTMP server (nginx with its
# RTMP module) on the 24/7 broadcast box, so chasers' OBS streams land on a
# machine with a public IP and free bandwidth instead of the main app's home
# connection.
#
# No DNS records and no certificates: OBS connects to this box's IP on port
# 1935, and viewers reach the video through a Cloudflare Tunnel on this box.
#
#   cd ~/VortexRadar && git pull
#   sudo bash tools/broadcast/install_ingest.sh <INGEST_SECRET> --tunnel-token <TOKEN>
#
# The secret must be the SAME value as INGEST_SECRET in the MAIN app's .env
# (make one with: openssl rand -hex 32). Options:
#   --tunnel-token TOKEN  install the Cloudflare Tunnel connector with this token
#                         (Cloudflare dashboard > Networking > Tunnels > Create a
#                         tunnel > copy the token from the install command).
#                         Leave it out if this box already runs that tunnel.
#   --app URL             the main Echo Radar app (default https://echoradarwx.com)
#
# What it does: installs nginx + libnginx-mod-rtmp from Ubuntu with
# tools/broadcast/nginx-rtmp.conf (RTMP on :1935) and nginx-ingest.conf (local
# HTTP on 127.0.0.1:8098/8099); switches off an earlier MediaMTX + Caddy
# setup; opens TCP 1935 in this box's firewall; and, with --tunnel-token,
# cloudflared. Safe to run again. It does not touch the 24/7 broadcast.
#
# Still to do by hand (it prints these at the end):
#   - Oracle Cloud console: allow TCP 1935 in the subnet's security list
#   - Cloudflare tunnel: route stream.echoradarwx.com -> http://localhost:8099

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
    echo "usage: sudo bash tools/broadcast/install_ingest.sh <INGEST_SECRET> [--tunnel-token TOKEN] [--app URL]" >&2
    exit 1
fi
if ! printf '%s' "$SECRET" | grep -Eq '^[A-Za-z0-9_-]{16,}$'; then
    echo "The secret should be 16+ letters/digits (openssl rand -hex 32 makes one)." >&2
    exit 1
fi
if ! printf '%s' "$APP_URL" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'; then
    echo "--app should look like https://echoradarwx.com" >&2
    exit 1
fi
[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

echo "== Switching off the earlier MediaMTX setup (if any)"
if systemctl list-unit-files mediamtx.service 2>/dev/null | grep -q mediamtx; then
    systemctl disable --now mediamtx 2>/dev/null || true
    echo "   mediamtx stopped and disabled"
fi
if [ -f /etc/caddy/Caddyfile ] && grep -q 'echo-radar-ingest' /etc/caddy/Caddyfile; then
    systemctl disable --now caddy 2>/dev/null || true   # it only served the old setup, on port 8099
    echo "   caddy (the old router on 8099) stopped and disabled"
fi

echo "== nginx + RTMP module"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx libnginx-mod-rtmp

mkdir -p /var/lib/echo-hls
chown www-data:www-data /var/lib/echo-hls

install -m 644 "$ROOT/tools/broadcast/nginx-rtmp.conf" /etc/nginx/echo-radar-rtmp.conf
sed -e "s#CHANGE_ME_TO_THE_SAME_SECRET#${SECRET}#g" \
    -e "s#https://echoradarwx.com/internal/#${APP_URL}/internal/#" \
    "$ROOT/tools/broadcast/nginx-ingest.conf" > /etc/nginx/conf.d/echo-radar-ingest.conf
chmod 600 /etc/nginx/conf.d/echo-radar-ingest.conf      # it holds the secret

# The rtmp block has to sit outside http, so it is included at the end of nginx.conf.
grep -q 'echo-radar-rtmp.conf' /etc/nginx/nginx.conf || \
    printf '\n# Echo Radar RTMP server (tools/broadcast/install_ingest.sh)\ninclude /etc/nginx/echo-radar-rtmp.conf;\n' >> /etc/nginx/nginx.conf
# One worker: rtmp_stat only reports the streams of the worker that answers,
# and one worker easily carries a few chase streams (no re-encoding happens).
sed -i -E 's/^(\s*)worker_processes\s+[^;]+;/\1worker_processes 1;/' /etc/nginx/nginx.conf
# The stock "Welcome to nginx" site on port 80 is not needed.
rm -f /etc/nginx/sites-enabled/default

nginx -t

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
systemctl enable nginx >/dev/null 2>&1
systemctl restart nginx
sleep 2
systemctl --no-pager --lines=0 status nginx | grep -E '●|Active:' || true

stat_code="$(curl -s -o /dev/null -w '%{http_code}' -H "X-Ingest-Secret: ${SECRET}" http://127.0.0.1:8099/stat || true)"
hook_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -d 'app=live&name=0000000000&pass=test' http://127.0.0.1:8098/publish || true)"
echo "   stream status page: HTTP $stat_code (200 is right)"
case "$hook_code" in
    401) echo "   key check: OK, Echo Radar answered and refused a made-up key, as it should" ;;
    403) echo "   key check: Echo Radar answered but the secret does not match INGEST_SECRET in its .env" ;;
    404) echo "   key check: Echo Radar answered but does not have the new code yet (update and restart it)" ;;
    *)   echo "   key check: could not reach Echo Radar at ${APP_URL} (HTTP $hook_code); is it running with INGEST_SECRET set?" ;;
esac

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

3. The MAIN app's .env (the box people use) needs INGEST_SECRET=<the same secret>.
   This box's IP is ${IP}; if that is not 193.122.152.119, also set
     RTMP_PUBLIC_URL=rtmp://${IP}/live

Check: the Chase Stream Hub should say "Waiting for OBS" under Your Echo Radar
stream server. Logs: journalctl -u nginx -f   journalctl -u cloudflared -f
Refused keys show in the main app's log as "[ingest] refused a stream key".
EOF
