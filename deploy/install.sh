#!/usr/bin/env bash
# Deploy / update wa-telegram-bridge on this server.
# Usage: REPO_URL=git@github.com:sohailcollege2032008-tech/wa-telegram-bridge.git bash deploy/install.sh
set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:sohailcollege2032008-tech/wa-telegram-bridge.git}"
TARGET="${TARGET:-/opt/wa-telegram-bridge}"
SERVICE=wa-telegram-bridge

if [ ! -d "$TARGET/.git" ]; then
  sudo mkdir -p "$TARGET"
  sudo chown "$(id -u):$(id -g)" "$TARGET"
  git clone "$REPO_URL" "$TARGET"
else
  git -C "$TARGET" pull --ff-only
fi

cd "$TARGET"
npm install --omit=dev

if [ ! -f "$TARGET/.env" ]; then
  cp "$TARGET/.env.example" "$TARGET/.env"
  chmod 600 "$TARGET/.env"
  echo "!! Edit $TARGET/.env (TELEGRAM_BOT_TOKEN, WHATSAPP_PHONE) before starting."
fi

sudo install -m 644 "$TARGET/deploy/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE"
sudo systemctl restart "$SERVICE"
sudo systemctl --no-pager status "$SERVICE" | head -12
