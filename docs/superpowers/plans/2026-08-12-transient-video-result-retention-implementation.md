# Transient Video and Result Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete uploaded media when analysis becomes terminal, retain ordinary text results, expire privacy results after 24 hours, and let users recover, export, or delete results after leaving the page.

**Architecture:** PostgreSQL remains authoritative for users, billing, task state, and ordinary results. Privacy result bodies use dedicated `ephemeral_*` tables excluded from long-lived backups; a repository hides this physical split. S3/MinIO holds only tracked transient uploads, while terminal finalization deletes immediately and a scheduled retention sweep retries abandoned, expired, and stale-run cleanup.

**Tech Stack:** TypeScript, Node.js, Fastify, PostgreSQL 16, BullMQ/Redis, AWS SDK S3/MinIO, React 19, Vitest, Docker Compose, `pg_dump`, `age`, MinIO Client.

## Global Constraints

- Original video, extracted audio, and chunks are transient; terminal tasks delete them immediately and abandoned media has a 24-hour fallback.
- Closing, refreshing, or navigating away must not cancel an analysis job.
- Ordinary transcript, summary, chapter, and timestamp results do not expire automatically.
- Privacy result bodies expire exactly 24 hours after successful completion and must not enter long-lived backups.
- Billing ledger and minimal task audit remain after result deletion; content and filenames are scrubbed.
- Cleanup is idempotent, treats a missing object as success, retries failures, and never changes a completed run back to failed.
- Keep global worker concurrency at 2 and per-user active jobs at 1–2.
- Track 40,000,000,000 bytes as transient capacity: warn at 70% and reject new uploads at 80%.
- Capacity rejection must not prevent reading or exporting existing results.
- Never log API keys, complete signed URLs, media, transcript, summary, or chapter bodies.
- Do not edit applied migrations; add migration `0005`.

## File and Responsibility Map

- `apps/api/src/db/migrations/0005_transient_retention.sql`: lifecycle columns, transient objects, and ephemeral result tables.
- `apps/api/src/retention/transient-media-repository.ts`: upload tracking, live bytes, cleanup claims and outcomes.
- `apps/worker/src/results/result-store.ts`: ordinary/privacy result write and read boundary.
- `apps/worker/src/retention/media-cleanup.ts`: terminal media deletion.
- `apps/worker/src/retention/retention-scheduler.ts`: orphan, retry, stale-run, and privacy-expiry sweeps.
- `apps/api/src/results/result-repository.ts`: lifecycle-aware list, get, search gate, and delete.
- `apps/web/src/library/AnalysisHistory.tsx`: recoverable history.
- `apps/web/src/viewing/ResultActions.tsx`: export, local reattachment, and deletion.
- `scripts/backup-database.sh`: encrypted off-host backup excluding ephemeral data.

---

### Task 1: Add retention contracts and database state

**Files:**
- Create: `packages/domain/src/retention.ts`
- Create: `packages/domain/src/retention.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/api/src/db/migrations/0005_transient_retention.sql`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/test-database.ts`
- Create: `apps/api/src/db/migrations.test.ts`

**Interfaces:**
- Produces `RetentionMode = "standard" | "privacy"` and `ResultAvailability = "available" | "expired" | "deleted" | "pending"`.
- Adds run display-name/expiry/deletion/cleanup fields, `transient_objects`, and three `ephemeral_*` result tables.

- [ ] **Step 1: Write failing contract and migration tests**

```ts
expect(retentionModeSchema.parse("standard")).toBe("standard");
expect(retentionModeSchema.parse("privacy")).toBe("privacy");
expect(() => retentionModeSchema.parse("forever")).toThrow();

const sql = await readFile(join(migrations, "0005_transient_retention.sql"), "utf8");
expect(sql).toContain("CREATE TABLE IF NOT EXISTS transient_objects");
expect(sql).toContain("CREATE TABLE IF NOT EXISTS ephemeral_transcript_segments");
expect(sql).toContain("CREATE TABLE IF NOT EXISTS ephemeral_run_summaries");
expect(sql).toContain("CREATE TABLE IF NOT EXISTS ephemeral_chapters");
```

- [ ] **Step 2: Run tests and verify the expected failure**

```bash
corepack pnpm exec vitest run apps/api/src/db/migrations.test.ts packages/domain/src/retention.test.ts
```

Expected: migration 0005 and retention schema are missing.

- [ ] **Step 3: Implement the schema**

Add `videos.original_deleted_at`. Add to `analysis_runs`: `display_name`, `retention_mode`, `result_expires_at`, `results_deleted_at`, `media_cleanup_status`, `media_cleanup_attempts`, `media_cleanup_error`, and `media_cleaned_at`. Copy `display_name` from the video at run creation so one deleted run can be scrubbed without damaging another run for the same video.

Create:

```sql
CREATE TABLE IF NOT EXISTS transient_objects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES analysis_runs(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('original','audio','chunk','temporary_result')),
  size_bytes BIGINT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  last_cleanup_error TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
