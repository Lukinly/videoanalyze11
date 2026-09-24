# Worker Groq Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Docker Compose analysis Worker reach Groq through the WSL host proxy while keeping PostgreSQL, Redis, and MinIO on the Docker network, then verify the full `test.mp4` upload and transcription flow.

**Architecture:** Upgrade only the Worker image to Node 24 and enable Node's built-in environment proxy support. Compose maps project-scoped `WORKER_*` settings to standard proxy variables only inside the Worker and exposes the WSL host as `host.docker.internal`; the existing Groq provider remains unchanged.

**Tech Stack:** Docker Compose, Node.js 24, pnpm, Vitest, Groq Whisper API, PostgreSQL, Redis, MinIO

## Global Constraints

- Use `node:24-bookworm-slim` for both Worker Dockerfile stages.
- Set `NODE_USE_ENV_PROXY=1` only in the Worker container.
- Map `WORKER_HTTP_PROXY`, `WORKER_HTTPS_PROXY`, and `WORKER_NO_PROXY` only into the Worker.
- Default `WORKER_NO_PROXY` to `postgres,redis,minio,localhost,127.0.0.1`.
- Add `host.docker.internal:host-gateway` only to the Worker service.
- Do not change Groq multipart fields, model selection, response parsing, or retry semantics.
- Never print or commit `GROQ_API_KEY` or proxy credentials.
- Do not stage or commit changes in this shared dirty worktree; use scoped diffs and tests as review gates.

---

### Task 1: Lock the Worker proxy contract with an acceptance test

**Files:**
- Modify: `tests/acceptance/deployment-config.test.ts`

**Interfaces:**
- Consumes: Worker Dockerfile and Compose configuration as UTF-8 text.
- Produces: A deployment contract requiring Node 24, environment proxy support, Worker-scoped proxy mappings, Docker host access, and documented environment defaults.

- [ ] **Step 1: Add the failing deployment test**

Add this case to `tests/acceptance/deployment-config.test.ts`:

```ts
it("routes worker Groq traffic through the optional host proxy", () => {
  const workerDockerfile = readFileSync(new URL("../../apps/worker/Dockerfile", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../../infra/docker-compose.yml", import.meta.url), "utf8");
  const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");

  expect(workerDockerfile.match(/FROM node:24-bookworm-slim/g)).toHaveLength(2);
  expect(compose).toContain('NODE_USE_ENV_PROXY: "1"');
  expect(compose).toContain("HTTP_PROXY: ${WORKER_HTTP_PROXY:-}");
  expect(compose).toContain("HTTPS_PROXY: ${WORKER_HTTPS_PROXY:-}");
  expect(compose).toContain("NO_PROXY: ${WORKER_NO_PROXY:-postgres,redis,minio,localhost,127.0.0.1}");
  expect(compose).toContain('"host.docker.internal:host-gateway"');
  expect(envExample).toContain("WORKER_HTTP_PROXY=");
  expect(envExample).toContain("WORKER_HTTPS_PROXY=");
  expect(envExample).toContain("WORKER_NO_PROXY=postgres,redis,minio,localhost,127.0.0.1");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
corepack pnpm vitest run tests/acceptance/deployment-config.test.ts
```

Expected: the new test fails because the Worker still uses Node 22 and Compose has no Worker proxy mapping.

- [ ] **Step 3: Review the scoped test diff**

Run:

```bash
git diff --check -- tests/acceptance/deployment-config.test.ts
git diff -- tests/acceptance/deployment-config.test.ts
```

Expected: no whitespace errors; only the new proxy deployment contract appears in the scoped diff.

---

### Task 2: Implement Worker-only environment proxy support

**Files:**
- Modify: `apps/worker/Dockerfile`
- Modify: `infra/docker-compose.yml`
- Modify: `.env.example`
- Modify locally without committing: `.env`

**Interfaces:**
- Consumes: `WORKER_HTTP_PROXY`, `WORKER_HTTPS_PROXY`, and `WORKER_NO_PROXY` from the project environment.
- Produces: Worker runtime variables `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and `NODE_USE_ENV_PROXY`; hostname `host.docker.internal` resolves to the Docker host gateway.

- [ ] **Step 1: Upgrade both Worker image stages**

Replace both occurrences of:

```dockerfile
FROM node:22-bookworm-slim
```

with:

```dockerfile
FROM node:24-bookworm-slim
```

- [ ] **Step 2: Add Worker-only Compose proxy configuration**

Add these entries under `services.worker.environment`:

```yaml
      NODE_USE_ENV_PROXY: "1"
      HTTP_PROXY: ${WORKER_HTTP_PROXY:-}
      HTTPS_PROXY: ${WORKER_HTTPS_PROXY:-}
      NO_PROXY: ${WORKER_NO_PROXY:-postgres,redis,minio,localhost,127.0.0.1}
