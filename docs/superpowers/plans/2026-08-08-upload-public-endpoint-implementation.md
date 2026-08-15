# Browser Upload Public Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser uploads work through a staged local/IP/domain deployment path while keeping Docker-internal MinIO access separate from browser-facing signed URLs.

**Architecture:** Keep `S3_ENDPOINT` for API/worker traffic and `S3_PUBLIC_ENDPOINT` for presigned browser URLs. Add a Caddy storage host that proxies a pathless host to MinIO, preserves the signed `Host` header, and is used locally and after HTTPS domain setup; keep direct `SERVER_IP:9000` as the temporary IP-test endpoint. Configure MinIO CORS from the website origin through Compose.

**Tech Stack:** TypeScript, Vitest, Docker Compose, MinIO, Caddy, Fastify, pnpm workspace.

## Global Constraints

- Preserve all existing mixed working-tree changes; edit only files listed in each task.
- Never expose `minio` or a Docker-only hostname in a browser-facing signed URL.
- Do not proxy video bytes through the API; browser uploads remain direct PUTs to the signed object-storage URL.
- Do not configure `S3_PUBLIC_ENDPOINT` with a URL path prefix; the S3 signature must cover the same path received by MinIO.
- Production must set an explicit `S3_PUBLIC_ENDPOINT`; local Compose may provide the local `storage.localhost` default.
- Keep the existing PostgreSQL, Redis, MinIO, and Caddy named volumes; do not use `docker compose down -v`.
- Do not log complete signed URLs, credentials, or provider secrets.

---

### Task 1: Guard the production public endpoint configuration

**Files:**
- Modify: `apps/api/src/config/env.test.ts`
- Modify: `apps/api/src/config/env.ts`

**Interfaces:**
- Consumes: `parseEnv(source)` with the existing `AppEnv` return shape.
- Produces: the same `AppEnv` shape, with `s3PublicEndpoint` guaranteed to be an explicit valid HTTP(S) URL in production and a pathless URL in every environment.

- [ ] **Step 1: Write failing tests for the production and path rules**

Add tests to `apps/api/src/config/env.test.ts`:

```ts
it("requires an explicit browser-facing endpoint in production", async () => {
  const { parseEnv } = await import("./env.js");

  expect(() => parseEnv({
    NODE_ENV: "production",
    GROQ_API_KEY: "test-key"
  })).toThrow("S3_PUBLIC_ENDPOINT is required in production");
});

it("rejects a public endpoint with a path prefix", async () => {
  const { parseEnv } = await import("./env.js");

  expect(() => parseEnv({
    NODE_ENV: "development",
    GROQ_API_KEY: "test-key",
    S3_PUBLIC_ENDPOINT: "http://storage.localhost/storage"
  })).toThrow("S3_PUBLIC_ENDPOINT must not contain a path");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
corepack pnpm exec vitest run apps/api/src/config/env.test.ts
```

Expected: the new production and path-prefix assertions fail because the current parser silently falls back and accepts any string.

- [ ] **Step 3: Implement the minimal environment validation**

In `apps/api/src/config/env.ts`:

1. Read `source.S3_PUBLIC_ENDPOINT?.trim()` before constructing the returned object.
2. If `nodeEnv === "production"` and the value is empty or absent, throw exactly `S3_PUBLIC_ENDPOINT is required in production`.
3. Use the explicit value when present, otherwise retain the existing development/test fallback to `source.S3_ENDPOINT ?? "http://127.0.0.1:9000"`.
4. Parse the selected value with `new URL(...)`; throw `S3_PUBLIC_ENDPOINT must be an http or https URL` for malformed or non-HTTP(S) values.
5. Reject any pathname other than `/`, and reject query strings or fragments, with `S3_PUBLIC_ENDPOINT must not contain a path`.
6. Store the normalized URL without its trailing `/` in `s3PublicEndpoint`.

- [ ] **Step 4: Run the focused tests and the API typecheck**

Run:

