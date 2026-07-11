#!/usr/bin/env bash
# Nightly Postgres dump to S3. Cron-installed by server-setup.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
STAMP=$(date +%Y%m%d-%H%M)
docker compose exec -T db pg_dump -U tripbook tripbook | gzip > "/tmp/tripbook-$STAMP.sql.gz"
docker run --rm -v /tmp:/tmp \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION="$AWS_REGION" \
  amazon/aws-cli s3 cp "/tmp/tripbook-$STAMP.sql.gz" "s3://$S3_BUCKET/backups/"
rm "/tmp/tripbook-$STAMP.sql.gz"
