# Linux deployment notes

## Local verification

1. Install Node.js 22+, pnpm, FFmpeg and FFprobe.
2. Copy `.env.example` to `.env` and set the server-side `GROQ_API_KEY`. The key is consumed by the API/worker process only; it is never placed in the browser bundle.
3. Start infrastructure with `docker compose -f infra/docker-compose.yml up -d postgres redis minio minio-init mailpit`.
4. Run `corepack pnpm install`, `corepack pnpm typecheck`, `corepack pnpm lint`, and `corepack pnpm test`.
5. Build the browser client with `corepack pnpm --filter @videoanalyze/web build`.

The Compose project is named `videoan`; its default containers are consequently named like `videoan-postgres-1`, `videoan-api-1`, and `videoan-worker-1`. The compose file includes PostgreSQL, Redis, MinIO, Mailpit, API, worker, web, and Caddy. In production, replace MinIO credentials, set a real `PUBLIC_HOST`, terminate HTTPS at Caddy, and use a managed PostgreSQL/Redis/S3-compatible service where appropriate.

## Retention and limits

`ORIGINAL_RETENTION_DAYS` defaults to 7 and `RESULT_RETENTION_DAYS` defaults to 30. Audio and chunk objects are temporary and are deleted after completion or cancellation. `MAX_UPLOAD_BYTES`, `MAX_VIDEO_DURATION_SECONDS`, `MAX_ACTIVE_RUNS_PER_USER`, and `GLOBAL_WORKER_CONCURRENCY` are read from environment variables and should be tuned to available CPU, storage, and provider quota.

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
