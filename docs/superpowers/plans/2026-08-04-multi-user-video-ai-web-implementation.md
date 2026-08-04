# Multi-user Video AI Web Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Linux-hosted, multi-user Web service that lets verified users upload videos, spend two trial analysis credits, receive timestamped transcripts in V0, and receive summaries, chapters, search, and playback compatibility handling in V1.

**Architecture:** A React/Vite browser client calls a Fastify API over HTTPS. The API owns authentication, authorization, uploads, quotas, PostgreSQL state, and SSE progress; Redis/BullMQ dispatches resumable analysis jobs to a separate Node worker that uses FFmpeg/FFprobe and provider adapters. Large files live in S3-compatible object storage, while PostgreSQL stores tenant-scoped metadata and queryable transcript/chapter data.

**Tech Stack:** pnpm workspaces, Node.js + TypeScript, React + Vite, Fastify, Zod, PostgreSQL + Drizzle ORM, Redis + BullMQ, S3-compatible storage + MinIO for local deployment, FFmpeg/FFprobe, Groq provider adapters, Argon2id, Nodemailer SMTP, Vitest, React Testing Library, Playwright, Docker Compose.

## Global Constraints

- The production server runs on Linux; Windows, macOS, and Linux users access the service through a browser.
- The platform uses one server-side Groq key from `GROQ_API_KEY`; the implementation must not read, print, expose, or commit the existing `.env` contents.
- A user must verify their email before analysis access is enabled and then receives exactly two complete analysis credits.
- One complete video analysis consumes one credit; retries of the same `analysisRun` do not consume another credit.
- Original videos expire after 7 days by default; audio and chunks are deleted after task completion/cancellation; transcript and summary data expire after 30 days.
- Every resource query and mutation is authorized through `userId`; no route may trust a client-provided owner ID.
- V0 must work with browser-playable H.264/AAC MP4 fixtures and must persist each completed ASR chunk before continuing.
- V1 must align chapter times from `sourceSegmentIds`, not from LLM-provided times.
- No real API key is used in automated tests; provider tests use fake adapters or test HTTP responses.
- Long-running FFmpeg and AI work never runs inside an HTTP request handler.

---

## Repository Map

The empty repository becomes a small pnpm monorepo:

```text
apps/
  api/                 Fastify HTTP API, auth, uploads, results, SSE
  worker/              BullMQ consumers and analysis orchestration
  web/                 React browser application
packages/
  domain/              Shared Zod schemas, domain types, errors, provider contracts
  testkit/              Fake providers, clock, storage, queue, and fixture helpers
infra/
  docker-compose.yml   PostgreSQL, Redis, MinIO, Mailpit for local development
  postgres/             SQL extensions and test seed helpers
docs/
  superpowers/specs/   Approved design
  superpowers/plans/   This implementation plan
```

## Task 1: Scaffold the pnpm monorepo and test tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `.editorconfig`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`
- Create: `packages/testkit/package.json`, `packages/testkit/tsconfig.json`
- Create: `apps/api/src/health.test.ts`

**Interfaces:**
- Produces workspace scripts: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm dev`, `pnpm build`.
- Produces package aliases `@videoanalyze/domain` and `@videoanalyze/testkit`.

- [ ] **Step 1: Write the failing workspace health test**

```ts
import { describe, expect, it } from "vitest";

