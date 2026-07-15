#!/usr/bin/env bash
# Nightly Postgres dump to S3. Cron-installed by server-setup.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
# Read only the vars we need from .env; never `source` it (values like
# SES_FROM contain <angle brackets> that bash would treat as redirects).
envval() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
AWS_ACCESS_KEY_ID=$(envval AWS_ACCESS_KEY_ID)
AWS_SECRET_ACCESS_KEY=$(envval AWS_SECRET_ACCESS_KEY)
AWS_REGION=$(envval AWS_REGION)
S3_BUCKET=$(envval S3_BUCKET)
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
STAMP=$(date +%Y%m%d-%H%M)
docker compose exec -T db pg_dump -U tripbook tripbook | gzip > "/tmp/tripbook-$STAMP.sql.gz"
docker run --rm -v /tmp:/tmp \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION="$AWS_REGION" \
  amazon/aws-cli s3 cp "/tmp/tripbook-$STAMP.sql.gz" "s3://$S3_BUCKET/backups/"
rm "/tmp/tripbook-$STAMP.sql.gz"
