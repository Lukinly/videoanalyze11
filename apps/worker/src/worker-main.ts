import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { createAnalysisConsumer } from "./queue/analysis-consumer.js";
import type { AnalysisJob } from "./queue/queues.js";
import { createV0AnalysisRunner } from "./analysis/v0-runner.js";
import { buildChunkManifest } from "./media/chunk-manifest.js";
import { createMediaProcessor } from "./media/media-processor.js";
import { createGroqAsrProvider } from "./providers/groq-asr.js";
import { createAnthropicSummaryProvider } from "./providers/anthropic-summary.js";
import { createV1SummaryRunner } from "./summary/v1-runner.js";
import { createNotesRunner } from "./notes/notes-runner.js";
import { MAX_VIDEO_DURATION_SECONDS, type RetentionMode, type TranscriptSegment } from "@videoanalyze/domain";
import { createWorkerCreditRepository } from "./credits/credit-repository.js";
import { AnalysisCancelledError } from "./analysis/cancellation.js";
import { settleAnalysisFailure, settleAnalysisSuccess } from "./analysis/settlement.js";
import { createResultStore, privacyResultExpiry, type ResultStore } from "./results/result-store.js";
import {
  cleanupRunMedia,
  createMediaCleanupRepository,
  removeValidatedRunDirectory,
  runAnalysisToTerminal,
  validatedRunDirectory
} from "./retention/media-cleanup.js";
import { runRetentionSweep, sanitizeCleanupError } from "./retention/cleanup-worker.js";
import { createRetentionRepository } from "./retention/retention-repository.js";
import { startRetentionScheduler } from "./retention/retention-scheduler.js";
import { FifoSemaphore, KeyedFifoSemaphore } from "./concurrency/semaphore.js";
import { requireStageUpdate } from "./analysis/stage-fence.js";
import { createPlatformSourceLoader, materializeImportedSegments, type RemoteVideoSource } from "./links/platform-source.js";

const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://videoanalyze:videoanalyze@127.0.0.1:5433/videoanalyze",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqAsrModel: process.env.GROQ_ASR_MODEL ?? "whisper-large-v3-turbo",
  s3Endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "videoanalyze",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "minioadmin",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "minioadmin",
  concurrency: Number(process.env.GLOBAL_WORKER_CONCURRENCY ?? 2),
  ffmpegConcurrency: Number(process.env.FFMPEG_CONCURRENCY ?? 1),
  longVideoConcurrency: Number(process.env.LONG_VIDEO_CONCURRENCY ?? 1),
  longVideoThresholdSeconds: Number(process.env.LONG_VIDEO_THRESHOLD_SECONDS ?? 7_200),
  retentionSweepIntervalSeconds: Number(process.env.RETENTION_SWEEP_INTERVAL_SECONDS ?? 900),
  // V1 summary uses a separate LLM (chat completions, Anthropic-compatible
  // endpoint). Read lowercase names first so the .env sample works verbatim.
  llmApiKey: process.env.LLM_API_KEY ?? process.env.llm_api_key ?? "",
  llmApiBaseUrl: process.env.LLM_API_BASE_URL ?? process.env.llm_api_base_url ?? "",
  llmApiModel: process.env.LLM_API_MODEL ?? process.env.llm_api_model ?? "",
  llmContextWindow: Number(process.env.LLM_CONTEXT_WINDOW ?? 128_000)
};

if (!env.groqApiKey) throw new Error("GROQ_API_KEY is required by the worker");

const pool = new Pool({ connectionString: env.databaseUrl, max: Math.max(2, env.concurrency + 1) });
const s3 = new S3Client({ endpoint: env.s3Endpoint, region: env.s3Region, forcePathStyle: true, credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey } });
const rawMedia = createMediaProcessor({});
const ffmpegSemaphore = new FifoSemaphore(positiveInteger(env.ffmpegConcurrency, 1));
const longVideoSemaphore = new FifoSemaphore(positiveInteger(env.longVideoConcurrency, 1));
const perUserSemaphore = new KeyedFifoSemaphore(1);
const media: ReturnType<typeof createMediaProcessor> = {
  probe: rawMedia.probe,
  extractAudio: (...args) => ffmpegSemaphore.run(() => rawMedia.extractAudio(...args)),
  renderChunk: (...args) => ffmpegSemaphore.run(() => rawMedia.renderChunk(...args)),
  remuxToMp4: (...args) => ffmpegSemaphore.run(() => rawMedia.remuxToMp4(...args))
};
const asr = createGroqAsrProvider({ apiKey: env.groqApiKey, model: env.groqAsrModel });
const summaryProvider = env.llmApiKey && env.llmApiBaseUrl && env.llmApiModel
  ? createAnthropicSummaryProvider({ apiKey: env.llmApiKey, baseUrl: env.llmApiBaseUrl, model: env.llmApiModel, contextWindow: env.llmContextWindow })
  : null;
