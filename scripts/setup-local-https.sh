#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)
COMPOSE_FILE=${COMPOSE_FILE:-$PROJECT_ROOT/infra/docker-compose.yml}
COMPOSE_ENV_FILE=${COMPOSE_ENV_FILE:-$PROJECT_ROOT/.env}
CERT_FILE=${LOCAL_HTTPS_CERT_FILE:-$PROJECT_ROOT/.local/videoanalyze-local-root.crt}
WSL_CA_FILE=/usr/local/share/ca-certificates/videoanalyze-local.crt

validate_certificate() {
  if [[ ! -s "$CERT_FILE" ]]; then
    echo "Caddy root certificate is missing: $CERT_FILE" >&2
    echo "Start the proxy first, then run this script again." >&2
    return 1
  fi

  if ! command -v update-ca-certificates >/dev/null 2>&1; then
    echo "update-ca-certificates is required to trust the local CA in WSL." >&2
    return 1
  fi
}

if [[ "${1:-}" == "--validate" ]]; then
  validate_certificate
  echo "Local HTTPS certificate is ready: $CERT_FILE"
  exit 0
fi

if ! command -v sudo >/dev/null 2>&1 || ! command -v docker >/dev/null 2>&1; then
  echo "sudo and docker are required to bootstrap local HTTPS." >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_ENV_FILE" ]]; then
  echo "Compose environment file is missing: $COMPOSE_ENV_FILE" >&2
  echo "Copy .env.example to .env and configure it first." >&2
  exit 1
fi

compose=(sudo docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE")
mkdir -p "$(dirname -- "$CERT_FILE")"

echo "Starting local HTTPS services without deleting data volumes..."
"${compose[@]}" up -d --build --force-recreate api minio proxy worker

temporary_certificate=$(mktemp)
trap 'rm -f "$temporary_certificate"' EXIT

certificate_ready=false
for ((attempt = 1; attempt <= 30; attempt += 1)); do
  if "${compose[@]}" exec -T proxy cat /data/caddy/pki/authorities/local/root.crt >"$temporary_certificate" 2>/dev/null \
    && grep -q "BEGIN CERTIFICATE" "$temporary_certificate"; then
    certificate_ready=true
    break
  fi
  sleep 1
done

if [[ "$certificate_ready" != true ]]; then
  echo "Caddy returned an invalid or empty root certificate." >&2
  exit 1
fi

install -m 0644 "$temporary_certificate" "$CERT_FILE"
sudo install -m 0644 "$CERT_FILE" "$WSL_CA_FILE"
sudo update-ca-certificates

if command -v powershell.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
  windows_certificate=$(wslpath -w "$CERT_FILE")
  windows_certificate=${windows_certificate//\'/\'\'}
  powershell.exe -NoProfile -Command \
    "\$ErrorActionPreference = 'Stop'; \$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('videoanalyze-local-root-' + [guid]::NewGuid().ToString('N') + '.crt'); try { Copy-Item -LiteralPath '$windows_certificate' -Destination \$temporary; \$imported = Import-Certificate -FilePath \$temporary -CertStoreLocation 'Cert:\\CurrentUser\\Root'; if (\$null -eq \$imported) { exit 1 } } finally { Remove-Item -LiteralPath \$temporary -Force -ErrorAction SilentlyContinue }" >/dev/null
  echo "Installed the local CA into the Windows CurrentUser root store."
else
  echo "Windows certificate import was skipped; import $CERT_FILE into the Windows Trusted Root store if needed." >&2
fi

echo "Local HTTPS CA is ready: $CERT_FILE"
echo "Open https://localhost after restarting the browser if it cached the old certificate state."
