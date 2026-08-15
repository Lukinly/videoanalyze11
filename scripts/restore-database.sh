#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_MAINTENANCE_MODE:?set RESTORE_MAINTENANCE_MODE=1 after removing API traffic}"
[[ "$RESTORE_MAINTENANCE_MODE" == "1" ]] || { printf 'restore requires maintenance mode\n' >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_OBJECT:?BACKUP_OBJECT is required}"
: "${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE is required}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY is required}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY is required}"

restore_tmp_dir="$(mktemp -d)"
cleanup() { rm -rf -- "$restore_tmp_dir"; }
trap cleanup EXIT INT TERM
encrypted_dump="$restore_tmp_dir/restore.dump.age"

mc alias set offsite "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" >/dev/null
mc cp "$BACKUP_OBJECT" "$encrypted_dump"
age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" "$encrypted_dump" \
  | pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL"
node apps/api/dist/db/migrate.js
node apps/worker/dist/retention/run-once.js
printf 'restore, migrations, and retention sweep completed; API traffic may be restored\n'
