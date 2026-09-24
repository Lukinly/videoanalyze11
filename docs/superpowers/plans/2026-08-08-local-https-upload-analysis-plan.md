# Local HTTPS Upload and Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local Compose stack usable at `https://localhost` from WSL and Windows, then verify the real HTTPS upload-to-worker-analysis pipeline with `test.mp4`.

**Architecture:** Use a local Caddyfile with internal TLS for `localhost` and `storage.localhost`, plus a separate production Caddyfile that keeps public-domain automatic HTTPS. Keep service-to-service S3 traffic on `http://minio:9000`, while browser presigned URLs use `https://storage.localhost`. Add a trust/setup script and an end-to-end verifier that authenticates through the API, uploads the supplied MP4, starts analysis, and checks PostgreSQL results.

**Tech Stack:** Docker Compose, Caddy 2, TypeScript/Vitest, Node.js 22, shell, PostgreSQL, MinIO, Mailpit, Groq ASR worker.

## Global Constraints

- Do not execute `docker compose down -v`.
- Do not commit `.env`, certificates, private keys, the supplied `test.mp4`, complete presigned URLs, or API keys.
- Preserve the existing dirty worktree and limit edits to HTTPS setup, verification, and directly related documentation/tests.
- Production must use a separate Caddyfile with a real hostname and Caddy-managed public HTTPS.
- Internal Docker S3 traffic remains `S3_ENDPOINT=http://minio:9000`.

### Task 1: Add failing deployment configuration assertions

**Files:**
- Modify: `tests/acceptance/deployment-config.test.ts`
- Test: `tests/acceptance/deployment-config.test.ts`

**Interfaces:**
- Consumes: `infra/docker-compose.yml`, `infra/reverse-proxy/Caddyfile`, `.env.example`.
- Produces: executable assertions for local HTTPS defaults, local TLS routes, production config separation, and HTTPS storage URL defaults.

- [ ] **Step 1: Write the failing tests**

  Add assertions that the Compose file selects `Caddyfile` by default and supports `CADDYFILE`, `.env.example` uses `https://localhost` and `https://storage.localhost`, the local Caddyfile contains `tls internal` for both local hosts, and `Caddyfile.production` contains hostname-driven sites without `tls internal`.

- [ ] **Step 2: Run the focused test and verify RED**

  Run:

  ```bash
  corepack pnpm vitest run tests/acceptance/deployment-config.test.ts
  ```

  Expected: FAIL because the current defaults and production file do not yet satisfy the HTTPS assertions.

### Task 2: Implement local/production Caddy separation and HTTPS defaults

**Files:**
- Modify: `infra/docker-compose.yml`
- Modify: `infra/reverse-proxy/Caddyfile`
- Create: `infra/reverse-proxy/Caddyfile.production`
- Modify: `.env.example`

**Interfaces:**
- Consumes: failing assertions from Task 1.
- Produces: local `https://localhost`/`https://storage.localhost` routing and production hostname routing selected by `CADDYFILE`.

- [ ] **Step 1: Add the local Caddy routes**

  Configure HTTP-to-HTTPS redirects and explicit `tls internal` blocks for `localhost` and `storage.localhost`. Keep API/web routing and MinIO `Host` forwarding unchanged.

- [ ] **Step 2: Add the production Caddyfile**

  Move hostname-based public routes into `infra/reverse-proxy/Caddyfile.production` using `{$PUBLIC_HOST}` and `{$STORAGE_HOST}`. Do not add `tls internal` to production routes.

- [ ] **Step 3: Select the Caddyfile from Compose**

  Mount `./reverse-proxy/${CADDYFILE:-Caddyfile}` and set local defaults for HTTPS website, HTTPS storage, CORS, and `S3_PUBLIC_ENDPOINT`.

- [ ] **Step 4: Run focused tests and configuration validation**

  Run:

  ```bash
  corepack pnpm vitest run tests/acceptance/deployment-config.test.ts
  docker compose -f infra/docker-compose.yml config --quiet
  ```

  Expected: both commands pass.

### Task 3: Add local CA trust/bootstrap support

**Files:**
- Create: `scripts/setup-local-https.sh`
- Create: `tests/acceptance/setup-local-https.test.ts`
- Modify: `.gitignore`
- Modify: `docs/operations.md`

**Interfaces:**
- Consumes: running `proxy` service and its persistent Caddy data volume.
- Produces: `.local/videoanalyze-local-root.crt`, WSL system trust, and Windows CurrentUser root trust when WSL interop is available.

