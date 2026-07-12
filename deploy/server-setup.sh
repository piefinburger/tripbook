#!/usr/bin/env bash
# Run ON the new Lightsail instance (Ubuntu 24.04) as the default user.
set -euo pipefail
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"

# Idempotent: skip the clone if the repo is already present (e.g. cloned
# over SSH with a deploy key before running this script).
if [ ! -d ~/tripbook/.git ]; then
  git clone https://github.com/piefinburger/tripbook.git ~/tripbook
fi
cd ~/tripbook
[ -f .env ] || cp .env.example .env
echo
echo "Now: edit ~/tripbook/.env (secrets), then run:"
echo "  newgrp docker && cd ~/tripbook && docker compose up -d --build"
echo "Then install the backup cron:"
echo "  (crontab -l 2>/dev/null; echo '15 7 * * * /home/ubuntu/tripbook/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1') | crontab -"
