import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { createAnalysisConsumer } from "./queue/analysis-consumer.js";
import type { AnalysisJob } from "./queue/queues.js";
import { createV0AnalysisRunner } from "./analysis/v0-runner.js";
import { createMediaProcessor } from "./media/media-processor.js";
import { createGroqAsrProvider } from "./providers/groq-asr.js";
import { createSummaryProvider } from "./providers/summary-provider.js";
import { createV1SummaryRunner } from "./summary/v1-runner.js";
import { createNotesRunner } from "./notes/notes-runner.js";
import { MAX_VIDEO_DURATION_SECONDS } from "@videoanalyze/domain";
import { createWorkerCreditRepository } from "./credits/credit-repository.js";
import { AnalysisCancelledError } from "./analysis/cancellation.js";
import { settleAnalysisFailure, settleAnalysisSuccess } from "./analysis/settlement.js";
import { createResultStore } from "./results/result-store.js";
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
import { createPlatformSourceLoader, materializeImportedSegments } from "./links/platform-source.js";

import { createDatabaseState } from "./analysis/database-state.js";

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
  // Summary and notes share a configurable Anthropic or OpenAI-compatible LLM.
  // Accept both uppercase configuration and the original lowercase names.
  llmApiKey: process.env.LLM_API_KEY ?? process.env.llm_api_key ?? "",
  llmApiBaseUrl: process.env.LLM_API_BASE_URL ?? process.env.llm_api_base_url ?? "",
  llmApiModel: process.env.LLM_API_MODEL ?? process.env.llm_api_model ?? "",
  llmContextWindow: Number(process.env.LLM_CONTEXT_WINDOW ?? 128_000),
  llmApiProtocol: process.env.LLM_API_PROTOCOL ?? process.env.llm_api_protocol ?? "auto"
};

if (!env.groqApiKey || env.groqApiKey.startsWith("replace-")) throw new Error("GROQ_API_KEY is required by the worker");
if (!env.llmApiKey || !env.llmApiBaseUrl || !env.llmApiModel) throw new Error("LLM API key, base URL and model are required by the worker");

const pool = new Pool({ connectionString: env.databaseUrl, max: Math.max(2, env.concurrency + 1) });
const s3 = new S3Client({ endpoint: env.s3Endpoint, region: env.s3Region, forcePathStyle: true, credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey } });
const rawMedia = createMediaProcessor({});
const ffmpegSemaphore = new FifoSemaphore(positiveInteger(env.ffmpegConcurrency, 1));
const longVideoSemaphore = new FifoSemaphore(positiveInteger(env.longVideoConcurrency, 1));
const perUserSemaphore = new KeyedFifoSemaphore(1);
const media: ReturnType<typeof createMediaProcessor> = {
  probe: rawMedia.probe,
  probeAudio: rawMedia.probeAudio,
  extractAudio: (...args) => ffmpegSemaphore.run(() => rawMedia.extractAudio(...args)),
  renderChunk: (...args) => ffmpegSemaphore.run(() => rawMedia.renderChunk(...args)),
  remuxToMp4: (...args) => ffmpegSemaphore.run(() => rawMedia.remuxToMp4(...args)),
  captureFrame: (...args) => ffmpegSemaphore.run(() => rawMedia.captureFrame(...args))
};
const asr = createGroqAsrProvider({ apiKey: env.groqApiKey, model: env.groqAsrModel });
const summaryProvider = env.llmApiKey && env.llmApiBaseUrl && env.llmApiModel
  ? createSummaryProvider({ protocol: env.llmApiProtocol, apiKey: env.llmApiKey, baseUrl: env.llmApiBaseUrl, model: env.llmApiModel, contextWindow: env.llmContextWindow })
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
                const downloaded = await media.probeAudio(audioPath);
                if (downloaded.duration > MAX_VIDEO_DURATION_SECONDS) throw new Error("downloaded audio exceeds the four-hour limit");
                state.setRemoteInput(audioPath, downloaded.duration);
              }
            }
            const process = async () => {
              if (!transcriptImported) await createV0AnalysisRunner({ asr, media, state }).run(job);
              if (!summaryProvider) throw new Error("summary and AI notes provider is required");
              await createV1SummaryRunner({ summary: summaryProvider, state }).run({ runId: job.runId });
              // Resolve video only when notes are ready, since remote URLs expire.
              // A rejected promise is cached too, avoiding repeated blocked requests.
              let frameSource: Promise<{ path: string; headers?: Record<string, string> }> | undefined;
              await createNotesRunner({ notes: summaryProvider, state, captureFrame: async (seconds) => {
                if (await state.isCancelling(job.runId)) throw new AnalysisCancelledError("after_processing");
                frameSource ??= source.remote
                  ? platformSources.resolveFrameSource(source.remote, job.signal)
                  : state.getRun(job.runId).then((run) => ({ path: run.inputVideoPath }));
                return media.captureFrame(await frameSource, `${directory}/note-frame.jpg`, seconds, job.signal);
              } }).run({ runId: job.runId, signal: job.signal });
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
