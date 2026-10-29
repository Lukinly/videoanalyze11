#!/bin/sh
set -eu
umask 077
# Garage requires mode 0600. Copy into private tmpfs rather than changing the
# read-only Docker secret mount (whose effective mode depends on the host).
mkdir -p /tmp/garage-secrets
cat /run/secrets/storage_rpc_secret > /tmp/garage-secrets/rpc_secret
chmod 600 /tmp/garage-secrets/rpc_secret
# Read at runtime; credentials are never part of image layers or Compose environment.
export GARAGE_DEFAULT_ACCESS_KEY="$(cat /run/secrets/s3_access_key)"
export GARAGE_DEFAULT_SECRET_KEY="$(cat /run/secrets/s3_secret_key)"
exec /garage "$@"
