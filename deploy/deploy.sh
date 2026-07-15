#!/usr/bin/env bash
# Production deploy: called by GitHub Actions on merge to main (or by hand).
# Order matters: back up the database BEFORE anything changes, so every
# deploy has a restore point even if a migration misbehaves.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Pre-deploy database backup"
bash deploy/backup.sh

echo "==> Pulling latest main"
git fetch origin main
git reset --hard origin/main

echo "==> Rebuilding and restarting (db volume untouched)"
docker compose up -d --build

echo "==> Waiting for health"
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3000/api/health > /dev/null 2>&1 \
     || docker compose exec -T app wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "==> Healthy. Deploy complete: $(git rev-parse --short HEAD)"
    docker image prune -f > /dev/null
    exit 0
  fi
  sleep 4
done
echo "==> HEALTH CHECK FAILED after deploy. The database backup from the top"
echo "    of this run is in s3://<bucket>/backups/. To roll back the code:"
echo "    git reset --hard <previous-sha> && docker compose up -d --build"
exit 1