```

Create normalized ephemeral transcript, run-summary, and chapter tables mirroring the ordinary content columns, with `user_id`, `run_id`, and nullable `expires_at`. The expiry remains null while a run is in progress and is filled atomically when the whole run completes. Add mode/status constraints and expiry/run indexes. Mirror all fields in Drizzle and pg-mem test schema.

- [ ] **Step 4: Run migration, domain, and type checks**

```bash
corepack pnpm exec vitest run apps/api/src/db/migrations.test.ts packages/domain/src/retention.test.ts apps/api/src/db/analysis-repositories.test.ts
corepack pnpm typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/retention.ts packages/domain/src/retention.test.ts packages/domain/src/index.ts apps/api/src/db/migrations/0005_transient_retention.sql apps/api/src/db/schema.ts apps/api/src/db/test-database.ts apps/api/src/db/migrations.test.ts
git commit -m "feat: add transient retention schema"
```

---

### Task 2: Track uploads and enforce capacity

**Files:**
- Create: `apps/api/src/retention/transient-media-repository.ts`
- Create: `apps/api/src/retention/transient-media-repository.test.ts`
- Modify: `apps/api/src/db/repositories/index.ts`
- Modify: `apps/api/src/storage/upload-service.ts`
- Modify: `apps/api/src/storage/upload-service.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/config/env.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `packages/domain/src/errors.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces `getLiveBytes()` and transactional `createTrackedOriginal({ userId, videoId, objectKey, fileName, sizeBytes, expiresAt })`.
- Adds `TEMP_MEDIA_CAPACITY_BYTES=40000000000` and `TEMP_STORAGE_FULL` HTTP 503.

- [ ] **Step 1: Write failing capacity tests**

```ts
await repository.createTrackedOriginal({ userId: "u1", videoId: "v1", objectKey: "k1", fileName: "clip.mp4", sizeBytes: 20, expiresAt });
expect(await repository.getLiveBytes()).toBe(20);

const service = createUploadService({ ...dependencies, transientCapacityBytes: 40_000_000_000 });
await expect(service.start(oneGigabyteUpload)).rejects.toMatchObject({ code: "TEMP_STORAGE_FULL", status: 503 });
```

Set the test repository's current live bytes to 31 GB. Also assert accepted uploads register an expiry exactly 24 hours after the injected clock.

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm exec vitest run apps/api/src/retention/transient-media-repository.test.ts apps/api/src/storage/upload-service.test.ts apps/api/src/config/env.test.ts
```

- [ ] **Step 3: Implement tracking and thresholds**

```ts
const warningBytes = Math.floor(capacityBytes * 0.70);
const rejectionBytes = Math.floor(capacityBytes * 0.80);
if (liveBytes + input.contentLength > rejectionBytes) {
  throw new DomainError("TEMP_STORAGE_FULL", "临时存储空间繁忙，请稍后重试", 503);
}
```

`createTrackedOriginal` creates the video and transient-object rows with one checked-out PostgreSQL client and transaction before the service requests a signed URL. If signing fails, retain the tracked row for orphan cleanup. Warning logs contain byte counts only.

- [ ] **Step 4: Verify**

```bash
corepack pnpm exec vitest run apps/api/src/retention/transient-media-repository.test.ts apps/api/src/storage/upload-service.test.ts apps/api/src/config/env.test.ts apps/api/src/routes/uploads.test.ts
corepack pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add .env.example packages/domain/src/errors.ts apps/api/src/config apps/api/src/retention apps/api/src/storage/upload-service.ts apps/api/src/storage/upload-service.test.ts apps/api/src/db/repositories/index.ts apps/api/src/server.ts
git commit -m "feat: track transient uploads and enforce capacity"
```

---

### Task 3: Isolate privacy result persistence

