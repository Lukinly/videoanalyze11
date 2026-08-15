import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { RetentionSweepRepository } from "./cleanup-worker.js";

const claimLimit = 100;

export function createRetentionRepository(pool: Pool): RetentionSweepRepository {
  return {
    async claimExpiredTransientObjects(now) {
      return inTransaction(pool, async (client) => {
        const claimToken = randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
        const result = await client.query<{ id: string; key: string; kind: "original" | "temporary" | "result"; videoId: string | null; claimToken: string }>(
          `WITH claimed AS (
             SELECT transient.id
             FROM transient_objects transient
             WHERE transient.deleted_at IS NULL
               AND transient.expires_at <= $1
               AND (
                 transient.cleanup_status IN ('pending', 'failed')
                 OR (transient.cleanup_status = 'cleaning' AND transient.cleanup_lease_expires_at <= $1)
               )
               AND (
                 (transient.run_id IS NULL AND NOT EXISTS (
                   SELECT 1 FROM analysis_runs linked WHERE linked.video_id = transient.video_id
                 ))
                 OR (transient.kind <> 'original' AND EXISTS (
                   SELECT 1 FROM analysis_runs run WHERE run.id = transient.run_id
                     AND run.status IN ('completed', 'failed', 'cancelled')
                 ))
               )
             ORDER BY transient.expires_at, transient.id
             FOR UPDATE SKIP LOCKED
             LIMIT ${claimLimit}
           )
           UPDATE transient_objects transient
           SET cleanup_status = 'cleaning', cleanup_lease_expires_at = $2,
             cleanup_claim_token = $3, cleanup_attempts = cleanup_attempts + 1,
             last_cleanup_error = NULL
           FROM claimed
           WHERE transient.id = claimed.id
           RETURNING transient.id, transient.object_key AS key,
             CASE
               WHEN transient.kind = 'original' THEN 'original'
               WHEN transient.kind = 'temporary_result' THEN 'result'
               ELSE 'temporary'
             END AS kind,
             CASE WHEN transient.kind = 'original' THEN transient.video_id ELSE NULL END AS "videoId",
             transient.cleanup_claim_token AS "claimToken"`,
          [now, leaseExpiresAt, claimToken]
        );
        return result.rows;
      });
    },

    async markTransientObjectDeleted(input) {
      await inTransaction(pool, async (client) => {
        const transient = await client.query(
          `UPDATE transient_objects
           SET deleted_at = COALESCE(deleted_at, $2), last_cleanup_error = NULL,
             cleanup_status = 'cleaned', cleanup_lease_expires_at = NULL, cleanup_claim_token = NULL
           WHERE id = $1 AND cleanup_claim_token = $3 AND cleanup_status = 'cleaning'`,
          [input.objectId, input.now, input.claimToken]
        );
        if (transient.rowCount === 1 && input.videoId) {
          await client.query(
            `UPDATE videos
             SET original_deleted_at = COALESCE(original_deleted_at, $2), status = 'missing', updated_at = $2
             WHERE id = $1`,
            [input.videoId, input.now]
          );
        }
      });
    },

    async recordTransientObjectRetry(input) {
      await pool.query(
        `UPDATE transient_objects
         SET cleanup_status = 'failed', cleanup_lease_expires_at = NULL,
           cleanup_claim_token = NULL, last_cleanup_error = $3
         WHERE id = $1 AND cleanup_claim_token = $2 AND cleanup_status = 'cleaning' AND deleted_at IS NULL`,
        [input.objectId, input.claimToken, input.error]
      );
    },

    async claimTerminalCleanupRuns(now) {
      return inTransaction(pool, async (client) => {
        const staleLease = new Date(now.getTime() - 5 * 60 * 1000);
        const result = await client.query<{ runId: string }>(
          `SELECT id AS "runId"
           FROM analysis_runs
           WHERE status IN ('completed', 'failed', 'cancelled')
             AND (
               media_cleanup_status IN ('pending', 'failed')
               OR (media_cleanup_status = 'cleaning' AND updated_at <= $1)
             )
           ORDER BY updated_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT ${claimLimit}`,
          [staleLease]
        );
        return result.rows.map((row) => row.runId);
      });
    },

    async failStaleRuns(input) {
      return inTransaction(pool, async (client) => {
        const result = await client.query<{ runId: string }>(
          `WITH claimed AS (
             SELECT id
             FROM analysis_runs
             WHERE status IN ('queued', 'running', 'cancelling')
               AND created_at < $2
               AND COALESCE(heartbeat_at, created_at) < $3
             ORDER BY created_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT ${claimLimit}
           )
           UPDATE analysis_runs run
           SET status = 'failed', error = $4, failure_kind = 'stale_timeout', updated_at = $1
           FROM claimed
           WHERE run.id = claimed.id
           RETURNING run.id AS "runId"`,
          [input.now, input.runCreatedBefore, input.heartbeatBefore, input.error]
        );
        return result.rows.map((row) => row.runId);
      });
    },

    async claimStaleFailureReservations() {
      return inTransaction(pool, async (client) => {
        const result = await client.query<{ runId: string }>(
          `SELECT reservation.run_id AS "runId"
           FROM credit_reservations reservation
           JOIN analysis_runs run ON run.id = reservation.run_id
           WHERE reservation.status = 'held'
             AND run.status = 'failed'
             AND run.failure_kind = 'stale_timeout'
           ORDER BY reservation.created_at, reservation.run_id
           FOR UPDATE OF reservation SKIP LOCKED
           LIMIT ${claimLimit}`
        );
        return result.rows.map((row) => row.runId);
      });
    },

    async deleteExpiredPrivacyResults(now) {
      return inTransaction(pool, async (client) => {
        const claimed = await client.query<{ runId: string }>(
          `SELECT id AS "runId"
           FROM analysis_runs
           WHERE retention_mode = 'privacy'
             AND results_deleted_at IS NULL
             AND result_expires_at <= $1
           ORDER BY result_expires_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT ${claimLimit}`,
          [now]
        );
        const runIds = claimed.rows.map((row) => row.runId);
        if (runIds.length === 0) return 0;

        await client.query("DELETE FROM ephemeral_transcript_segments WHERE run_id = ANY($1::text[])", [runIds]);
        await client.query("DELETE FROM ephemeral_run_summaries WHERE run_id = ANY($1::text[])", [runIds]);
        await client.query("DELETE FROM ephemeral_chapters WHERE run_id = ANY($1::text[])", [runIds]);
        await client.query(
          `UPDATE chunks
           SET transcript_json = NULL, transcript_object_key = NULL, error = NULL
           WHERE run_id = ANY($1::text[])`,
          [runIds]
        );
        await client.query(
          `UPDATE analysis_runs
           SET results_deleted_at = $2
           WHERE id = ANY($1::text[]) AND retention_mode = 'privacy' AND results_deleted_at IS NULL`,
          [runIds, now]
        );
        return runIds.length;
      });
    }
  };
}

async function inTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
