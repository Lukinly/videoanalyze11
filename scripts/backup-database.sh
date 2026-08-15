#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY is required}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY is required}"

backup_tmp_dir="$(mktemp -d)"
cleanup() { rm -rf -- "$backup_tmp_dir"; }
trap cleanup EXIT INT TERM

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
encrypted_dump="$backup_tmp_dir/videoanalyze-$timestamp.dump.age"

pg_dump "$DATABASE_URL" --format=custom --exclude-table-data='public.ephemeral_*' \
  | age --recipient "$BACKUP_AGE_RECIPIENT" > "$encrypted_dump"

mc alias set offsite "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" >/dev/null
mc cp "$encrypted_dump" "offsite/$BACKUP_S3_BUCKET/database/daily/"
if [[ "$(date -u +%u)" == "7" ]]; then
  mc cp "$encrypted_dump" "offsite/$BACKUP_S3_BUCKET/database/weekly/"
fi
mc find "offsite/$BACKUP_S3_BUCKET/database/daily" --older-than 7d --exec "mc rm --force {}" >/dev/null
mc find "offsite/$BACKUP_S3_BUCKET/database/weekly" --older-than 28d --exec "mc rm --force {}" >/dev/null
printf 'encrypted database backup uploaded at %s\n' "$timestamp"