**Files:**
- Create: `apps/worker/src/results/result-store.ts`
- Create: `apps/worker/src/results/result-store.test.ts`
- Modify: `apps/worker/src/worker-main.ts`
- Modify: `apps/worker/src/summary/v1-runner.ts`
- Modify: `apps/api/src/analysis/analysis-service.ts`
- Modify: `apps/api/src/analysis/analysis-service.test.ts`
- Modify: `apps/api/src/routes/analysis.ts`
- Modify: `apps/api/src/routes/analysis.test.ts`
- Modify: `apps/api/src/db/repositories/analysis-runs.ts`

**Interfaces:**
- Analysis start consumes `retentionMode`; omission defaults to `standard`.
- `ResultStore` provides `saveTranscript`, `getTranscript`, `saveSummary`, `finalizePrivacyExpiry`, and `clearChunkPayloads`.
- Privacy completion sets expiry to completion time plus 24 hours.

- [ ] **Step 1: Write failing routing tests**

```ts
await store.saveTranscript({ runId, userId, mode: "privacy", expiresAt, segments });
expect(await count("transcript_segments", runId)).toBe(0);
expect(await count("ephemeral_transcript_segments", runId)).toBe(segments.length);
```

Test request mode validation, standard default, exact privacy expiry, and ensure privacy summary/chapter bodies never reach ordinary tables.

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm exec vitest run apps/worker/src/results/result-store.test.ts apps/api/src/analysis/analysis-service.test.ts apps/api/src/routes/analysis.test.ts
```

- [ ] **Step 3: Implement one result-store boundary**

```ts
type ResultStore = {
  saveTranscript(input: { runId: string; userId: string; mode: RetentionMode; expiresAt: Date | null; segments: TranscriptSegment[] }): Promise<void>;
  getTranscript(runId: string): Promise<{ duration: number; segments: TranscriptSegment[] }>;
  saveSummary(input: { runId: string; userId: string; mode: RetentionMode; expiresAt: Date | null; result: AlignedSummaryResult }): Promise<void>;
  finalizePrivacyExpiry(runId: string, expiresAt: Date): Promise<void>;
  clearChunkPayloads(runId: string): Promise<void>;
};
```

Each save is transactional and deletes prior retry output. Standard uses existing normalized tables; privacy uses only `ephemeral_*`. Immediately before marking a privacy run completed, calculate one expiry from the injected completion clock and use `finalizePrivacyExpiry` to update the run and every ephemeral row in one transaction. After durable merged results, clear `chunks.transcript_json`, `transcript_object_key`, and content-bearing chunk errors.

- [ ] **Step 4: Verify**

```bash
corepack pnpm exec vitest run apps/worker/src/results apps/worker/src/summary/v1-runner.test.ts apps/api/src/analysis/analysis-service.test.ts apps/api/src/routes/analysis.test.ts
corepack pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/results apps/worker/src/worker-main.ts apps/worker/src/summary/v1-runner.ts apps/api/src/analysis apps/api/src/routes/analysis.ts apps/api/src/routes/analysis.test.ts apps/api/src/db/repositories/analysis-runs.ts
git commit -m "feat: isolate privacy analysis results"
```

---

### Task 4: Delete media after every terminal outcome

**Files:**
- Create: `apps/worker/src/retention/media-cleanup.ts`
- Create: `apps/worker/src/retention/media-cleanup.test.ts`
- Modify: `apps/worker/src/worker-main.ts`
- Modify: `apps/worker/src/analysis/settlement.test.ts`

**Interfaces:**
- Produces `cleanupRunMedia({ runId, storage, repository, now })`.
- Cleanup status is `pending | cleaning | complete | retry` and is independent of analysis status.

- [ ] **Step 1: Write failing ordering/idempotency tests**

Test terminal state commits before deletion, missing objects succeed, S3 failures record retry without failing completed runs, and `/tmp/videoanalyze/<runId>` is removed on success/failure/cancel.

```ts
storage.delete.mockRejectedValue(new Error("temporary S3 failure"));
await expect(finalizeSuccessfulRun(dependencies)).resolves.toBeUndefined();
expect(state.recordCleanupRetry).toHaveBeenCalled();
expect(state.setRunFailed).not.toHaveBeenCalled();
```

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm exec vitest run apps/worker/src/retention/media-cleanup.test.ts apps/worker/src/analysis/settlement.test.ts
```

- [ ] **Step 3: Implement terminal ordering**

Successful order is persist result → mark completed → consume reservation → clean media. Failure order is mark failed/cancelled → settle reservation → clean media. Cleanup exceptions become retry state and do not replace the original outcome.

