#!/usr/bin/env bash
# Nightly database backup (cron, set up by setup-ubuntu.sh). Keeps 7 days on the server.
# For off-server copies set BACKUP_S3_URI (e.g. s3://hellogram-backups/pg) in infra/.env.production
# and install the AWS CLI with credentials that can write there.
set -euo pipefail
cd /opt/hellogram
stamp=$(date +%F)
out="backups/hellogram-$stamp.sql.gz"
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production exec -T postgres \
  pg_dump -U hellogram --no-owner hellogram | gzip > "$out.tmp"
mv "$out.tmp" "$out"
find backups -name 'hellogram-*.sql.gz' -mtime +7 -delete
uri=$(grep -E '^BACKUP_S3_URI=' infra/.env.production | cut -d= -f2- || true)
if [ -n "$uri" ] && command -v aws >/dev/null; then
  aws s3 cp "$out" "$uri/$(basename "$out")" --only-show-errors
fi
echo "$(date -Is) backup ok: $out"