```bash
corepack pnpm exec vitest run apps/api/src/config/env.test.ts
corepack pnpm typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Review the diff without staging unrelated files**

Run:

```bash
git diff -- apps/api/src/config/env.ts apps/api/src/config/env.test.ts
```

Confirm that only the public-endpoint validation and its tests changed.

### Task 2: Add local and production Caddy/Compose storage routing

**Files:**
- Modify: `tests/acceptance/deployment-config.test.ts`
- Modify: `infra/docker-compose.yml`
- Modify: `infra/reverse-proxy/Caddyfile`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `PUBLIC_HOST`, `STORAGE_HOST`, `S3_PUBLIC_ENDPOINT`, and `MINIO_API_CORS_ALLOW_ORIGIN` from the project `.env`/Compose interpolation.
- Produces: a local `storage.localhost` route and a production `storage.example.com` route that forward to `minio:9000` without changing the signed host or path.

- [ ] **Step 1: Write failing deployment-config assertions**

Extend `tests/acceptance/deployment-config.test.ts` with assertions that:

```ts
it("wires public and storage hosts into the proxy and API", () => {
  const compose = readFileSync(new URL("../../infra/docker-compose.yml", import.meta.url), "utf8");
  const caddy = readFileSync(new URL("../../infra/reverse-proxy/Caddyfile", import.meta.url), "utf8");
  const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");

  expect(compose).toContain("S3_PUBLIC_ENDPOINT: ${S3_PUBLIC_ENDPOINT:-http://storage.localhost}");
  expect(compose).toContain("MINIO_API_CORS_ALLOW_ORIGIN: ${MINIO_API_CORS_ALLOW_ORIGIN:-http://localhost,https://localhost}");
  expect(compose).toContain("PUBLIC_HOST: ${PUBLIC_HOST:-http://localhost}");
  expect(compose).toContain("STORAGE_HOST: ${STORAGE_HOST:-http://storage.localhost}");
  expect(caddy).toContain("{$STORAGE_HOST:http://storage.localhost}");
  expect(caddy).toContain("reverse_proxy minio:9000");
  expect(caddy).toContain("header_up Host {http.request.host}");
  expect(envExample).toContain("PUBLIC_HOST=http://localhost");
  expect(envExample).toContain("STORAGE_HOST=http://storage.localhost");
  expect(envExample).toContain("S3_PUBLIC_ENDPOINT=http://storage.localhost");
  expect(envExample).toContain("MINIO_API_CORS_ALLOW_ORIGIN=http://localhost,https://localhost");
});
```

- [ ] **Step 2: Run the deployment test and verify the new assertions fail**

Run:

```bash
corepack pnpm exec vitest run tests/acceptance/deployment-config.test.ts
```

Expected: the new configuration assertions fail because the storage host, proxy environment, and CORS wiring do not exist yet.

- [ ] **Step 3: Implement Compose and Caddy wiring**

Make these exact configuration changes:

1. In the `minio.environment` block, add:

```yaml
      MINIO_API_CORS_ALLOW_ORIGIN: ${MINIO_API_CORS_ALLOW_ORIGIN:-http://localhost,https://localhost}
```

2. Change the API fallback to:

```yaml
S3_PUBLIC_ENDPOINT: ${S3_PUBLIC_ENDPOINT:-http://storage.localhost}
```

3. In `proxy`, add:

```yaml
environment:
  PUBLIC_HOST: ${PUBLIC_HOST:-http://localhost}
  STORAGE_HOST: ${STORAGE_HOST:-http://storage.localhost}
```

4. Add `minio` to `proxy.depends_on` so the storage upstream is part of the declared service graph.

5. Keep the existing MinIO host ports for local console access and temporary server-IP verification; production instructions will explain that the public storage subdomain should be used after HTTPS is enabled.

6. Keep the existing website/API site block in `infra/reverse-proxy/Caddyfile` and append:

```caddyfile
{$STORAGE_HOST:http://storage.localhost} {
  reverse_proxy minio:9000 {
    header_up Host {http.request.host}
  }
}
```

The route must have no `/storage` path prefix. The `Host` override preserves the host signed by the AWS SDK presigner.

7. Replace the existing public storage example in `.env.example` and add the host/CORS examples near it:

```env
PUBLIC_HOST=http://localhost
STORAGE_HOST=http://storage.localhost
S3_PUBLIC_ENDPOINT=http://storage.localhost
MINIO_API_CORS_ALLOW_ORIGIN=http://localhost,https://localhost
```

- [ ] **Step 4: Run static deployment verification**

Run:

```bash
corepack pnpm exec vitest run tests/acceptance/deployment-config.test.ts
docker compose -f infra/docker-compose.yml config --quiet
```

Expected: both commands pass, and Compose resolves the default local public endpoint to `http://storage.localhost`.

- [ ] **Step 5: Review the configuration diff**

Run:

```bash
git diff -- .env.example infra/docker-compose.yml infra/reverse-proxy/Caddyfile tests/acceptance/deployment-config.test.ts
```

Confirm that no API/worker internal endpoint changed from `http://minio:9000`.

### Task 3: Document IP-to-domain deployment handoff

**Files:**
- Modify: `docs/operations.md`

**Interfaces:**
- Consumes: the environment variables and Caddy host routing from Task 2.
- Produces: copyable local, server-IP, and domain configuration blocks and a safe verification sequence.

- [ ] **Step 1: Add the staged configuration examples**

Update `docs/operations.md` with this operational section:

### Browser upload endpoint stages

Local Compose defaults:

```env
PUBLIC_HOST=http://localhost
STORAGE_HOST=http://storage.localhost
S3_PUBLIC_ENDPOINT=http://storage.localhost
MINIO_API_CORS_ALLOW_ORIGIN=http://localhost,https://localhost
```

For temporary server-IP verification:

```env
PUBLIC_HOST=http://SERVER_IP
S3_PUBLIC_ENDPOINT=http://SERVER_IP:9000
MINIO_API_CORS_ALLOW_ORIGIN=http://SERVER_IP
```

After DNS is ready for `example.com` and `storage.example.com`:

```env
PUBLIC_HOST=example.com
STORAGE_HOST=storage.example.com
S3_PUBLIC_ENDPOINT=https://storage.example.com
MINIO_API_CORS_ALLOW_ORIGIN=https://example.com
```

The API and worker keep `S3_ENDPOINT=http://minio:9000` in Compose. Rebuild/recreate API, worker, proxy, and MinIO after changing these values. Verify that the browser upload URL host is `storage.localhost`, `SERVER_IP`, or `storage.example.com` for the active stage; it must never be `minio`.

2. Add a DNS and firewall note: point both website and storage hostnames at the server, allow 80/443 for Caddy, and close public MinIO 9000/9001 access after the domain stage is verified if the deployment does not require the console.

3. Keep the existing warning that `docker compose down -v` deletes data and do not add it to the verification sequence.

- [ ] **Step 2: Run documentation and whitespace checks**

Run:

```bash
git diff --check
rg -n "SERVER_IP|storage\.example\.com|S3_PUBLIC_ENDPOINT|down -v" docs/operations.md
```

Expected: the three staged examples and the data-loss warning are present.

### Task 4: Run the complete local code verification suite

**Files:**
- No source changes; inspect all changes from Tasks 1–3.

**Interfaces:**
- Consumes: the updated parser, Compose/Caddy configuration, tests, and operations documentation.
- Produces: evidence that the repository-level checks pass before any container deployment.

- [ ] **Step 1: Run all unit and acceptance tests**

Run:

```bash
corepack pnpm test
corepack pnpm test:acceptance
```

Expected: all Vitest files pass, including the deployment configuration tests.

- [ ] **Step 2: Run static checks and build**

Run:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
git diff --check
docker compose -f infra/docker-compose.yml config --quiet
```

Expected: every command exits with status 0. Existing Vitest workspace deprecation warnings are acceptable if no test fails.

- [ ] **Step 3: Inspect the final scoped diff**

Run:

```bash
git diff -- apps/api/src/config/env.ts apps/api/src/config/env.test.ts infra/docker-compose.yml infra/reverse-proxy/Caddyfile .env.example docs/operations.md tests/acceptance/deployment-config.test.ts
```

Confirm that the diff contains no credentials, signed URLs, unrelated refactors, or destructive commands.

### Task 5: Verify the real local Compose upload path

**Files:**
- No source changes unless an integration failure identifies a concrete defect; any such defect must first be isolated with the relevant test and fixed in the owning file.

**Interfaces:**
- Consumes: the built API/worker/web/proxy images and local `.env`.
- Produces: runtime evidence for health, readiness, email delivery, browser-facing signed host, CORS, and a real small-file PUT.

- [ ] **Step 1: Check current service state without deleting volumes**

Run:

```bash
docker compose -f infra/docker-compose.yml ps
```

If Docker socket permission is denied, rerun the Docker commands with the environment-approved elevated permission; do not change file ownership or use `docker compose down -v`.

- [ ] **Step 2: Rebuild and start the stack**

Run:

```bash
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml ps
```

Expected: postgres, redis, minio, migrate, mailpit, api, worker, web, and proxy are running or completed successfully as appropriate.

- [ ] **Step 3: Check health and readiness**

Run:

```bash
curl --fail http://localhost/healthz
curl --fail http://localhost/readyz
curl --fail http://localhost:9000/minio/health/live
```

Expected: all commands return successful HTTP responses.

- [ ] **Step 4: Check the storage proxy and CORS preflight**

Create a local OPTIONS request for the storage host:

```bash
curl --fail-with-body -i -X OPTIONS http://storage.localhost/videoanalyze/users/test/object \
  -H 'Origin: http://localhost' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type'
```

Expected: the response includes a successful status and an `Access-Control-Allow-Origin: http://localhost` header. The storage proxy must reach MinIO and must not return a Caddy 404.

- [ ] **Step 5: Complete one authenticated small MP4 upload**

Use the existing Mailpit UI/API to retrieve a registration code, register and log in a disposable local account, call `POST /api/videos/upload-session`, and PUT a small MP4 to the returned URL. Check only the returned URL origin/host, not its query string:

```text
local:          storage.localhost
server-IP:      SERVER_IP
domain:         storage.example.com
never:          minio
```

Expected: the PUT returns 2xx from the public storage endpoint and the browser reports no `Upload network error`.

- [ ] **Step 6: Capture non-secret evidence**

Run:

```bash
docker compose -f infra/docker-compose.yml logs --tail=100 api worker minio proxy
```

Record status codes, service health, and endpoint hostnames only. Do not copy credentials, full signed URLs, or provider responses into the handoff.
