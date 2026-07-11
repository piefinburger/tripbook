#!/usr/bin/env bash
# Redeploy after a git push. Run on the instance.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull
docker compose build app
docker compose up -d
docker image prune -f