- [ ] **Step 1: Write the script-level failure checks**

  Add deterministic checks for a missing Caddy root certificate and absent `update-ca-certificates`; each must exit non-zero with an actionable message.

- [ ] **Step 2: Run the checks and verify RED**

  Run the new script against a temporary empty certificate path and confirm it fails with the expected prerequisite message before the implementation exists.

- [ ] **Step 3: Implement certificate export and trust installation**

  Start/recreate the required Compose services without deleting volumes, copy Caddy's local root certificate, install it in WSL, and import it into Windows via `powershell.exe` when available. Keep generated material under `.local/`.

- [ ] **Step 4: Run script tests and shell validation**

  Run:

  ```bash
  bash -n scripts/setup-local-https.sh
  ```

  Expected: exit 0.

### Task 4: Add the real HTTPS upload/analysis verifier

**Files:**
- Create: `scripts/verify-local-upload-analysis.mjs`
- Create: `tests/acceptance/verify-local-upload-analysis.test.ts`
- Modify: `package.json`
- Modify: `docs/operations.md`

**Interfaces:**
- Consumes: `VIDEO_PATH` (default `/mnt/v/Vworkspace/videoanlast/test.mp4`), `E2E_EMAIL`/`E2E_PASSWORD` optionally, HTTPS API, HTTPS storage, Mailpit, and Compose PostgreSQL.
- Produces: non-zero exit on any failed stage; concise success output with video ID, run ID, final status, chunk count, and transcript row count.

- [ ] **Step 1: Write the failing verifier contract test**

  Test pure helpers for HTTP status checking, cookie extraction, presigned URL validation, analysis terminal-state handling, and secret-safe URL redaction.

- [ ] **Step 2: Run the focused test and verify RED**

  Run:

  ```bash
  corepack pnpm vitest run scripts/verify-local-upload-analysis.test.ts
  ```

  Expected: FAIL because the verifier module and helpers do not yet exist.

- [ ] **Step 3: Implement the HTTPS workflow**

  Implement registration through Mailpit when no explicit test credentials are supplied, login cookie handling, upload-session creation, HTTPS presigned PUT of `test.mp4`, analysis start, bounded polling, and PostgreSQL verification of completed chunks/transcript rows. Require `NODE_EXTRA_CA_CERTS=.local/videoanalyze-local-root.crt` when using Node HTTPS.

- [ ] **Step 4: Run the verifier unit tests**

  Run:

  ```bash
  corepack pnpm vitest run scripts/verify-local-upload-analysis.test.ts
  ```

  Expected: PASS.

### Task 5: Rebuild and execute the full acceptance chain

**Files:**
- No source files; runtime verification only.

**Interfaces:**
- Consumes: Tasks 1–4, `.env` with the existing Groq key, Docker daemon, and `/mnt/v/Vworkspace/videoanlast/test.mp4`.
- Produces: verified HTTPS page/API/storage and completed backend analysis.

- [ ] **Step 1: Build and recreate the stack**

  Run:

  ```bash
  sudo docker compose -f infra/docker-compose.yml up -d --build --force-recreate api minio proxy worker
  ```

- [ ] **Step 2: Install local trust**

  Run:

  ```bash
  bash scripts/setup-local-https.sh
  ```

- [ ] **Step 3: Verify HTTPS endpoints**

  Run:

  ```bash
  curl --cacert .local/videoanalyze-local-root.crt -i https://localhost/
  curl --cacert .local/videoanalyze-local-root.crt -i https://localhost/api/auth/me
  curl --cacert .local/videoanalyze-local-root.crt -i -X OPTIONS https://storage.localhost/videoanalyze/test \
    -H 'Origin: https://localhost' \
    -H 'Access-Control-Request-Method: PUT' \
    -H 'Access-Control-Request-Headers: content-type'
  ```

  Expected: page `200`, unauthenticated API `401`, storage preflight `204`, and no HTTP-to-HTTPS connection closure.

- [ ] **Step 4: Run the real upload and analysis test**

  Run:

  ```bash
  NODE_EXTRA_CA_CERTS="$PWD/.local/videoanalyze-local-root.crt" corepack pnpm verify:local-upload-analysis
  ```

  Expected: the supplied MP4 uploads successfully, the run reaches `completed`, and PostgreSQL reports completed chunks plus transcript rows.

- [ ] **Step 5: Run the full static verification suite**

  Run:

  ```bash
  corepack pnpm test
  corepack pnpm lint
  corepack pnpm typecheck
  corepack pnpm build
  docker compose -f infra/docker-compose.yml config --quiet
  git diff --check
  ```

  Expected: all commands exit 0. Report any external Groq or Docker limitation separately from code failures.
