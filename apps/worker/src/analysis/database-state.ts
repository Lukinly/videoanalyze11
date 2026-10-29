import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import { MAX_VIDEO_DURATION_SECONDS, type RetentionMode, type TranscriptSegment } from "@videoanalyze/domain";
import { buildChunkManifest } from "../media/chunk-manifest.js";
import type { createMediaProcessor } from "../media/media-processor.js";
import type { createWorkerCreditRepository } from "../credits/credit-repository.js";
import { privacyResultExpiry, type ResultStore } from "../results/result-store.js";
import type { RemoteVideoSource } from "../links/platform-source.js";

export function createDatabaseState(input: {
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
      if (!row) throw new Error("analysis source does not exist");
      if (row.platform === "upload") return { duration: (await this.getRun(runId)).duration, remote: null };
      if (!row.duration || row.duration <= 0 || !Number.isFinite(row.duration) || row.duration > MAX_VIDEO_DURATION_SECONDS) throw new Error("analysis source duration is unavailable or exceeds the four-hour limit");
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
      if (!Number.isFinite(mediaInfo.duration) || mediaInfo.duration <= 0 || mediaInfo.duration > MAX_VIDEO_DURATION_SECONDS) throw new Error("video duration must be positive and within the four-hour limit");
      await input.pool.query("UPDATE videos SET duration = $2, updated_at = $3 WHERE object_key = $1", [row.objectKey, mediaInfo.duration, new Date()]);
      cachedRun = { inputVideoPath, audioPath: `${input.directory}/audio.flac`, duration: mediaInfo.duration };
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
