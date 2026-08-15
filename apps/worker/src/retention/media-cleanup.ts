import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Pool } from "pg";

const runMediaRoot = resolve("/tmp/videoanalyze");
const safeRunId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

type StorageDeleter = {
  delete(objectKey: string): Promise<void>;
};

type CleanupClaim = {
  objectKey: string;
};

export type MediaCleanupStatus = "pending" | "cleaning" | "complete" | "retry";

export type MediaCleanupRepository = {
  claimRunMedia(runId: string, now: Date): Promise<CleanupClaim | null>;
  completeRunMediaCleanup(input: { runId: string; objectKey: string; now: Date }): Promise<void>;
  recordCleanupRetry(input: { runId: string; objectKey: string; error: string; now: Date }): Promise<void>;
};

export function createMediaCleanupRepository(pool: Pool): MediaCleanupRepository {
  return {
    async claimRunMedia(runId, now) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query<{ videoId: string }>(
          `UPDATE analysis_runs
           SET media_cleanup_status = 'cleaning', media_cleanup_attempts = media_cleanup_attempts + 1,
             media_cleanup_error = NULL, updated_at = $2
           WHERE id = $1
             AND status IN ('completed', 'failed', 'cancelled')
             AND media_cleanup_status IN ('pending', 'failed')
           RETURNING video_id AS "videoId"`,
          [runId, now]
        );
        const videoId = claimed.rows[0]?.videoId;
        if (!videoId) {
          await client.query("COMMIT");
          return null;
        }
        const video = await client.query<{ objectKey: string }>(
          `SELECT object_key AS "objectKey" FROM videos WHERE id = $1`,
          [videoId]
        );
        const objectKey = video.rows[0]?.objectKey;
        if (!objectKey) throw new Error("analysis media does not exist");
        await client.query("COMMIT");
        return { objectKey };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async completeRunMediaCleanup(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE videos
           SET original_deleted_at = $2, status = 'missing', updated_at = $2
           WHERE id = (SELECT video_id FROM analysis_runs WHERE id = $1)`,
          [input.runId, input.now]
        );
        await client.query(
          `UPDATE transient_objects
           SET deleted_at = COALESCE(deleted_at, $3), last_cleanup_error = NULL
           WHERE video_id = (SELECT video_id FROM analysis_runs WHERE id = $1)
             AND object_key = $2 AND kind = 'original'`,
          [input.runId, input.objectKey, input.now]
        );
        await client.query(
          `UPDATE analysis_runs
           SET media_cleanup_status = 'cleaned', media_cleanup_error = NULL,
             media_cleaned_at = $2, updated_at = $2
           WHERE id = $1`,
          [input.runId, input.now]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async recordCleanupRetry(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE transient_objects
           SET cleanup_attempts = cleanup_attempts + 1, last_cleanup_error = $3
           WHERE video_id = (SELECT video_id FROM analysis_runs WHERE id = $1)
             AND object_key = $2 AND kind = 'original' AND deleted_at IS NULL`,
          [input.runId, input.objectKey, input.error]
        );
        await client.query(
          `UPDATE analysis_runs
           SET media_cleanup_status = 'failed', media_cleanup_error = $2, updated_at = $3
           WHERE id = $1`,
          [input.runId, input.error, input.now]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export async function cleanupRunMedia(input: {
  runId: string;
  storage: StorageDeleter;
  repository: MediaCleanupRepository;
  now: Date;
}): Promise<{ status: Extract<MediaCleanupStatus, "complete" | "retry"> }> {
  const claim = await input.repository.claimRunMedia(input.runId, input.now);
  if (!claim) return { status: "complete" };

  try {
    try {
      await input.storage.delete(claim.objectKey);
    } catch (error) {
      if (!isMissingObjectError(error)) throw error;
    }
    await input.repository.completeRunMediaCleanup({ runId: input.runId, objectKey: claim.objectKey, now: input.now });
    return { status: "complete" };
  } catch (error) {
    await input.repository.recordCleanupRetry({
      runId: input.runId,
      objectKey: claim.objectKey,
      error: errorMessage(error),
      now: input.now
    });
    return { status: "retry" };
  }
}

export async function runAnalysisToTerminal(input: {
  runAndPersist(): Promise<void>;
  markCompleted(): Promise<void>;
  markFailedOrCancelled(error: unknown): Promise<void>;
  settleSuccess(): Promise<void>;
  settleFailure(error: unknown): Promise<void>;
  cleanupMedia(): Promise<unknown>;
  removeLocalMedia(): Promise<void>;
  logger?: Pick<Console, "error">;
}): Promise<void> {
  let completionCommitted = false;
  try {
    await input.runAndPersist();
    await input.markCompleted();
    completionCommitted = true;
    await input.settleSuccess();
  } catch (error) {
    if (completionCommitted) throw error;
    await input.markFailedOrCancelled(error);
    try {
      await input.settleFailure(error);
    } catch (settlementError) {
      (input.logger ?? console).error("credit settlement failed", settlementError);
    }
    throw error;
  } finally {
    try {
      await input.cleanupMedia();
    } catch (cleanupError) {
      (input.logger ?? console).error("media cleanup failed", cleanupError);
    }
    try {
      await input.removeLocalMedia();
    } catch (localCleanupError) {
      (input.logger ?? console).error("local media cleanup failed", localCleanupError);
    }
  }
}

export function validatedRunDirectory(runId: string): string {
  if (!safeRunId.test(runId)) throw new Error("unsafe run id for local media cleanup");
  const target = resolve(runMediaRoot, runId);
  if (dirname(target) !== runMediaRoot || target !== join(runMediaRoot, runId)) {
    throw new Error("unsafe run id for local media cleanup");
  }
  return target;
}

export async function removeValidatedRunDirectory(runId: string): Promise<void> {
  await rm(validatedRunDirectory(runId), { recursive: true, force: true });
}

function isMissingObjectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return [candidate.code, candidate.name].some((value) => ["NoSuchKey", "NotFound", "404"].includes(String(value)))
    || candidate.$metadata?.httpStatusCode === 404;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "media cleanup failed";
}