```ts
try {
  await runAndPersist();
  await markCompleted();
  await settleAnalysisSuccess({ runId, credits });
} catch (error) {
  await markFailedOrCancelled(error);
  await settleAnalysisFailure({ runId, error, credits });
} finally {
  await cleanupRunMediaSafely({ runId, storage, repository, now: new Date() });
  await removeValidatedRunDirectory(runId);
}
```

Validate that recursive local cleanup targets exactly `/tmp/videoanalyze/<runId>`. On S3 success/missing object, set `videos.original_deleted_at`, mark media `missing`, and mark its transient record deleted. Do not delete result rows.

- [ ] **Step 4: Verify**

```bash
corepack pnpm exec vitest run apps/worker/src/retention/media-cleanup.test.ts apps/worker/src/analysis apps/worker/src/credits
corepack pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/retention apps/worker/src/worker-main.ts apps/worker/src/analysis/settlement.test.ts
git commit -m "feat: delete media after terminal analysis"
```

---

### Task 5: Schedule orphan, stale-run, and privacy cleanup

**Files:**
- Modify: `apps/worker/src/retention/cleanup-worker.ts`
- Modify: `apps/worker/src/retention/cleanup-worker.test.ts`
- Create: `apps/worker/src/retention/retention-repository.ts`
- Create: `apps/worker/src/retention/retention-repository.test.ts`
- Create: `apps/worker/src/retention/retention-scheduler.ts`
- Create: `apps/worker/src/retention/retention-scheduler.test.ts`
- Modify: `apps/worker/src/worker-main.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces `runRetentionSweep({ now })` and a 15-minute non-overlapping scheduler.
- A stale run is older than four hours and has no heartbeat for 15 minutes.
- Claims use `FOR UPDATE SKIP LOCKED`.

- [ ] **Step 1: Write failing sweep tests**

Test abandoned upload expiry, terminal retry, fresh heartbeat protection, stale-run failure plus reservation release, privacy expiry deletion, repeated sweep idempotency, and timer overlap prevention. Use injected clocks/timers without sleeps.

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm exec vitest run apps/worker/src/retention
```

- [ ] **Step 3: Implement the sweep**

```ts
type RetentionSweepReport = {
  transientDeleted: number;
  transientRetried: number;
  privacyResultsDeleted: number;
  staleRunsFailed: number;
};
```

Privacy expiry transaction deletes all three ephemeral tables, clears chunk payloads, and sets `results_deleted_at`. Ordinary result tables are never selected. Truncate stored cleanup errors to 500 sanitized characters. Run immediately at worker startup, then every 900 seconds, and close the scheduler before BullMQ/PostgreSQL shutdown.

- [ ] **Step 4: Verify**

```bash
corepack pnpm exec vitest run apps/worker/src/retention apps/worker/src/analysis apps/worker/src/queue
corepack pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add .env.example apps/worker/src/retention apps/worker/src/worker-main.ts
git commit -m "feat: schedule retention and privacy expiry"
```

---

### Task 6: Add lifecycle-aware result APIs

**Files:**
- Create: `apps/api/src/results/result-repository.ts`
- Create: `apps/api/src/results/result-repository.test.ts`
- Create: `apps/api/src/results/result-service.ts`
- Create: `apps/api/src/results/result-service.test.ts`
- Create: `apps/api/src/routes/results.ts`
- Create: `apps/api/src/routes/results.test.ts`
- Modify: `apps/api/src/db/repositories/analysis-runs.ts`
- Modify: `apps/api/src/db/repositories/search.ts`
- Modify: `apps/api/src/search/search-service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/media.ts`
- Create: `apps/api/src/routes/media.test.ts`
- Modify: `packages/domain/src/errors.ts`

**Interfaces:**
- Adds `GET /api/analysis-runs?limit=50` and `DELETE /api/analysis-runs/:runId/results`.
- Detail gains `retentionMode`, `resultAvailability`, `resultExpiresAt`, `fileName`, and `duration`.
- Expired/deleted content and deleted original playback return HTTP 410.

- [ ] **Step 1: Write failing API/repository tests**