describe("workspace bootstrap", () => {
  it("exposes the API health contract", async () => {
    const { createHealthPayload } = await import("./health");
    expect(createHealthPayload()).toEqual({ status: "ok", service: "api" });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the module is missing**

Run: `pnpm vitest apps/api/src/health.test.ts`

Expected: FAIL with a module-not-found error for `./health`.

- [ ] **Step 3: Add the minimal scaffold and health module**

```ts
// apps/api/src/health.ts
export function createHealthPayload() {
  return { status: "ok" as const, service: "api" as const };
}
```

Configure TypeScript project references and Vitest workspace discovery without adding application behavior.

- [ ] **Step 4: Run the focused test and the empty workspace checks**

Run: `pnpm vitest apps/api/src/health.test.ts`

Expected: PASS.

Run: `pnpm typecheck && pnpm lint`

Expected: exit 0 with no TypeScript or lint errors.

- [ ] **Step 5: Commit the scaffold**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts .editorconfig apps packages
git commit -m "chore: scaffold web service workspace"
```

## Task 2: Define shared domain contracts and error taxonomy

**Files:**
- Create: `packages/domain/src/auth.ts`
- Create: `packages/domain/src/media.ts`
- Create: `packages/domain/src/analysis.ts`
- Create: `packages/domain/src/quota.ts`
- Create: `packages/domain/src/provider.ts`
- Create: `packages/domain/src/errors.ts`
- Create: `packages/domain/src/index.ts`
- Test: `packages/domain/src/*.test.ts`

**Interfaces:**

```ts
export const analysisStageSchema = z.enum([
  "queued", "probing", "extracting_audio", "chunking", "transcribing",
  "merging_transcript", "summarizing", "indexing", "completed"
]);

export type TranscriptSegment = {
  id: string;
  runId: string;
  start: number;
  end: number;
  text: string;
};

export interface AsrProvider {
  capabilities(): Promise<AsrCapabilities>;
  transcribeChunk(input: TranscribeChunkInput): Promise<TranscribeChunkResult>;
}

export interface SummaryProvider {
  capabilities(): Promise<SummaryCapabilities>;
  summarize(input: SummaryInput): Promise<SummaryResult>;
}
```

- [ ] **Step 1: Write failing schema tests**

```ts
it("rejects a transcript segment outside the video time range", () => {
  expect(() => transcriptSegmentSchema.parse({
    id: "seg_1", runId: "run_1", start: 12, end: 4, text: "bad"
  })).toThrow();
});

it("classifies provider rate limits as retryable", () => {
  expect(new ProviderError("rate_limited", "retry", { retryAfterMs: 1000 }).retryable)
    .toBe(true);
});
```

- [ ] **Step 2: Run the domain tests and verify the missing schemas/errors fail**

Run: `pnpm vitest packages/domain/src -r`

Expected: FAIL because the schemas and `ProviderError` do not exist.

- [ ] **Step 3: Implement schemas, domain types, provider capabilities, and typed errors**

Use Zod for runtime validation. Keep provider-specific fields out of `analysis.ts`; Groq field names belong only in the Groq adapter.

- [ ] **Step 4: Run domain tests and typecheck**

Run: `pnpm vitest packages/domain/src -r && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the domain contracts**

```bash
git add packages/domain
git commit -m "feat: add shared analysis domain contracts"
```

## Task 3: Add PostgreSQL schema, migrations, and tenant-safe repositories

**Files:**
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/migrations/0001_initial.sql`
- Create: `apps/api/src/db/repositories/users.ts`
- Create: `apps/api/src/db/repositories/videos.ts`
- Create: `apps/api/src/db/repositories/analysis-runs.ts`
- Create: `apps/api/src/db/repositories/usage-ledger.ts`
- Create: `apps/api/src/db/repositories/transcript.ts`
- Create: `apps/api/src/db/repositories/chapters.ts`
- Create: `apps/api/src/db/repositories/search.ts`
- Create: `apps/api/src/db/repositories/*.test.ts`
- Create: `infra/postgres/001_extensions.sql`
- Create: `apps/api/drizzle.config.ts`

**Interfaces:**

```ts
export interface UsageLedgerRepository {
  reserveAnalysis(input: { userId: string; runId: string; idempotencyKey: string }): Promise<"reserved" | "already_reserved" | "exhausted">;
  confirmAnalysis(runId: string): Promise<void>;
  releaseAnalysis(runId: string, reason: string): Promise<void>;
  getAvailableCredits(userId: string): Promise<number>;
}

export interface VideoRepository {
  findOwnedById(userId: string, videoId: string): Promise<VideoRecord | null>;
  create(input: CreateVideoInput): Promise<VideoRecord>;
  markDeleted(userId: string, videoId: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing repository tests for tenant isolation and idempotent quota reservation**

```ts
it("does not return another user's video", async () => {
  const mine = await videos.create({ userId: "user_a", objectKey: "a/video.mp4", fileName: "a.mp4" });
  expect(await videos.findOwnedById("user_b", mine.id)).toBeNull();
});

it("reserves one credit only once for the same analysis run", async () => {
  const first = await usage.reserveAnalysis({ userId: "user_a", runId: "run_a", idempotencyKey: "run_a" });
  const second = await usage.reserveAnalysis({ userId: "user_a", runId: "run_a", idempotencyKey: "run_a" });
  expect([first, second].sort()).toEqual(["already_reserved", "reserved"]);
  expect(await usage.getAvailableCredits("user_a")).toBe(1);
});
```

- [ ] **Step 2: Run the repository tests against PostgreSQL and verify they fail**

Run: `docker compose -f infra/docker-compose.yml up -d postgres && pnpm vitest apps/api/src/db -r`

Expected: FAIL because migrations, tables, and repositories do not exist.

- [ ] **Step 3: Implement migrations and repositories**

Create `users`, `sessions`, `email_verifications`, `videos`, `analysis_runs`, `jobs`, `chunks`, `transcript_segments`, `chapters`, and `usage_ledger`. Add foreign keys, `user_id` indexes, analysis status checks, unique `(run_id, chunk_index)`, and `pg_trgm` extension for V1 search. Keep all repository methods scoped by `userId`.

- [ ] **Step 4: Run repository tests and migration checks**

Run: `pnpm vitest apps/api/src/db -r && pnpm drizzle-kit check`

Expected: PASS and no pending migration errors.

- [ ] **Step 5: Commit the database foundation**

```bash
git add apps/api/src/db apps/api/drizzle.config.ts infra/postgres
git commit -m "feat: add tenant-safe postgres persistence"
```

## Task 4: Implement registration, email verification, sessions, and login

**Files:**
- Create: `apps/api/src/config/env.ts`
- Create: `apps/api/src/auth/passwords.ts`
- Create: `apps/api/src/auth/tokens.ts`
- Create: `apps/api/src/auth/email-service.ts`
- Create: `apps/api/src/auth/auth-service.ts`
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/plugins/auth-context.ts`
- Create: `apps/api/src/auth/*.test.ts`
- Modify: `apps/api/src/db/repositories/users.ts`
- Modify: `apps/api/src/db/repositories/usage-ledger.ts`

**Interfaces:**

```ts
export interface AuthService {
  register(input: { email: string; password: string }): Promise<{ userId: string; verificationSent: boolean }>;
  verifyEmail(token: string): Promise<{ userId: string; trialCreditsGranted: boolean }>;
  login(input: { email: string; password: string }): Promise<{ sessionToken: string; user: PublicUser }>;
  logout(sessionToken: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing auth tests**

```ts
it("grants exactly two credits on first successful email verification", async () => {
  const registered = await auth.register({ email: "user@example.com", password: "correct horse battery staple" });
  const first = await auth.verifyEmail(testMail.tokenFor(registered.userId));
  const second = await auth.verifyEmail(testMail.tokenFor(registered.userId));
  expect(first.trialCreditsGranted).toBe(true);
  expect(second.trialCreditsGranted).toBe(false);
  expect(await usage.getAvailableCredits(registered.userId)).toBe(2);
});

it("rejects login before email verification", async () => {
  const registered = await auth.register({ email: "pending@example.com", password: "correct horse battery staple" });
  await expect(auth.login({ email: "pending@example.com", password: "correct horse battery staple" }))
    .rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
});
```

- [ ] **Step 2: Run auth tests and verify the expected missing-service failures**

Run: `pnpm vitest apps/api/src/auth -r`

Expected: FAIL because `AuthService` and token/password implementations are absent.

- [ ] **Step 3: Implement Argon2id hashing, one-time verification tokens, SMTP adapter, sessions, and Fastify routes**

Read only typed configuration values from `process.env`. For the Groq key, check `Boolean(process.env.GROQ_API_KEY)` and never include its value in a response or log. Use generic SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) and Mailpit in local Docker development.

- [ ] **Step 4: Run auth tests and API contract tests**

Run: `pnpm vitest apps/api/src/auth -r && pnpm vitest apps/api/src/routes/auth.test.ts -r`

Expected: PASS, including cookie flags and rate-limit responses.

- [ ] **Step 5: Commit authentication**

```bash
git add apps/api/src/auth apps/api/src/routes/auth.ts apps/api/src/plugins/auth-context.ts apps/api/src/config
git commit -m "feat: add verified email authentication"
```

## Task 5: Implement S3-compatible storage, upload sessions, and retention metadata

**Files:**
- Create: `apps/api/src/storage/object-storage.ts`
- Create: `apps/api/src/storage/s3-storage.ts`
- Create: `apps/api/src/storage/object-keys.ts`
- Create: `apps/api/src/routes/uploads.ts`
- Create: `apps/api/src/retention/retention-service.ts`
- Create: `apps/api/src/storage/*.test.ts`
- Create: `apps/api/src/routes/uploads.test.ts`

**Interfaces:**

```ts
export interface ObjectStorage {
  createUpload(input: { objectKey: string; contentType: string; contentLength: number }): Promise<{ uploadUrl: string; expiresAt: string }>;
  head(objectKey: string): Promise<{ size: number; contentType: string }>;
  getDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  downloadToFile(objectKey: string, destination: string): Promise<void>;
  delete(objectKey: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing storage and upload authorization tests**

```ts
it("creates an object key that cannot escape the user's namespace", () => {
  expect(createOriginalVideoKey("user_1", "../secret.mp4")).toMatch(/^users\/user_1\/videos\/[a-z0-9-]+\/original$/);
});

it("rejects an upload whose declared size exceeds the configured limit", async () => {
  await expect(requestUpload({ userId: "user_1", size: MAX_UPLOAD_BYTES + 1 }))
    .rejects.toMatchObject({ code: "UPLOAD_TOO_LARGE" });
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm vitest apps/api/src/storage apps/api/src/routes/uploads.test.ts -r`

Expected: FAIL because storage key and upload services do not exist.

- [ ] **Step 3: Implement MinIO/S3 adapter, scoped keys, presigned upload finalization, and retention timestamps**

The API must compare the completed object size with the upload session record before creating an analysis run. Do not accept a client-supplied object key.

- [ ] **Step 4: Run storage integration tests against MinIO**

Run: `docker compose -f infra/docker-compose.yml up -d minio && pnpm vitest apps/api/src/storage apps/api/src/routes/uploads.test.ts -r`

Expected: PASS.

- [ ] **Step 5: Commit upload storage**

```bash
git add apps/api/src/storage apps/api/src/routes/uploads.ts apps/api/src/retention
git commit -m "feat: add scoped object storage uploads"
```

## Task 6: Build provider adapters and retry policy

**Files:**
- Create: `apps/worker/src/providers/groq-asr.ts`
- Create: `apps/worker/src/providers/groq-summary.ts`
- Create: `apps/worker/src/providers/retry-policy.ts`
- Create: `apps/worker/src/providers/http-client.ts`
- Create: `packages/testkit/src/fake-providers.ts`
- Test: `apps/worker/src/providers/*.test.ts`

**Interfaces:**

```ts
export type RetryDecision = {
  retry: boolean;
  delayMs: number;
  reduceConcurrency: boolean;
};

export function classifyProviderFailure(error: unknown): ProviderFailure;
export function getRetryDecision(failure: ProviderFailure, attempt: number): RetryDecision;
```

- [ ] **Step 1: Write failing tests for Groq field mapping and retry classes**

```ts
it("maps the domain timestamp option to Groq's array field", async () => {
  const client = new RecordingGroqClient();
  const provider = new GroqAsrProvider(client, { model: "whisper-large-v3-turbo" });
  await provider.transcribeChunk({ audioFile: "/tmp/chunk.flac", language: null, timestampLevel: "segment", prompt: "tail" });
  expect(client.lastRequest).toMatchObject({ response_format: "verbose_json", timestamp_granularities: ["segment"] });
  expect(client.lastRequest).not.toHaveProperty("language");
});

it("honors Retry-After for rate limits", () => {
  expect(getRetryDecision({ kind: "rate_limited", retryAfterMs: 4200 }, 1))
    .toEqual({ retry: true, delayMs: 4200, reduceConcurrency: true });
});
```

- [ ] **Step 2: Run provider tests and verify the adapters are missing**

Run: `pnpm vitest apps/worker/src/providers -r`

Expected: FAIL because the adapters and retry policy do not exist.

- [ ] **Step 3: Implement provider adapters with domain-only outputs**

The ASR adapter sends `response_format: "verbose_json"` and `timestamp_granularities: ["segment"]`; it omits `language` when the domain input is `null`. The summary adapter requests structured JSON where supported, validates the returned shape with the domain schema, and treats transcript text as untrusted content.

- [ ] **Step 4: Run provider tests with fake HTTP responses**

Run: `pnpm vitest apps/worker/src/providers -r`

Expected: PASS with no `.env` access and no real network request.

- [ ] **Step 5: Commit provider adapters**

```bash
git add apps/worker/src/providers packages/testkit/src/fake-providers.ts
git commit -m "feat: add provider adapters and retry policy"
```

## Task 7: Implement FFprobe/FFmpeg media processing and deterministic chunk manifests

**Files:**
- Create: `apps/worker/src/media/process-runner.ts`
- Create: `apps/worker/src/media/ffprobe.ts`
- Create: `apps/worker/src/media/ffmpeg.ts`
- Create: `apps/worker/src/media/chunk-manifest.ts`
- Create: `apps/worker/src/media/media-processor.ts`
- Create: `apps/worker/src/media/*.test.ts`

**Interfaces:**

```ts
export interface MediaProcessor {
  probe(inputPath: string): Promise<MediaInfo>;
  extractAudio(input: { videoPath: string; outputPath: string; audioIndex: number }): Promise<void>;
  createChunkManifest(input: ChunkingInput): Promise<ChunkManifest>;
  renderChunk(input: ManifestChunk): Promise<{ path: string; size: number }>;
  remuxToMp4(inputPath: string, outputPath: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing manifest and command tests**

```ts
it("creates stable overlapping chunks from the same input", () => {
  const manifest = buildChunkManifest({ duration: 1250, targetSeconds: 600, overlapSeconds: 8, maxBytes: 20_000_000, estimateBytes: () => 1_000_000 });
  expect(manifest.chunks.map(({ start, end }) => ({ start, end }))).toEqual([
    { start: 0, end: 600 }, { start: 592, end: 1192 }, { start: 1184, end: 1250 }
  ]);
  expect(buildChunkManifest({ duration: 1250, targetSeconds: 600, overlapSeconds: 8, maxBytes: 20_000_000, estimateBytes: () => 1_000_000 }))
    .toEqual(manifest);
});

it("uses only the first audio stream for extraction", () => {
  expect(buildExtractAudioArgs("input.mp4", "audio.flac", 0)).toContain("-map");
  expect(buildExtractAudioArgs("input.mp4", "audio.flac", 0)).toContain("0:a:0");
});
```

- [ ] **Step 2: Run media tests and verify they fail**

Run: `pnpm vitest apps/worker/src/media -r`

Expected: FAIL because media commands and manifest builder do not exist.

- [ ] **Step 3: Implement process execution, probe parsing, audio extraction, chunk rendering, and size-based subdivision**

Use `-ar 16000 -ac 1 -map 0:a:0 -c:a flac` for extracted audio. Keep a manifest JSON object with its version, source fingerprint, duration, overlap, target size, and exact chunk boundaries. If a rendered chunk exceeds the provider capability limit, split that manifest entry deterministically and persist the updated manifest.

- [ ] **Step 4: Run media tests with fixture files**

Run: `pnpm vitest apps/worker/src/media -r`

Expected: PASS, including no-audio and multi-audio error cases.

- [ ] **Step 5: Commit media processing**

```bash
git add apps/worker/src/media
git commit -m "feat: add ffmpeg media processing and chunk manifests"
```

## Task 8: Implement the resumable V0 analysis worker

**Files:**
- Create: `apps/worker/src/analysis/progress.ts`
- Create: `apps/worker/src/analysis/transcript-merge.ts`
- Create: `apps/worker/src/analysis/v0-runner.ts`
- Create: `apps/worker/src/queue/queues.ts`
- Create: `apps/worker/src/queue/analysis-consumer.ts`
- Create: `apps/worker/src/worker.ts`
- Create: `apps/worker/src/analysis/*.test.ts`
- Modify: `apps/api/src/db/repositories/analysis-runs.ts`
- Modify: `apps/api/src/db/repositories/chunks.ts`

**Interfaces:**

```ts
export interface V0AnalysisRunner {
  run(input: { userId: string; videoId: string; runId: string; signal: AbortSignal }): Promise<void>;
}

export function mergeChunkTranscripts(input: {
  chunks: Array<{ start: number; end: number; segments: Array<{ start: number; end: number; text: string }> }>;
  videoDuration: number;
}): { segments: TranscriptSegment[]; mergeWarnings: string[] };
```

- [ ] **Step 1: Write failing resume, merge, and progress tests**

```ts
it("does not call ASR for a completed chunk during resume", async () => {
  const asr = new FakeAsrProvider();
  await runV0({ state: stateWithChunks({ completed: [0], pending: [1] }), asr });
  expect(asr.calls.map(call => call.chunkIndex)).toEqual([1]);
});

it("keeps uncertain overlap text and reports a merge warning", () => {
  const result = mergeChunkTranscripts({
    videoDuration: 20,
    chunks: [
      { start: 0, end: 12, segments: [{ start: 10, end: 12, text: "第一句" }] },
      { start: 10, end: 20, segments: [{ start: 10, end: 12, text: "不同内容" }] }
    ]
  });
  expect(result.segments).toHaveLength(2);
  expect(result.mergeWarnings).toHaveLength(1);
});
```

- [ ] **Step 2: Run focused analysis tests and verify they fail**

Run: `pnpm vitest apps/worker/src/analysis -r`

Expected: FAIL because the runner and merge function do not exist.

- [ ] **Step 3: Implement the V0 stage machine**

Stages are `probing`, `extracting_audio`, `chunking`, `transcribing`, and `merging_transcript`. Write a heartbeat after each chunk and throttle progress events to at most one update per 100 ms per run. Mark a chunk completed only after its transcript has been written and its database transaction committed. Use the provider retry policy; on cancellation terminate child processes and preserve already completed chunks.

- [ ] **Step 4: Run worker tests and a crash-resume integration test**

Run: `pnpm vitest apps/worker/src/analysis -r && pnpm vitest apps/worker/src/queue -r`

Expected: PASS, including a restart that requeues a stale `running` run without reprocessing completed chunks.

- [ ] **Step 5: Commit the V0 worker**

```bash
git add apps/worker/src/analysis apps/worker/src/queue apps/worker/src/worker.ts apps/api/src/db/repositories
git commit -m "feat: add resumable v0 analysis worker"
```

## Task 9: Expose V0 API routes and SSE progress

**Files:**
- Create: `apps/api/src/routes/videos.ts`
- Create: `apps/api/src/routes/analysis.ts`
- Create: `apps/api/src/routes/events.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/routes/*.test.ts`
- Modify: `apps/api/src/config/env.ts`

**Interfaces:**

```ts
POST /api/videos/upload-session
POST /api/videos/:videoId/upload-complete
POST /api/videos/:videoId/analysis-runs
POST /api/analysis-runs/:runId/cancel
GET  /api/analysis-runs/:runId
GET  /api/analysis-runs/:runId/events
GET  /api/analysis-runs/:runId/transcript
```

- [ ] **Step 1: Write failing route tests for auth, quota, and SSE**

```ts
it("does not create an analysis run for an unverified user", async () => {
  const response = await app.inject({
    method: "POST", url: "/api/videos/video_1/analysis-runs",
    headers: { cookie: sessionCookie(unverifiedUser) }
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().code).toBe("EMAIL_NOT_VERIFIED");
});

it("streams only the requested user's run progress", async () => {
  const response = await app.inject({
    method: "GET", url: "/api/analysis-runs/run_other/events",
    headers: { cookie: sessionCookie(userA) }
  });
  expect(response.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run route tests and verify they fail**

Run: `pnpm vitest apps/api/src/routes -r`

Expected: FAIL because the Fastify app and routes do not exist.

- [ ] **Step 3: Implement the API, idempotent start, cancellation, and SSE publisher**

The `analysis-runs` creation route must lock one quota reservation and enqueue exactly one job for its idempotency key. SSE events include `runId`, `stage`, `completedChunks`, `totalChunks`, optional `mediaPercent`, and an error code without secrets or absolute server paths.

- [ ] **Step 4: Run API integration tests**

Run: `pnpm vitest apps/api/src/routes -r`

Expected: PASS with tenant isolation, quota exhaustion, cancellation, and SSE event assertions.

- [ ] **Step 5: Commit the V0 API**

```bash
git add apps/api/src/app.ts apps/api/src/server.ts apps/api/src/routes
git commit -m "feat: expose v0 analysis api and progress events"
```

## Task 10: Build the V0 React client

**Files:**
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/auth/LoginPage.tsx`
- Create: `apps/web/src/auth/RegisterPage.tsx`
- Create: `apps/web/src/auth/VerifyEmailPage.tsx`
- Create: `apps/web/src/library/UploadVideo.tsx`
- Create: `apps/web/src/player/VideoPlayer.tsx`
- Create: `apps/web/src/transcript/TranscriptPanel.tsx`
- Create: `apps/web/src/analysis/AnalysisProgress.tsx`
- Create: `apps/web/src/styles.css`
- Test: `apps/web/src/**/*.test.tsx`
- Create: `apps/web/e2e/v0.spec.ts`

**Interfaces:**

```ts
export type PlayerController = {
  seek(seconds: number): void;
  getCurrentTime(): number;
  getPaused(): boolean;
};

export function formatTimestamp(seconds: number): string;
```

- [ ] **Step 1: Write failing component tests**

```tsx
it("seeks to a transcript segment without changing paused state", async () => {
  const player = userEvent.setup();
  const seek = vi.fn();
  render(<TranscriptPanel segments={[{ id: "s1", start: 12.5, end: 20, text: "内容" }]} onSeek={seek} />);
  await player.click(screen.getByRole("button", { name: "00:12 内容" }));
  expect(seek).toHaveBeenCalledWith(12.5);
});
```

- [ ] **Step 2: Run the focused client test and verify it fails**

Run: `pnpm vitest apps/web/src/transcript -r`

Expected: FAIL because `TranscriptPanel` does not exist.

- [ ] **Step 3: Implement the V0 client flows**

Use the browser File API only to upload through the presigned URL. Render the video using the authorized playback URL. Subscribe to SSE with reconnect/backoff, show stage and completed/total chunk progress, and render transcript segments with a virtual list when the segment count exceeds 500.

- [ ] **Step 4: Run client tests and the browser smoke test**

Run: `pnpm vitest apps/web/src -r && pnpm playwright test apps/web/e2e/v0.spec.ts`

Expected: PASS for login, upload mock, progress, transcript click, and player seek behavior.

- [ ] **Step 5: Commit the V0 client**

```bash
git add apps/web
git commit -m "feat: add v0 video upload and transcript player"
```

## Task 11: Add V0 end-to-end recovery and retention verification

**Files:**
- Create: `apps/worker/src/recovery/recovery-scan.ts`
- Create: `apps/worker/src/retention/cleanup-worker.ts`
- Create: `apps/worker/src/recovery/*.test.ts`
- Create: `apps/worker/src/retention/*.test.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/health.test.ts`

- [ ] **Step 1: Write failing recovery and cleanup tests**

```ts
it("requeues a stale run but leaves completed chunks completed", async () => {
  const result = await scanStaleRuns({ now: NOW, staleAfterMs: 60_000 });
  expect(result.requeuedRunIds).toEqual(["run_1"]);
  expect(await chunks.status("run_1", 0)).toBe("completed");
});

it("deletes expired original and temporary objects", async () => {
  await cleanupExpiredObjects({ now: NOW });
  expect(storage.deletedKeys).toContain("users/u1/videos/v1/original");
  expect(storage.deletedKeys).toContain("users/u1/runs/r1/chunks/c1.flac");
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm vitest apps/worker/src/recovery apps/worker/src/retention -r`

Expected: FAIL because the recovery and cleanup workers are absent.

- [ ] **Step 3: Implement stale-run recovery, object cleanup, and health checks**

Treat a run with a stale heartbeat as recoverable, not permanently failed. Cleanup must be idempotent and must delete database search rows and storage objects after the configured retention timestamp.

- [ ] **Step 4: Run V0 verification**

Run: `pnpm test:v0`

Expected: PASS for unit, integration, browser, recovery, retention, and Linux fixture tests.

- [ ] **Step 5: Commit the V0 hardening**

```bash
git add apps/worker/src/recovery apps/worker/src/retention apps/api/src/routes/health.ts
git commit -m "test: verify v0 recovery and retention"
```

## Task 12: Implement V1 summary, chapter alignment, and map-reduce planning

**Files:**
- Create: `apps/worker/src/summary/token-budget.ts`
- Create: `apps/worker/src/summary/windowing.ts`
- Create: `apps/worker/src/summary/alignment.ts`
- Create: `apps/worker/src/summary/v1-runner.ts`
- Create: `apps/worker/src/summary/*.test.ts`
- Modify: `apps/worker/src/analysis/v0-runner.ts`
- Modify: `apps/worker/src/providers/groq-summary.ts`

**Interfaces:**

```ts
export function alignChapter(input: {
  chapterId: string;
  sourceSegmentIds: string[];
  segments: TranscriptSegment[];
  duration: number;
}): AlignedChapter;

export function chooseSummaryPlan(input: {
  estimatedInputTokens: number;
  contextWindow: number;
  segmentCount: number;
}): "single" | "map_reduce";
```

- [ ] **Step 1: Write failing alignment and budget tests**

```ts
it("derives chapter time from referenced segments", () => {
  expect(alignChapter({
    chapterId: "ch1",
    sourceSegmentIds: ["s2", "s1"],
    segments: [
      { id: "s1", runId: "r1", start: 10, end: 20, text: "a" },
      { id: "s2", runId: "r1", start: 42, end: 60, text: "b" }
    ],
    duration: 100
  })).toMatchObject({ start: 10, end: 60, alignmentWarning: false });
});

it("uses map-reduce above the 60 percent input budget", () => {
  expect(chooseSummaryPlan({ estimatedInputTokens: 7000, contextWindow: 10000, segmentCount: 1000 }))
    .toBe("map_reduce");
});
```

- [ ] **Step 2: Run summary tests and verify they fail**

Run: `pnpm vitest apps/worker/src/summary -r`

Expected: FAIL because alignment and budget functions do not exist.

- [ ] **Step 3: Implement summary planning, strict schema validation, alignment, and retry-once behavior**

Keep input below 60% of the context window and reserve output/retry space. Split map windows at transcript segment boundaries with 30–60 seconds overlap. Enforce no more than 15 final chapters by default. If a reference is missing or times are invalid, record `alignmentWarning` and apply deterministic min-start/max-end correction.

- [ ] **Step 4: Run summary integration tests with a fake provider**

Run: `pnpm vitest apps/worker/src/summary -r`

Expected: PASS, including malformed JSON, missing references, excessive chapters, and successful map-reduce alignment.

- [ ] **Step 5: Commit V1 summary generation**

```bash
git add apps/worker/src/summary apps/worker/src/providers/groq-summary.ts apps/worker/src/analysis/v0-runner.ts
git commit -m "feat: add v1 summaries and source alignment"
```

## Task 13: Add V1 search and results UI

**Files:**
- Create: `apps/api/src/search/search-service.ts`
- Create: `apps/api/src/routes/search.ts`
- Create: `apps/api/src/search/search-service.test.ts`
- Create: `apps/web/src/summary/SummaryPanel.tsx`
- Create: `apps/web/src/chapters/ChapterList.tsx`
- Create: `apps/web/src/search/SearchPanel.tsx`
- Create: `apps/web/src/summary/*.test.tsx`
- Create: `apps/web/src/search/*.test.tsx`
- Modify: `apps/api/src/db/repositories/search.ts`
- Modify: `apps/web/src/app.tsx`

**Interfaces:**

```ts
export type SearchResult = {
  sourceType: "transcript" | "chapter" | "bullet";
  sourceId: string;
  text: string;
  start: number;
  end: number;
};

export interface SearchService {
  query(input: { userId: string; runId: string; query: string; limit: number }): Promise<SearchResult[]>;
}
```

- [ ] **Step 1: Write failing search and click-to-seek tests**

```ts
it("uses substring fallback for one- and two-character Chinese queries", async () => {
  const result = await search.query({ userId: "u1", runId: "r1", query: "人", limit: 20 });
  expect(fakeDb.lastSearchMode).toBe("like");
  expect(result[0]).toMatchObject({ sourceType: "transcript", start: 12 });
});

it("seeks to a chapter's aligned start", async () => {
  const seek = vi.fn();
  render(<ChapterList chapters={[{ id: "ch1", title: "背景", start: 42, end: 60 }]} onSeek={seek} />);
  await userEvent.click(screen.getByRole("button", { name: /背景/ }));
  expect(seek).toHaveBeenCalledWith(42);
});
```

- [ ] **Step 2: Run search tests and verify they fail**

Run: `pnpm vitest apps/api/src/search apps/web/src/search apps/web/src/summary -r`

Expected: FAIL because search service and V1 panels do not exist.

- [ ] **Step 3: Implement `pg_trgm` indexing, `ILIKE` fallback, result authorization, summary tabs, chapters, bullets, and search UI**

Rebuild search rows per `runId` after transcript/summary writes. Return source-derived times only; never accept a time from the query string or client payload.

- [ ] **Step 4: Run API and browser V1 tests**

Run: `pnpm vitest apps/api/src/search apps/web/src -r && pnpm playwright test apps/web/e2e/v1.spec.ts`

Expected: PASS for summary display, chapter seek, bullet seek, transcript search, Chinese substring fallback, and tenant isolation.

- [ ] **Step 5: Commit V1 search and UI**

```bash
git add apps/api/src/search apps/web/src
git commit -m "feat: add v1 summaries chapters and search"
```

## Task 14: Add V1 playback compatibility and cache deletion

**Files:**
- Create: `apps/worker/src/media/playback-compatibility.ts`
- Create: `apps/api/src/routes/media.ts`
- Create: `apps/api/src/routes/videos-delete.ts`
- Create: `apps/worker/src/media/playback-compatibility.test.ts`
- Create: `apps/api/src/routes/videos-delete.test.ts`
- Modify: `apps/worker/src/media/media-processor.ts`
- Modify: `apps/web/src/player/VideoPlayer.tsx`

- [ ] **Step 1: Write failing compatibility and deletion tests**

```ts
it("uses explicit stream mapping when remuxing MKV", () => {
  expect(buildRemuxArgs("input.mkv", "output.mp4")).toEqual([
    "-i", "input.mkv", "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-c", "copy", "output.mp4"
  ]);
});

it("deletes all user-owned analysis objects", async () => {
  await deleteVideo({ userId: "u1", videoId: "v1" });
  expect(storage.deletedKeys).toEqual(expect.arrayContaining([
    "users/u1/videos/v1/original", "users/u1/runs/r1/audio.flac", "users/u1/runs/r1/summary.json"
  ]));
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm vitest apps/worker/src/media/playback-compatibility.test.ts apps/api/src/routes/videos-delete.test.ts`

Expected: FAIL because compatibility and deletion routes do not exist.

- [ ] **Step 3: Implement remux, playback validation hooks, authorized media URLs, and complete cleanup**

Remux must exclude subtitle and data streams. The browser player reports `loadedmetadata`, `canplay`, and a short seek/play validation result to the API. If validation fails after remux, set a user-visible unsupported-codec error and do not silently claim success.

- [ ] **Step 4: Run V1 media and deletion tests**

Run: `pnpm vitest apps/worker/src/media apps/api/src/routes/videos-delete.test.ts -r`

Expected: PASS.

- [ ] **Step 5: Commit compatibility and deletion**

```bash
git add apps/worker/src/media apps/api/src/routes/media.ts apps/api/src/routes/videos-delete.ts apps/web/src/player
git commit -m "feat: add playback compatibility and cache deletion"
```

## Task 15: Add Docker deployment, migrations, security headers, and operational limits

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/docker-compose.test.yml`
- Create: `apps/api/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `infra/reverse-proxy/Caddyfile`
- Create: `.env.example`
- Create: `docs/operations.md`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/config/env.ts`

- [ ] **Step 1: Write failing health and configuration tests**

```ts
it("rejects production startup without the server Groq key", () => {
  expect(() => parseEnv({ NODE_ENV: "production", GROQ_API_KEY: "" }))
    .toThrow("GROQ_API_KEY is required");
});

it("returns readiness only after database, Redis, and object storage checks pass", async () => {
  const response = await app.inject({ method: "GET", url: "/readyz" });
  expect(response.json()).toEqual({ status: "ready", dependencies: { database: "ok", redis: "ok", storage: "ok" } });
});
```

- [ ] **Step 2: Run configuration tests and verify they fail**

Run: `pnpm vitest apps/api/src/config apps/api/src/routes/health.test.ts -r`

Expected: FAIL because production env validation and readiness checks are not implemented.

- [ ] **Step 3: Implement Docker services, Caddy HTTPS proxy, CSP/security headers, upload limits, rate limits, queue concurrency, and `.env.example`**

`.env.example` contains variable names and safe placeholder text only; it must not be generated from or compared with the real `.env`. Set separate API and worker containers, run database migrations before readiness, and configure `MAX_UPLOAD_BYTES`, `MAX_VIDEO_DURATION_SECONDS`, `MAX_ACTIVE_RUNS_PER_USER`, `GLOBAL_WORKER_CONCURRENCY`, `ORIGINAL_RETENTION_DAYS=7`, and `RESULT_RETENTION_DAYS=30`.

- [ ] **Step 4: Run the Linux deployment smoke test**

Run: `docker compose -f infra/docker-compose.yml -f infra/docker-compose.test.yml up --build --abort-on-container-exit`

Expected: all health checks pass, migrations apply once, API and worker start, and no secret values appear in logs.

- [ ] **Step 5: Commit deployment assets**

```bash
git add infra apps/api/Dockerfile apps/worker/Dockerfile apps/web/Dockerfile .env.example docs/operations.md
git commit -m "chore: add linux deployment and service limits"
```

## Task 16: Run the complete V0/V1 acceptance suite and prepare the handoff

**Files:**
- Create: `tests/acceptance/v0-v1.acceptance.test.ts`
- Create: `tests/fixtures/README.md`
- Modify: `package.json`
- Modify: `docs/operations.md`

- [ ] **Step 1: Write the acceptance checklist as executable scenarios**

```ts
const requiredScenarios = [
  "verified user receives exactly two credits",
  "unverified user cannot analyze",
  "two users cannot read each other's videos",
  "completed ASR chunks are not resubmitted after restart",
  "429 and network timeout retry without leaking secrets",
  "no-audio video fails with actionable error",
  "summary references produce deterministic chapter times",
  "search results seek the player",
  "retention cleanup deletes expired objects"
];

it.each(requiredScenarios)("covers acceptance scenario: %s", async (scenario) => {
  expect(await runAcceptanceScenario(scenario)).toEqual({ status: "passed" });
});
```

- [ ] **Step 2: Run the full verification commands**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm playwright test
docker compose -f infra/docker-compose.yml -f infra/docker-compose.test.yml up --build --abort-on-container-exit
```

Expected: every command exits 0; acceptance output reports all required scenarios passed; no warnings contain secrets or unhandled promise errors.

- [ ] **Step 3: Document the tested platform matrix and provider configuration**

Record Linux distribution, Node version, browser versions, FFmpeg/FFprobe versions, fixture fingerprints, provider/model settings, and final task states in `docs/operations.md`. Do not record the API key or full signed URLs.

- [ ] **Step 4: Inspect repository state and commit only intended project files**

Run: `git status --short --branch` and verify `.env` is ignored and absent from the staged file list.

- [ ] **Step 5: Commit the acceptance evidence**

```bash
git add tests package.json docs/operations.md
git commit -m "test: verify v0 and v1 acceptance scenarios"
```

## Execution Notes

1. Execute Tasks 1–11 as V0. Stop at the V0 acceptance command and review the working product before starting Task 12.
2. Execute Tasks 12–14 as V1. Task 15 can run alongside late V1 work only when it does not hide application failures.
3. Use TDD for every behavior change: write one focused failing test, run it and inspect the expected failure, implement the smallest behavior, run the focused test, then run the relevant broader suite.
4. Use fake storage, fake queue, fake clock, fake SMTP, and fake AI providers in unit tests. Use MinIO/PostgreSQL/Redis containers for integration tests.
5. Never use the existing `.env` as a test fixture and never print its contents. The only production configuration read is the named `GROQ_API_KEY` variable.
6. The existing design document is committed locally but has not been pushed to GitHub; do not push it or this plan without explicit authorization for those files.

## Plan Self-Review

- **Spec coverage:** Authentication, email verification, two-credit trial, tenant isolation, platform key handling, V0 media/transcription/recovery, V1 summary/alignment/search/remux, retention, deployment, and acceptance testing each have explicit tasks.
- **Placeholder scan:** No task relies on undefined future work; all deferred features are outside the approved V0/V1 scope.
- **Type consistency:** `TranscriptSegment`, `AsrProvider`, `SummaryProvider`, `ObjectStorage`, `V0AnalysisRunner`, `SearchService`, and `UsageLedgerRepository` are defined before their consuming tasks.
- **Security check:** The plan never reads `.env`, never exposes `GROQ_API_KEY`, scopes object keys by user, and requires authorization on every resource route.
- **Scope check:** V0 is independently usable after Task 11; V1 extends the same persisted `analysisRun` model and does not require a second architecture.
