#!/bin/sh
set -eu

if [ -n "${WORKER_HTTP_PROXY:-}" ]; then
  export HTTP_PROXY="$WORKER_HTTP_PROXY"
else
  unset HTTP_PROXY
fi

if [ -n "${WORKER_HTTPS_PROXY:-}" ]; then
  export HTTPS_PROXY="$WORKER_HTTPS_PROXY"
else
  unset HTTPS_PROXY
fi

export NO_PROXY="${WORKER_NO_PROXY:-postgres,redis,minio,localhost,127.0.0.1}"

exec "$@"
