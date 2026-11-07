#!/bin/sh
set -eu

if [ -n "${WORKER_HTTP_PROXY:-}" ]; then
  export HTTP_PROXY="$WORKER_HTTP_PROXY"
  export http_proxy="$WORKER_HTTP_PROXY"
else
  unset HTTP_PROXY http_proxy
fi

if [ -n "${WORKER_HTTPS_PROXY:-}" ]; then
  export HTTPS_PROXY="$WORKER_HTTPS_PROXY"
  export https_proxy="$WORKER_HTTPS_PROXY"
else
  unset HTTPS_PROXY https_proxy
fi

export NO_PROXY="${WORKER_NO_PROXY:-postgres,redis,minio,localhost,127.0.0.1}"
export no_proxy="$NO_PROXY"

exec "$@"