const credits = createWorkerCreditRepository(pool);
const results = createResultStore(pool);
const mediaCleanup = createMediaCleanupRepository(pool);
const retention = createRetentionRepository(pool);
const platformSources = createPlatformSourceLoader();
const clock = { now: () => new Date() };
const storageDeleter = {
  async delete(objectKey: string) {
    await withSanitizedCleanupError(() => s3.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: objectKey })));
  }
};

const cleanupTerminalRun = (runId: string, now: Date) => cleanupRunMedia({
  runId,
  storage: storageDeleter,
  repository: mediaCleanup,
  now,
  leaseDurationMs: 5 * 60 * 1000,
  removeLocalMedia: () => withSanitizedCleanupError(() => removeValidatedRunDirectory(runId))
});

const consumer = createAnalysisConsumer({
  connection: redisConnectionFromUrl(env.redisUrl),
  concurrency: Number.isSafeInteger(env.concurrency) && env.concurrency > 0 ? env.concurrency : 2,
  runner: {
    async run(job: AnalysisJob & { signal: AbortSignal }) {
      await perUserSemaphore.run(job.userId, async () => {
        const directory = validatedRunDirectory(job.runId);
        const state = createDatabaseState({ pool, s3, bucket: env.s3Bucket, directory, media, results, credits, clock });
        await runAnalysisToTerminal({
          async runAndPersist() {
            if (job.signal.aborted || await state.isCancelling(job.runId)) throw new AnalysisCancelledError("before_processing");
            await requireStageUpdate(() => state.setStage(job.runId, "probing", 0.01));
            const source = await state.getSourceInfo(job.runId);
            let transcriptImported = false;
            if (source.remote) {
              await state.ensureBilling(job.runId, source.duration);
              const imported = await platformSources.tryTranscript(source.remote, directory, job.signal);
              if (imported?.length) {
                await requireStageUpdate(() => state.setStage(job.runId, "transcribing", 0.5));
                await state.saveTranscript(job.runId, materializeImportedSegments(job.runId, imported), []);
                await requireStageUpdate(() => state.setStage(job.runId, "merging_transcript", 0.95));
                transcriptImported = true;
              } else {
                const audioPath = await platformSources.downloadAudio(source.remote, directory, job.signal);
                const downloaded = await media.probe(audioPath);
                if (downloaded.duration > MAX_VIDEO_DURATION_SECONDS) throw new Error("downloaded audio exceeds the four-hour limit");
                state.setRemoteInput(audioPath, downloaded.duration);
              }
            }
            const process = async () => {
              if (!transcriptImported) await createV0AnalysisRunner({ asr, media, state }).run(job);
              if (!summaryProvider) throw new Error("summary and AI notes provider is required");
              await createV1SummaryRunner({ summary: summaryProvider, state }).run({ runId: job.runId });
              await createNotesRunner({ notes: summaryProvider, state }).run({ runId: job.runId });
            };
            if (source.duration > env.longVideoThresholdSeconds) await longVideoSemaphore.run(process);
            else await process();
          },
          markCompleted: () => state.markCompleted(job.runId),
          async markFailedOrCancelled(error) {
            const status = error instanceof AnalysisCancelledError ? "cancelled" : "failed";
            const result = await pool.query<{ status: string }>(
              `UPDATE analysis_runs SET status = $2, error = $3, updated_at = $4
               WHERE id = $1 AND status IN ('queued', 'running', 'cancelling') RETURNING status`,
              [job.runId, status, error instanceof Error ? error.message : "analysis failed", clock.now()]
            );
            return result.rowCount === 1 && result.rows[0]?.status === status;
          },
          settleSuccess: () => settleAnalysisSuccess({ runId: job.runId, credits }),
          settleFailure: (error) => settleAnalysisFailure({ runId: job.runId, error, credits }),
          cleanupMedia: () => cleanupTerminalRun(job.runId, clock.now())
        });
      });
    }
  }
});

const retentionScheduler = startRetentionScheduler({
  clock,
  intervalMs: validRetentionSweepIntervalMs(env.retentionSweepIntervalSeconds),
  sweep: ({ now }) => runRetentionSweep({
    now,
    repository: retention,
    storage: storageDeleter,
    cleanupTerminalRun,
    credits
  })
});