Verify owned history, cross-user denial, privacy reads before expiry, no bodies after expiry, no playback URL after original deletion, and atomic permanent deletion of transcript/summary/chapters/search/chunk payloads. Confirm run ID, duration, billed credits, and terminal status remain while that run's `display_name` becomes `已删除的视频`. Scrub `videos.file_name` only when its original is gone and no other available run still needs the label.

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm exec vitest run apps/api/src/results apps/api/src/routes/results.test.ts apps/api/src/routes/media.test.ts apps/api/src/search
```

- [ ] **Step 3: Implement lifecycle gating**

```ts
if (run.resultsDeletedAt) return "deleted";
if (run.retentionMode === "privacy" && run.resultExpiresAt && run.resultExpiresAt <= now) return "expired";
if (run.status !== "completed") return "pending";
return "available";
```

Detail and search call this boundary before content queries. Use `RESULT_EXPIRED` and `ORIGINAL_DELETED` with HTTP 410. History never returns object keys, signed URLs, cleanup errors, or provider response bodies.

- [ ] **Step 4: Verify**

```bash
corepack pnpm exec vitest run apps/api/src/results apps/api/src/routes/results.test.ts apps/api/src/routes/media.test.ts apps/api/src/search apps/api/src/db/analysis-repositories.test.ts
corepack pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/errors.ts apps/api/src/results apps/api/src/routes/results.ts apps/api/src/routes/results.test.ts apps/api/src/routes/media.ts apps/api/src/routes/media.test.ts apps/api/src/db/repositories/analysis-runs.ts apps/api/src/db/repositories/search.ts apps/api/src/search apps/api/src/app.ts apps/api/src/server.ts
git commit -m "feat: add persistent result lifecycle APIs"
```

---

### Task 7: Restore history and add user result controls

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/library/UploadVideo.tsx`
- Create: `apps/web/src/library/UploadVideo.test.tsx`
- Create: `apps/web/src/library/AnalysisHistory.tsx`
- Create: `apps/web/src/library/AnalysisHistory.test.tsx`
- Create: `apps/web/src/viewing/ResultActions.tsx`
- Create: `apps/web/src/viewing/ResultActions.test.tsx`
- Create: `apps/web/src/viewing/export-markdown.ts`
- Create: `apps/web/src/viewing/export-markdown.test.ts`
- Modify: `apps/web/src/viewing/WatchingWorkspace.tsx`
- Modify: `apps/web/src/viewing/WatchingWorkspace.test.tsx`
- Modify: `apps/web/src/player/VideoPlayer.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Upload start sends `retentionMode`, default `standard`.
- Historical URL is `/?run=<run-id>`.
- Local attachment creates only a browser blob URL and never uploads or charges.

- [ ] **Step 1: Write failing UI tests**

Test required media-deletion/leave-page copy, privacy 24-hour warning, history reload after fresh mount, absent server playback, local attachment without API calls, Markdown export, confirmed deletion, and expired-result state.

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm exec vitest run apps/web/src/library apps/web/src/viewing apps/web/src/app.test.tsx
```

- [ ] **Step 3: Implement recoverable navigation**

After authentication, load credits and history. If the URL contains `run`, fetch that authorized run and render results without requiring the original video. Component unmount closes EventSource/timers only.

```ts
const runId = new URLSearchParams(window.location.search).get("run");
const [nextCredits, nextHistory] = await Promise.all([api.getCredits(), api.listAnalyses()]);
if (runId) setRun(await api.getAnalysis(runId));
setCredits(nextCredits);
setHistory(nextHistory.items);
```

Local files must match stored duration within two seconds; mismatch requires an explicit “仍然使用此文件” confirmation. Revoke blob URLs on replacement/unmount. Export Markdown from the authorized in-memory result, use a sanitized filename, and immediately revoke the download URL.

- [ ] **Step 4: Verify**

```bash
corepack pnpm exec vitest run apps/web/src
corepack pnpm typecheck
corepack pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/app.tsx apps/web/src/app.test.tsx apps/web/src/library apps/web/src/viewing apps/web/src/player/VideoPlayer.tsx apps/web/src/styles.css
git commit -m "feat: restore and manage analysis results"
```

---

### Task 8: Add privacy-safe encrypted backups

**Files:**
- Create: `scripts/backup-database.sh`
- Create: `scripts/restore-database.sh`
- Create: `tests/acceptance/database-backup-policy.test.ts`
- Create: `infra/backup/Dockerfile`
- Modify: `infra/docker-compose.yml`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `docs/operations.md`

**Interfaces:**
- Excludes `public.ephemeral_*` table data.
- Encrypts with `age` before off-host upload.
- Requires `BACKUP_AGE_RECIPIENT`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, and `BACKUP_S3_SECRET_KEY`.

- [ ] **Step 1: Write a failing backup policy test**