```

Add this sibling of `environment` under `services.worker`:

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

- [ ] **Step 3: Document optional proxy variables**

Add to `.env.example` after `GROQ_API_KEY`:

```env
# Optional outbound proxy used only by the analysis worker.
WORKER_HTTP_PROXY=
WORKER_HTTPS_PROXY=
WORKER_NO_PROXY=postgres,redis,minio,localhost,127.0.0.1
```

- [ ] **Step 4: Configure this WSL machine without exposing secrets**

Add these exact values to the ignored local `.env`, preserving the existing `GROQ_API_KEY`:

```env
WORKER_HTTP_PROXY=http://host.docker.internal:7897
WORKER_HTTPS_PROXY=http://host.docker.internal:7897
WORKER_NO_PROXY=postgres,redis,minio,localhost,127.0.0.1
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
corepack pnpm vitest run tests/acceptance/deployment-config.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 6: Validate rendered Compose configuration without printing secrets**

Run:

```bash
sudo docker compose -f infra/docker-compose.yml config --quiet
```

Expected: exit code 0. Do not print the full rendered configuration because it includes `GROQ_API_KEY`.

- [ ] **Step 7: Review only the intended files**

Run:

```bash
git diff --check -- apps/worker/Dockerfile infra/docker-compose.yml .env.example tests/acceptance/deployment-config.test.ts
git diff --stat -- apps/worker/Dockerfile infra/docker-compose.yml .env.example tests/acceptance/deployment-config.test.ts
```

Expected: no whitespace errors and no provider source changes.

---

### Task 3: Rebuild and verify the complete video analysis flow

**Files:**
- Modify: `docs/handoff/2026-08-08-final-handoff.md`
- Runtime input: `test.mp4`

**Interfaces:**
- Consumes: the updated Worker image, local HTTPS certificate, existing Groq key, and `/mnt/v/Vworkspace/videoanlast/test.mp4`.
- Produces: one new completed analysis run with at least one completed chunk and at least one transcript segment.

- [ ] **Step 1: Run static project verification**

Run:

```bash
corepack pnpm test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 2: Rebuild and recreate the Worker**

Run:

```bash
sudo docker compose -f infra/docker-compose.yml up -d --build --force-recreate worker
sudo docker compose -f infra/docker-compose.yml ps worker
sudo docker compose -f infra/docker-compose.yml logs --tail=100 worker
```

Expected: Worker is running, connects to Redis, and logs contain no Groq key or proxy credentials.

- [ ] **Step 3: Confirm proxy variables are present without revealing values**

Run:

```bash
sudo docker compose -f infra/docker-compose.yml exec -T worker sh -lc 'node -e '\''for (const key of ["NODE_USE_ENV_PROXY","HTTP_PROXY","HTTPS_PROXY","NO_PROXY"]) console.log(`${key}=${process.env[key] ? "configured" : "missing"}`)'\'''
```

Expected: all four names report `configured`.

- [ ] **Step 4: Run the HTTPS upload and analysis verifier**

Run:

```bash
NODE_EXTRA_CA_CERTS="$PWD/.local/videoanalyze-local-root.crt" VIDEO_PATH="$PWD/test.mp4" corepack pnpm verify:local-upload-analysis
```

Expected progress includes `probing`, `extracting_audio`, `transcribing`, `merging_transcript`, and `completed`; final output begins with `PASS` and reports `completedChunks>=1` and `transcriptSegments>=1`.

- [ ] **Step 5: Inspect the latest database state if runtime verification fails**

Run only on failure:

```bash
sudo docker compose -f infra/docker-compose.yml logs --tail=200 worker
sudo docker compose -f infra/docker-compose.yml exec -T postgres psql -U videoanalyze -d videoanalyze -c "SELECT id,status,stage,progress,error,heartbeat_at,updated_at FROM analysis_runs ORDER BY created_at DESC LIMIT 3;"
sudo docker compose -f infra/docker-compose.yml exec -T postgres psql -U videoanalyze -d videoanalyze -c "SELECT run_id,chunk_index,status,retry_count,error FROM chunks WHERE run_id=(SELECT id FROM analysis_runs ORDER BY created_at DESC LIMIT 1) ORDER BY chunk_index;"
```

Expected after the fix: no new run fails with Groq HTTP 403. Diagnose any different failure from its first causal error before changing code.

- [ ] **Step 6: Record the verified outcome in the handoff**

After the verifier succeeds, append a dated Worker proxy section to `docs/handoff/2026-08-08-final-handoff.md`. Use the first, second, and fourth bullets below verbatim; write the third bullet from the verifier's exact final `PASS` line:

```markdown
### Worker Groq 代理修复

- Worker 使用 Node 24 的环境代理支持；代理仅作用于 Worker。
- WSL 本地代理通过 `host.docker.internal:7897` 访问，Docker 内部服务由 `NO_PROXY` 排除。
- `test.mp4` 验收结果以验证器最终 `PASS` 行为准，包含实际 run ID、completed chunk 数和 transcript segment 数。
- 历史 `failed` run 不自动恢复；部署修复后创建新的分析 run。
```

- [ ] **Step 7: Run final diff and secret checks**

Run:

```bash
git diff --check -- apps/worker/Dockerfile infra/docker-compose.yml .env.example tests/acceptance/deployment-config.test.ts docs/handoff/2026-08-08-final-handoff.md
git diff --stat -- apps/worker/Dockerfile infra/docker-compose.yml .env.example tests/acceptance/deployment-config.test.ts docs/handoff/2026-08-08-final-handoff.md
```

Expected: no whitespace errors. Review the scoped diff manually and confirm it contains no Groq key, presigned URL query, or proxy credentials.
