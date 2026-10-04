#!/usr/bin/env bash
# One-shot setup for the Riverwalk Presage server on a fresh Ubuntu 24.04 VM
# (Vultr Cloud Compute). Run as root over SSH:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/veermshah/rowdyhacks/feature/riverwalk-presage-challenge/server/deploy/vultr-setup.sh)
#
# Re-run it any time to pull the latest code and rebuild. It asks for the
# Presage API key only the first time (stored in /opt/lootrun/server/.env).
set -euo pipefail

REPO="https://github.com/veermshah/rowdyhacks.git"
BRANCH="${BRANCH:-feature/riverwalk-presage-challenge}"
DIR="/opt/lootrun"
CORS="https://rowdyhacks-green.vercel.app,http://localhost:5173"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (or with sudo)."; exit 1; }
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Installing Docker and git"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 git curl >/dev/null
systemctl enable --now docker >/dev/null

say "Getting the code ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi

ENV_FILE="$DIR/server/.env"
if ! grep -q '^PRESAGE_API_KEY=.\+' "$ENV_FILE" 2>/dev/null; then
  say "Presage API key"
  read -r -s -p "Paste your PRESAGE_API_KEY (input hidden), then press Enter: " KEY </dev/tty
  echo
  [ -n "$KEY" ] || { echo "No key entered."; exit 1; }
  umask 077
  cat > "$ENV_FILE" <<EOF
PRESAGE_API_KEY=$KEY
CORS_ORIGINS=$CORS
RIVERWALK_DEV_MODE=0
EOF
fi

say "Working out this server's public address"
IP="$(curl -fsS -m 5 http://169.254.169.254/v1/interfaces/0/ipv4/address 2>/dev/null || curl -fsS -m 10 https://api.ipify.org)"
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"   # free hostname that resolves to IP, so HTTPS works
echo "DOMAIN=$DOMAIN" > "$DIR/server/deploy/.env"
echo "  $DOMAIN -> $IP"

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  say "Opening ports 80/443 in the firewall"
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

say "Building and starting (first build takes a few minutes)"
cd "$DIR/server/deploy"
docker compose up -d --build

say "Waiting for HTTPS + the Presage server"
for i in $(seq 1 60); do
  if curl -fsS -m 5 "https://$DOMAIN/health" >/tmp/health.json 2>/dev/null; then
    echo "  $(cat /tmp/health.json)"
    say "Done!"
    echo "  Server:  https://$DOMAIN"
    echo "  Game:    https://rowdyhacks-green.vercel.app/?server=https://$DOMAIN"
    echo "  Logs:    cd $DIR/server/deploy && docker compose logs -f presage"
    exit 0
  fi
  sleep 5
done
echo "HTTPS isn't answering yet. Check: cd $DIR/server/deploy && docker compose logs caddy presage"
exit 1