```ts
expect(backup).toContain("--exclude-table-data='public.ephemeral_*'");
expect(backup).toContain("age --recipient");
expect(backup).toContain("mc cp");
expect(restore).toContain("dist/db/migrate.js");
expect(restore).toContain("dist/retention/run-once.js");
```

Reject scripts that echo secrets or leave an unencrypted persistent dump.

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm exec vitest run tests/acceptance/database-backup-policy.test.ts
```

- [ ] **Step 3: Implement backup and restore**

Use `set -euo pipefail`, `mktemp -d`, and an exact cleanup trap. Pipe `pg_dump --format=custom --exclude-table-data='public.ephemeral_*'` through `age --recipient`, then `mc cp` only the encrypted file to an independently configured S3 service. Run daily, retain seven daily and four weekly copies, and document quarterly restore drills. Restore remains unavailable to API traffic until migrations and a one-shot retention sweep succeed.

```bash
pg_dump "$DATABASE_URL" --format=custom --exclude-table-data='public.ephemeral_*' \
  | age --recipient "$BACKUP_AGE_RECIPIENT" \
  > "$backup_tmp_dir/videoanalyze-$timestamp.dump.age"
mc alias set offsite "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY"
mc cp "$encrypted_dump" "offsite/$BACKUP_S3_BUCKET/database/"
```

- [ ] **Step 4: Verify**

```bash
corepack pnpm exec vitest run tests/acceptance/database-backup-policy.test.ts tests/acceptance/deployment-config.test.ts
corepack pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add scripts/backup-database.sh scripts/restore-database.sh tests/acceptance/database-backup-policy.test.ts infra/backup/Dockerfile infra/docker-compose.yml .env.example .gitignore docs/operations.md
git commit -m "ops: add privacy-safe encrypted backups"
```

---

### Task 9: Verify the complete lifecycle

**Files:**
- Create: `tests/acceptance/transient-retention.acceptance.test.ts`
- Modify: `tests/acceptance/verify-local-upload-analysis.test.ts`
- Modify: `scripts/verify-local-upload-analysis.mjs`
- Modify: `docs/commands.md`
- Modify: `docs/project-summary.md`

**Interfaces:**
- Tests Tasks 1–8 through public APIs and authorized storage/database probes.
- Verification output contains counts and IDs, never credentials, filenames, URLs, or result bodies.

- [ ] **Step 1: Write failing acceptance cases**

Cover standard upload → client disconnect → new client recovery; terminal original deletion with retained result; privacy availability then 24-hour expiry; user deletion with retained ledger; 80% capacity rejection while history remains readable; repeated cleanup isolation; and local reattachment with zero upload calls.

- [ ] **Step 2: Verify failure**

```bash
corepack pnpm exec vitest run tests/acceptance/transient-retention.acceptance.test.ts
```

- [ ] **Step 3: Extend the safe verifier**

Its output is limited to:

```ts
{
  runId,
  terminalStatus,
  originalDeleted: true,
  resultAvailability: "available",
  transcriptSegmentCount,
  chapterCount
}
```

- [ ] **Step 4: Run full verification**

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm test:acceptance
NODE_EXTRA_CA_CERTS="$PWD/.local/videoanalyze-local-root.crt" corepack pnpm verify:local-upload-analysis
```

Expected: every command exits 0; the real run reports `originalDeleted: true` with text results available.

- [ ] **Step 5: Commit**

```bash
git add tests/acceptance/transient-retention.acceptance.test.ts tests/acceptance/verify-local-upload-analysis.test.ts scripts/verify-local-upload-analysis.mjs docs/commands.md docs/project-summary.md
git commit -m "test: verify transient media lifecycle"
```

---

## Final Review Checklist

- [ ] Standard bodies never enter `ephemeral_*`; privacy bodies never enter ordinary content tables.
- [ ] `pg_dump` excludes every `ephemeral_*` table's data.
- [ ] Result/terminal commits happen before media deletion.
- [ ] Cleanup failure records retry without changing success state.
- [ ] Stale cleanup cannot claim a fresh-heartbeat run.
- [ ] Result deletion removes transcript, summary, chapters, search content, and chunk payloads.
- [ ] Billing ledger and minimal audit remain after deletion.
- [ ] Page unmount closes subscriptions only and never cancels work.
- [ ] Historical local playback never uploads or charges implicitly.
- [ ] Logs and errors contain no secrets, signed URLs, filenames, or content bodies.
- [ ] Tests, typecheck, lint, build, acceptance, and real local verification pass before completion is claimed.
