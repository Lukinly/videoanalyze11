# AI Notes, Long Video, and Tiered Billing Implementation Plan

**Status:** Completed and verified on 2026-08-15. The implementation spans commits `e008991` through `c58cf35`; full automated and real local verification evidence is recorded in the handoff document.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver server-duration tiered billing, immutable billing snapshots, four-hour analysis, detailed persistent AI notes, a dedicated notes page, and queue/resource admission protection.

**Architecture:** The API creates an unpaid queued run after admission checks. The worker downloads and probes the media, then atomically validates the four-hour limit, stores the `duration-tiered-v2` snapshot, and reserves the exact credits before FFmpeg extraction or any provider call. Summary and detailed notes share transcript windows; both must persist before completion. Result APIs expose lifecycle-gated notes, while a dedicated web page renders/downloads them and reuses local-video attachment.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, BullMQ/Redis, React 19, zod, Vitest, FFmpeg.

## Global Constraints

- Billing minutes are `max(1, ceil(durationSeconds / 60))`; 0–60 cost 1/minute, 61–120 cost 7/6/minute, and 121–240 cost 3/2/minute, with the final total rounded up using integer arithmetic.
- Billing snapshots are immutable: `billing_rule_version`, `billed_duration_seconds`, `billed_minutes`, and `reserved_credits` never change after first write.
- The server-probed duration is authoritative and the maximum is exactly 14,400 seconds.
- No ASR or LLM call may occur before exact credit reservation succeeds.
- A completed run requires transcript, chapters, and detailed AI notes; retries never charge twice.
- Privacy notes live only in `ephemeral_*` storage and expire with other privacy bodies.
- Initial limits: worker concurrency 2, FFmpeg concurrency 1, one active plus two queued runs per user, total queue 20, one long-video processing slot, reject when estimated queue wait exceeds one hour.
- Notes downloads are generated on demand as Markdown or plain text and are not stored as duplicate objects.

---

### Task 1: Tiered billing contract and immutable database snapshot

**Files:**
- Create: `packages/domain/src/billing.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/api/src/db/migrations/0008_duration_billing_ai_notes.sql`
- Modify: `apps/api/src/db/test-database.ts`
- Modify: `apps/api/src/db/schema.ts`
- Test: `packages/domain/src/billing.test.ts`
- Test: `apps/api/src/db/migrations.test.ts`

**Interfaces:**
- Produces: `calculateDurationTieredCredits(durationSeconds): BillingSnapshot` where snapshot contains `billingRuleVersion: "duration-tiered-v2"`, `billedDurationSeconds`, `billedMinutes`, and `reservedCredits`.
- Produces: immutable snapshot columns on `analysis_runs`, plus ordinary `ai_notes` and privacy-only `ephemeral_ai_notes` tables.

- [ ] Write tests for boundary seconds and the exact 60/95/130/220/310 examples, invalid durations, and migration immutability constraints.
- [ ] Run `corepack pnpm exec vitest run packages/domain/src/billing.test.ts apps/api/src/db/migrations.test.ts` and observe RED.
- [ ] Implement integer tier calculation, exports, migration, test schema, and Drizzle declarations.
- [ ] Re-run the focused tests and `corepack pnpm typecheck`.
- [ ] Commit with `feat: add duration tiered billing snapshot`.

### Task 2: Probe-first billing and four-hour enforcement

**Files:**
- Modify: `apps/api/src/analysis/analysis-service.ts`
- Modify: `apps/api/src/db/repositories/analysis-runs.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/storage/upload-service.ts`
- Modify: `apps/worker/src/credits/credit-repository.ts`
- Modify: `apps/worker/src/analysis/v0-runner.ts`
- Modify: `apps/worker/src/worker-main.ts`
- Modify: `apps/web/src/library/UploadVideo.tsx`
- Modify: `apps/web/src/library/UploadVideo.test.tsx`
- Test: `apps/api/src/analysis/analysis-service.test.ts`
- Test: `apps/worker/src/credits/credit-repository.test.ts`
- Test: `apps/worker/src/analysis/v0-runner.test.ts`

**Interfaces:**
- Produces: `credits.reserveForDuration({ runId, userId, durationSeconds }): Promise<BillingSnapshot | "exhausted">`, implemented as one transaction that locks the run/user, reuses an existing snapshot/reservation, and never mutates it.
- Consumes: `RunnerState.ensureBilling(runId, durationSeconds)` immediately after probe and before `extractAudio`.

- [ ] Write tests proving API queue creation does not reserve by file size; server-probed duration creates the exact immutable reservation; retries reuse it; insufficient balance and >14,400 seconds stop before FFmpeg/provider work.
- [ ] Run the three focused suites and observe RED.
- [ ] Move reservation from API start to the worker probe boundary, persist snapshots atomically, return pending-cost copy from upload/start responses, and default max duration to 14,400.
- [ ] Run focused API/worker/web tests and typecheck.
- [ ] Commit with `feat: bill analyses from probed duration`.

