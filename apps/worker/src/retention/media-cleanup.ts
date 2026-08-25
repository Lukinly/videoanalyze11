import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Pool } from "pg";

const runMediaRoot = resolve("/tmp/videoanalyze");
const safeRunId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

type StorageDeleter = {
  delete(objectKey: string): Promise<void>;
};

export type MediaCleanupStatus = "pending" | "cleaning" | "complete" | "retry";
export type CleanupRunMediaStatus = MediaCleanupStatus | "missing";

type CleanupClaim =
  | { status: "cleaning"; claimed: true; objectKey: string; remote: boolean }
  | { status: CleanupRunMediaStatus; claimed: false };

export type MediaCleanupRepository = {
  claimRunMedia(runId: string, now: Date, leaseDurationMs: number): Promise<CleanupClaim>;
  completeRunMediaCleanup(input: { runId: string; objectKey: string; remote: boolean; now: Date }): Promise<void>;
  recordCleanupRetry(input: { runId: string; objectKey: string; error: string; now: Date }): Promise<void>;
};

export function createMediaCleanupRepository(pool: Pool): MediaCleanupRepository {
  return {
    async claimRunMedia(runId, now, leaseDurationMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const staleBefore = new Date(now.getTime() - leaseDurationMs);
        const claimed = await client.query<{ videoId: string }>(
          `UPDATE analysis_runs
           SET media_cleanup_status = 'cleaning', media_cleanup_attempts = media_cleanup_attempts + 1,
             media_cleanup_error = NULL, updated_at = $2
           WHERE id = $1
             AND status IN ('completed', 'failed', 'cancelled')
             AND (
               media_cleanup_status IN ('pending', 'failed')
               OR (media_cleanup_status = 'cleaning' AND updated_at <= $3)
             )
           RETURNING video_id AS "videoId"`,
          [runId, now, staleBefore]
        );
        const videoId = claimed.rows[0]?.videoId;
        if (!videoId) {
          const existing = await client.query<{ analysisStatus: string; cleanupStatus: string }>(
            `SELECT status AS "analysisStatus", media_cleanup_status AS "cleanupStatus"
             FROM analysis_runs WHERE id = $1`,
            [runId]
          );
          await client.query("COMMIT");
          const state = existing.rows[0];
          if (!state) return { status: "missing", claimed: false };
          if (!isTerminalAnalysisStatus(state.analysisStatus)) return { status: "pending", claimed: false };
          return { status: cleanupStatusFromDatabase(state.cleanupStatus), claimed: false };
        }
        const video = await client.query<{ objectKey: string; sourcePlatform: string }>(
          `SELECT object_key AS "objectKey", source_platform AS "sourcePlatform" FROM videos WHERE id = $1`,
          [videoId]
        );
        const objectKey = video.rows[0]?.objectKey;
        if (!objectKey) throw new Error("analysis media does not exist");
        await client.query("COMMIT");
        return { status: "cleaning", claimed: true, objectKey, remote: video.rows[0]?.sourcePlatform !== "upload" };
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
        if (!input.remote) {
          const transient = await client.query(
            `UPDATE transient_objects
             SET deleted_at = COALESCE(deleted_at, $3), last_cleanup_error = NULL
             WHERE video_id = (SELECT video_id FROM analysis_runs WHERE id = $1)
               AND object_key = $2 AND kind = 'original'`,
            [input.runId, input.objectKey, input.now]
          );
          requireOneRow(transient.rowCount, "transient objects");
          const video = await client.query(
            `UPDATE videos
             SET original_deleted_at = $2, status = 'missing', updated_at = $2
             WHERE id = (SELECT video_id FROM analysis_runs WHERE id = $1)`,
            [input.runId, input.now]
          );
          requireOneRow(video.rowCount, "videos");
        }
        const run = await client.query(
          `UPDATE analysis_runs
           SET media_cleanup_status = 'cleaned', media_cleanup_error = NULL,
             media_cleaned_at = $2, updated_at = $2
           WHERE id = $1 AND media_cleanup_status = 'cleaning' AND updated_at = $2`,
          [input.runId, input.now]
        );
        requireOneRow(run.rowCount, "analysis runs");
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
        const run = await client.query<{ videoId: string }>(
          `UPDATE analysis_runs
           SET media_cleanup_status = 'failed', media_cleanup_error = $2, updated_at = $3
           WHERE id = $1 AND media_cleanup_status = 'cleaning' AND updated_at = $3
           RETURNING video_id AS "videoId"`,
          [input.runId, input.error, input.now]
        );
        const videoId = run.rows[0]?.videoId;
        if (!videoId) {
          await client.query("COMMIT");
          return;
        }
        await client.query(
          `UPDATE transient_objects
           SET cleanup_attempts = cleanup_attempts + 1, last_cleanup_error = $3
           WHERE video_id = $1 AND object_key = $2 AND kind = 'original' AND deleted_at IS NULL`,
          [videoId, input.objectKey, input.error]
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
  leaseDurationMs?: number;
  removeLocalMedia?: () => Promise<void>;
}): Promise<{ status: CleanupRunMediaStatus }> {
  const leaseDurationMs = input.leaseDurationMs ?? 5 * 60 * 1000;
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new Error("cleanup lease duration must be a positive integer");
  }
  const removeLocalMedia = input.removeLocalMedia ?? (() => removeValidatedRunDirectory(input.runId));
  let claim: CleanupClaim;
  try {
    claim = await input.repository.claimRunMedia(input.runId, input.now, leaseDurationMs);
  } catch (claimError) {
    try {
      await removeLocalMedia();
    } catch {
      // The claim failure remains authoritative; without repository access a
      // local retry cannot be recorded, but cleanup is still attempted.
    }
    throw claimError;
  }
  if (!claim.claimed) return { status: claim.status };

  let deletionError: unknown;
  try {
    if (!claim.remote) await input.storage.delete(claim.objectKey);
  } catch (error) {
    if (!isMissingObjectError(error)) deletionError = error;
  }
  try {
    await removeLocalMedia();
  } catch (error) {
    deletionError ??= error;
  }

  try {
    if (deletionError) throw deletionError;
    await input.repository.completeRunMediaCleanup({ runId: input.runId, objectKey: claim.objectKey, remote: claim.remote, now: input.now });
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
  markCompleted(): Promise<boolean>;
  markFailedOrCancelled(error: unknown): Promise<boolean>;
  settleSuccess(): Promise<void>;
  settleFailure(error: unknown): Promise<void>;
  cleanupMedia(): Promise<unknown>;
  logger?: Pick<Console, "error">;
}): Promise<void> {
  let terminalPersisted = false;
  try {
    await input.runAndPersist();
    terminalPersisted = await input.markCompleted();
    if (!terminalPersisted) throw new Error("analysis terminal transition was not persisted");
    await input.settleSuccess();
  } catch (error) {
    if (terminalPersisted) throw error;
    terminalPersisted = await input.markFailedOrCancelled(error);
    if (!terminalPersisted) throw error;
    try {
      await input.settleFailure(error);
    } catch (settlementError) {
      (input.logger ?? console).error("credit settlement failed", settlementError);
    }
    throw error;
  } finally {
    if (terminalPersisted) {
      try {
        await input.cleanupMedia();
      } catch (cleanupError) {
        (input.logger ?? console).error("media cleanup failed", cleanupError);
      }
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
  const message = error instanceof Error ? error.message : "media cleanup failed";
  return Array.from(message, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("").trim().slice(0, 500) || "media cleanup failed";
}

function isTerminalAnalysisStatus(status: string): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

function cleanupStatusFromDatabase(status: string): MediaCleanupStatus {
  const mapped: Record<string, MediaCleanupStatus> = {
    pending: "pending",
    cleaning: "cleaning",
    cleaned: "complete",
    failed: "retry"
  };
  const semantic = mapped[status];
  if (!semantic) throw new Error(`unsupported media cleanup status: ${status}`);
  return semantic;
}

function requireOneRow(rowCount: number | null, table: string): void {
  if (rowCount !== 1) throw new Error(`cleanup metadata update affected ${rowCount ?? 0} ${table}`);
}
