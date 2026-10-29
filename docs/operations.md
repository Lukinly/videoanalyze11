# Linux deployment notes

> 新公网部署请使用 [Docker 公网部署与 SMTP](docker-production.md) 及 `infra/docker-compose.production.yml`。以下 MinIO/Mailpit 步骤仅保留为历史本地操作参考，不能直接作为当前公网部署方案。

The maintained project is the repository root on `main`. Run all commands below
from that directory. See [README](../README.md) and
[consolidation record](consolidation.md) for the current baseline and known issues.
Older handoff documents retain their original paths and describe historical environments.

For native macOS development without Docker, see [local development](local-development.md).

## Local verification

1. Install Node.js 24+, Corepack, FFmpeg and FFprobe. Docker builds include the media tools and platform downloaders.
2. Copy `.env.example` to `.env` and set the server-side `GROQ_API_KEY` and all three LLM settings. The worker requires the LLM to generate summaries and AI notes. Keys are never placed in the browser bundle.
3. Run `corepack pnpm install`, `corepack pnpm typecheck`, `corepack pnpm lint`, and `corepack pnpm test`.
4. Start the application stack with `docker compose --env-file .env -f infra/docker-compose.yml up -d --build postgres redis minio minio-init migrate mailpit api worker web proxy`. Start `backup` separately after configuring independent backup storage.
5. For WSL development, run `bash scripts/setup-local-https.sh` once after the proxy is up. It exports Caddy's local CA, trusts it in WSL, and imports it into the Windows CurrentUser root store when WSL interop is available. Then open `https://localhost`.
6. After PostgreSQL and the `migrate` service are ready, create the first administrator interactively with `corepack pnpm admin:create --email admin@example.com` (or run `sudo docker compose --env-file .env -f infra/docker-compose.yml run --rm api node dist/cli/admin-create.js --email admin@example.com`).
7. Follow migration and service logs with `sudo docker compose --env-file .env -f infra/docker-compose.yml logs -f migrate api worker`.

The Compose project is named `videoan`; its default containers are consequently named like `videoan-postgres-1`, `videoan-api-1`, and `videoan-worker-1`. The compose file includes PostgreSQL, Redis, MinIO, Mailpit, API, worker, web, and Caddy. In production, replace MinIO credentials, set a real `PUBLIC_HOST`, terminate HTTPS at Caddy, and use a managed PostgreSQL/Redis/S3-compatible service where appropriate.

The `migrate` service applies numbered SQL files once, in lexical order, before the API and worker start. Migration files are append-only: never edit a migration after it has been applied. `docker compose down` preserves the named PostgreSQL, Redis, and MinIO volumes; `docker compose down -v` removes those volumes and therefore deletes user, video, and billing data.

### Browser upload endpoint stages

Local Compose defaults (the local Caddyfile uses an internal CA):

```env
CADDYFILE=Caddyfile
PUBLIC_HOST=https://localhost
STORAGE_HOST=https://storage.localhost
S3_PUBLIC_ENDPOINT=https://storage.localhost
MINIO_API_CORS_ALLOW_ORIGIN=https://localhost,http://localhost
```

The local CA is generated and persisted by Caddy in the `caddy-data` volume. Do not use `docker compose down -v`. If a Windows browser still shows a certificate warning after setup, restart the browser and import `.local/videoanalyze-local-root.crt` into the Windows CurrentUser Trusted Root store.

For temporary server-IP verification:

```env
PUBLIC_HOST=http://SERVER_IP
S3_PUBLIC_ENDPOINT=http://SERVER_IP:9000
MINIO_API_CORS_ALLOW_ORIGIN=http://SERVER_IP
```

After DNS is ready for `example.com` and `storage.example.com`:

```env
CADDYFILE=Caddyfile.production
PUBLIC_HOST=example.com
STORAGE_HOST=storage.example.com
S3_PUBLIC_ENDPOINT=https://storage.example.com
MINIO_API_CORS_ALLOW_ORIGIN=https://example.com
```

The API and worker keep `S3_ENDPOINT=http://minio:9000` in Compose. Rebuild or recreate the API, worker, proxy, and MinIO services after changing these values. Point both website and storage hostnames at the server, allow ports 80 and 443 for Caddy, and close public MinIO ports 9000 and 9001 after the domain stage is verified if the deployment does not require the MinIO console. Verify that the browser upload URL host is `storage.localhost`, `SERVER_IP`, or `storage.example.com` for the active stage; it must never be `minio`.

### Full local upload and analysis check

After the local CA has been installed and the stack is running, verify the supplied MP4 through the real backend pipeline:

```bash
NODE_EXTRA_CA_CERTS="$PWD/.local/videoanalyze-local-root.crt" corepack pnpm verify:local-upload-analysis
```

The default input is `.local/test.mp4`, resolved relative to the repository rather than the shell's working directory. Supply that file locally or set `VIDEO_PATH` to another file. Without `E2E_EMAIL` and `E2E_PASSWORD`, the verifier creates a unique test account through the registration-code API and reads the code from Mailpit. With those variables set, it logs into the existing account instead. The verifier requires configured Groq and LLM providers, uses real worker/provider processing, waits up to 45 minutes, and reports only IDs and counts—not passwords, keys, or complete presigned URLs.

## Retention and limits

Original media and local audio/chunks are cleaned after completion, failure or cancellation. Unprocessed uploads have a 24-hour fallback expiry. Standard results remain available until explicitly deleted; privacy results are intended to expire 24 hours after completion. `ORIGINAL_RETENTION_DAYS` and `RESULT_RETENTION_DAYS` are legacy compatibility settings and do not control that lifecycle. `MAX_UPLOAD_BYTES`, `MAX_VIDEO_DURATION_SECONDS`, queue limits and worker concurrency should be tuned to available CPU, storage and provider quota. See the consolidation record for the lifecycle fixes and validation boundaries.

## Encrypted off-site database backups

The `backup` Compose service runs once at startup and then daily. It streams a custom PostgreSQL dump directly through `age`, excludes data from every `public.ephemeral_*` table, and uploads only the encrypted `.dump.age` object to the independently configured backup S3 service. Daily objects are retained for seven days; Sunday copies are retained in the weekly prefix for 28 days (four weekly copies). Never reuse the media bucket credentials for backups, and keep the age identity outside the repository and container image.

Quarterly, perform a restore drill in an isolated environment. Remove API traffic first and set `RESTORE_MAINTENANCE_MODE=1`; run `scripts/restore-database.sh` with `BACKUP_OBJECT` pointing to the selected encrypted object and `BACKUP_AGE_IDENTITY_FILE` pointing to the mounted private identity. The script restores PostgreSQL, applies migrations, and runs a one-shot retention sweep before it reports that traffic may resume. Verify expired privacy bodies are absent, ordinary results and billing ledger entries remain, and record only object dates/counts—not credentials, filenames, or result bodies—in the drill log.

## Health and security

- `GET /healthz` is a liveness check.
- `GET /readyz` checks database, Redis, and object storage dependencies without returning credentials.
- API responses include `nosniff`, clickjacking, referrer, and restrictive CSP headers.
- Session cookies are HttpOnly. Run the public service behind HTTPS.
- Do not paste `.env`, API keys, signed URLs, or provider responses into logs or issue reports.

## Current Linux verification record

- Runtime: Node.js 24.18.1 in the development environment.
- Media tools: system FFmpeg/FFprobe fixture integration passed.
- Browser: Chromium Playwright smoke test passed.
- Docker daemon: unavailable in the current sandbox, so PostgreSQL/Redis/MinIO/Caddy container startup remains an external deployment check.