let shutdownPromise: Promise<void> | null = null;
const shutdown = () => {
  shutdownPromise ??= (async () => {
    await retentionScheduler.close();
    await consumer.close();
    await pool.end();
  })();
  return shutdownPromise;
};

process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

function createDatabaseState(input: {
  pool: Pool;
  s3: S3Client;
  bucket: string;
  directory: string;
  media: ReturnType<typeof createMediaProcessor>;
  results: ResultStore;
  credits: ReturnType<typeof createWorkerCreditRepository>;
  clock: { now(): Date };
}) {
  let cachedRun: { inputVideoPath: string; audioPath: string; duration: number } | null = null;
  async function getResultContext(runId: string) {
    const result = await input.pool.query<{ userId: string; mode: RetentionMode; expiresAt: Date | null }>(
      `SELECT user_id AS "userId", retention_mode AS mode, result_expires_at AS "expiresAt"
       FROM analysis_runs WHERE id = $1`,
      [runId]
    );
    const context = result.rows[0];
    if (!context) throw new Error("analysis run does not exist");
    return context;
  }

  async function updateStage(runId: string, stage: string, progress: number): Promise<boolean> {
    const updatedAt = input.clock.now();
    if (stage === "completed") {
      const context = await getResultContext(runId);
      if (context.mode === "privacy") {
        await input.results.finalizePrivacyExpiry(runId, privacyResultExpiry(updatedAt));
      }
    }
    return input.results.updateStage(runId, stage, progress, updatedAt);
  }

  return {
    async getSourceInfo(runId: string): Promise<{ duration: number; remote: RemoteVideoSource | null }> {
      const result = await input.pool.query<{ duration: number | null; platform: string; url: string | null; subtitleLanguage: string | null }>(
        `SELECT v.duration, v.source_platform AS platform, v.source_url AS url, v.subtitle_language AS "subtitleLanguage"
         FROM analysis_runs ar JOIN videos v ON v.id = ar.video_id WHERE ar.id = $1`, [runId]);
      const row = result.rows[0];
      if (!row || !row.duration) throw new Error("analysis source duration is unavailable");
      const remote = row.platform === "youtube" || row.platform === "bilibili"
        ? { platform: row.platform, url: row.url ?? "", subtitleLanguage: row.subtitleLanguage } as RemoteVideoSource : null;
      if (remote && !remote.url) throw new Error("analysis source URL is unavailable");
      return { duration: row.duration, remote };
    },
    setRemoteInput(inputPath: string, duration: number) {
      cachedRun = { inputVideoPath: inputPath, audioPath: `${input.directory}/audio.flac`, duration };
    },
    async ensureBilling(runId: string, durationSeconds: number) {
      const context = await getResultContext(runId);
      const snapshot = await input.credits.reserveForDuration({ runId, userId: context.userId, durationSeconds });
      if (snapshot === "exhausted") throw new Error("credits exhausted for server-probed video duration");
      return snapshot;
    },
    async getRun(runId: string) {
      if (cachedRun) return cachedRun;
      const result = await input.pool.query<{ userId: string; objectKey: string; duration: number | null; platform: string }>(
        `SELECT ar.user_id AS "userId", v.object_key AS "objectKey", v.duration, v.source_platform AS platform
         FROM analysis_runs ar JOIN videos v ON v.id = ar.video_id
         WHERE ar.id = $1`, [runId]
      );
      const row = result.rows[0];
      if (!row) throw new Error("analysis run does not exist");
      if (row.platform !== "upload") throw new Error("remote source was not prepared");
      await mkdir(input.directory, { recursive: true });
      const inputVideoPath = `${input.directory}/original`;
      try { await stat(inputVideoPath); } catch { await downloadObject(input.s3, input.bucket, row.objectKey, inputVideoPath); }
      const mediaInfo = await input.media.probe(inputVideoPath);
      if (row.duration === null) await input.pool.query("UPDATE videos SET duration = $2, updated_at = $3 WHERE object_key = $1", [row.objectKey, mediaInfo.duration, new Date()]);
      cachedRun = { inputVideoPath, audioPath: `${input.directory}/audio.flac`, duration: row.duration ?? mediaInfo.duration };
      return cachedRun;
    },
    async getChunks(runId: string): Promise<Array<{ index: number; start: number; end: number; status: "pending" | "processing" | "completed" | "failed"; transcript: Array<{ start: number; end: number; text: string }> | null }>> {
      const existing = await input.pool.query<{ userId: string; start: number; end: number; index: number; status: "pending" | "processing" | "completed" | "failed"; transcriptJson: unknown }>(
        `SELECT user_id AS "userId", start_seconds AS start, end_seconds AS end, chunk_index AS index, status, transcript_json AS "transcriptJson" FROM chunks WHERE run_id = $1 ORDER BY chunk_index`, [runId]
      );
      if (existing.rows.length > 0) return existing.rows.map((chunk) => ({ index: chunk.index, start: chunk.start, end: chunk.end, status: chunk.status, transcript: Array.isArray(chunk.transcriptJson) ? chunk.transcriptJson as Array<{ start: number; end: number; text: string }> : null }));

      const run = await this.getRun(runId);
      const owner = await input.pool.query<{ userId: string }>("SELECT user_id AS \"userId\" FROM analysis_runs WHERE id = $1", [runId]);
      const userId = owner.rows[0]?.userId;
      if (!userId) throw new Error("analysis owner does not exist");
      const manifest = buildChunkManifest({ duration: run.duration, targetSeconds: 600, overlapSeconds: 8, maxBytes: 20_000_000, estimateBytes: ({ start, end }) => Math.ceil((end - start) * 32_000) });
      for (const chunk of manifest.chunks) {
        await input.pool.query(
          `INSERT INTO chunks (id, user_id, run_id, chunk_index, start_seconds, end_seconds, object_key, file_size, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'pending') ON CONFLICT (run_id, chunk_index) DO NOTHING`,
          [randomUUID(), userId, runId, chunk.index, chunk.start, chunk.end, `users/${userId}/runs/${runId}/chunks/${chunk.index}.flac`]
        );
      }
      return this.getChunks(runId);
    },
    async setStage(runId: string, stage: string, progress = 0) {
      return updateStage(runId, stage, progress);
    },
    async markCompleted(runId: string) {
      return updateStage(runId, "completed", 1);
    },
    async isCancelling(runId: string) {
      const result = await input.pool.query<{ status: string }>("SELECT status FROM analysis_runs WHERE id = $1", [runId]);
      return result.rows[0]?.status === "cancelling";
    },
    async markChunkProcessing(runId: string, index: number) { await input.results.markChunkProcessing(runId, index); },
    async saveChunkTranscript(runId: string, index: number, transcript: Array<{ start: number; end: number; text: string }>) { await input.results.saveChunkTranscript(runId, index, transcript); },
    async markChunkCompleted(runId: string, index: number) { await input.results.markChunkCompleted(runId, index); },
    async saveTranscript(runId: string, segments: unknown[], mergeWarnings: string[]) {
      const context = await getResultContext(runId);
      await input.results.saveTranscript({ runId, userId: context.userId, mode: context.mode, expiresAt: context.expiresAt, segments: segments as TranscriptSegment[] });
      if (mergeWarnings.length > 0) await input.pool.query("UPDATE analysis_runs SET error = $2 WHERE id = $1", [runId, mergeWarnings.join("; ")]);
    },
    async getTranscript(runId: string) {
      return input.results.getTranscript(runId);
    },
    async saveSummary(runId: string, result: Parameters<ResultStore["saveSummary"]>[0]["result"]) {
      const context = await getResultContext(runId);
      await input.results.saveSummary({ runId, userId: context.userId, mode: context.mode, expiresAt: context.expiresAt, result });
    },
    async saveNotes(runId: string, notes: Parameters<ResultStore["saveNotes"]>[0]["notes"]) {
      const context = await getResultContext(runId);
      await input.results.saveNotes({ runId, userId: context.userId, mode: context.mode, expiresAt: context.expiresAt, notes });
    }
  };
}

async function downloadObject(client: S3Client, bucket: string, key: string, destination: string) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error("object storage returned an empty video");
  await pipeline(result.Body as NodeJS.ReadableStream, createWriteStream(destination));
}

function redisConnectionFromUrl(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return { host: parsed.hostname, port: Number(parsed.port || 6379), password: parsed.password || undefined, tls: parsed.protocol === "rediss:" ? {} : undefined };
}

function validRetentionSweepIntervalMs(seconds: number): number {
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : 900_000;
}

function positiveInteger(value: number, fallback: number) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

async function withSanitizedCleanupError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const sanitized = new Error(sanitizeCleanupError(error));
    if (typeof error === "object" && error !== null) {
      const source = error as { code?: unknown; name?: unknown; $metadata?: unknown };
      if (source.code !== undefined) Object.assign(sanitized, { code: source.code });
      if (source.name !== undefined) sanitized.name = String(source.name);
      if (source.$metadata !== undefined) Object.assign(sanitized, { $metadata: source.$metadata });
    }
    throw sanitized;
  }
}