### Task 3: Detailed AI notes generation and lifecycle-safe persistence

**Files:**
- Create: `packages/domain/src/ai-notes.ts`
- Modify: `packages/domain/src/provider.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/worker/src/notes/notes-prompt.ts`
- Create: `apps/worker/src/notes/notes-runner.ts`
- Modify: `apps/worker/src/providers/anthropic-summary.ts`
- Modify: `apps/worker/src/results/result-store.ts`
- Modify: `apps/worker/src/worker-main.ts`
- Modify: `apps/api/src/results/result-repository.ts`
- Modify: `apps/api/src/results/result-service.ts`
- Test: `packages/domain/src/ai-notes.test.ts`
- Test: `apps/worker/src/notes/notes-runner.test.ts`
- Test: `apps/worker/src/results/result-store.test.ts`
- Test: `apps/api/src/results/result-repository.test.ts`

**Interfaces:**
- Produces: `aiNotesSchema` with title, one-line topic, core ideas, nested sections, review points, and timestamp citations tied to real segment IDs.
- Produces: `createNotesRunner({ notes, state }).run({ runId })`, using context-budget windows and a reduce pass for long transcripts.
- Extends result detail with `notes`; deletion/expiry/search scrubbing removes note bodies but retains run/billing metadata.

- [ ] Write RED tests for schema validation, single/map-reduce generation, citation validation/deduplication, ordinary/privacy table isolation, and completion failure when notes are absent.
- [ ] Implement provider notes calls, runner, persistence, API loading, privacy expiry, and deletion.
- [ ] Run focused domain/worker/API tests plus typecheck.
- [ ] Commit with `feat: generate persistent detailed ai notes`.

### Task 4: Dedicated notes page and downloads

**Files:**
- Create: `apps/web/src/notes/NotesPage.tsx`
- Create: `apps/web/src/notes/notes-export.ts`
- Create: `apps/web/src/notes/NotesPage.test.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/viewing/WatchingWorkspace.tsx`
- Modify: `apps/web/src/library/AnalysisHistory.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: lifecycle-gated `AnalysisRun.notes` from the existing detail endpoint.
- Produces: `/notes?run=<id>` long-form page with desktop sticky TOC, mobile disclosure, active heading, timestamp seek/local reattachment, and Markdown/plain-text downloads.

- [ ] Write RED UI tests for history/detail entry, nested headings/TOC, timestamp callback, missing-original reattachment, and both safe downloads without network calls.
- [ ] Implement the route, page, export helpers, responsive styling, and blob cleanup.
- [ ] Run the web suite, typecheck, and lint for touched files.
- [ ] Commit with `feat: add detailed ai notes workspace`.

### Task 5: Queue, FFmpeg, long-video, and ETA admission protection

**Files:**
- Create: `apps/api/src/analysis/admission-policy.ts`
- Modify: `apps/api/src/analysis/analysis-service.ts`
- Modify: `apps/api/src/db/repositories/analysis-runs.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/worker/src/concurrency/semaphore.ts`
- Modify: `apps/worker/src/worker-main.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/worker/src/config.ts`
- Modify: `.env.example`
- Modify: `infra/docker-compose.yml`
- Modify: `docs/commands.md`
- Test: `apps/api/src/analysis/admission-policy.test.ts`
- Test: `apps/api/src/analysis/analysis-service.test.ts`
- Test: `apps/worker/src/concurrency/semaphore.test.ts`
- Create: `tests/acceptance/ai-notes-long-video-billing.acceptance.test.ts`

**Interfaces:**
- Produces: `evaluateAdmission(snapshot): { accepted: true; estimatedWaitSeconds } | { accepted: false; code; message }`.
- Produces: FIFO semaphores wrapping FFmpeg operations (capacity 1) and >120-minute pipelines (capacity 1) while BullMQ remains at concurrency 2.

- [ ] Write RED tests for one-running/two-queued per user, total queue 20, ETA >3,600 seconds, exact-boundary acceptance, FIFO semaphore release on errors, and concentrated 5–20 user scenarios.
- [ ] Implement repository queue snapshots, admission errors/copy, estimated wait response fields, environment defaults, FFmpeg/long-video semaphores, and operational docs.
- [ ] Run focused tests, then full test/typecheck/lint/build/acceptance verification once.
- [ ] Commit with `feat: protect long video analysis capacity`.

## Final acceptance

- [ ] Verify database migration against an existing volume and confirm old runs retain their prior billing behavior while new runs snapshot `duration-tiered-v2`.
- [ ] Run a real local upload and verify one charge, notes availability/download, original deletion, and no filenames/URLs/bodies in verifier output.
- [ ] Record any provider/infrastructure blocker separately; do not claim real verification if it did not run.
