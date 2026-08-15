import type { Pool, PoolClient } from "pg";
import type { RetentionMode } from "@videoanalyze/domain";

export type ResultMetadata = {
  id: string; userId: string; videoId: string; stage: string; status: string; progress: number; error: string | null;
  fileName: string; retentionMode: RetentionMode; resultExpiresAt: Date | null; resultsDeletedAt: Date | null;
  duration: number | null; originalDeletedAt: Date | null; billedCredits: number | null; createdAt: Date; updatedAt: Date;
};

const metadataSelect = `SELECT run.id, run.user_id AS "userId", run.video_id AS "videoId",
  run.stage, run.status, run.progress, run.error, run.display_name AS "fileName",
  run.retention_mode AS "retentionMode", run.result_expires_at AS "resultExpiresAt",
  run.results_deleted_at AS "resultsDeletedAt", run.created_at AS "createdAt", run.updated_at AS "updatedAt",
  video.duration, video.original_deleted_at AS "originalDeletedAt",
  CASE WHEN reservation.status = 'consumed' THEN reservation.amount::int ELSE NULL END AS "billedCredits"
 FROM analysis_runs run JOIN videos video ON video.id = run.video_id
 LEFT JOIN credit_reservations reservation ON reservation.run_id = run.id`;

export function createResultRepository(pool: Pool) {
  return {
    async listOwned(userId: string, limit: number): Promise<ResultMetadata[]> {
      const result = await pool.query<ResultMetadata>(`${metadataSelect} WHERE run.user_id = $1 ORDER BY run.created_at DESC, run.id DESC LIMIT $2`, [userId, limit]);
      return result.rows;
    },
    async findOwnedMetadata(userId: string, runId: string): Promise<ResultMetadata | null> {
      const result = await pool.query<ResultMetadata>(`${metadataSelect} WHERE run.id = $1 AND run.user_id = $2`, [runId, userId]);
      return result.rows[0] ?? null;
    },
    async loadOwnedContent(userId: string, runId: string, mode: RetentionMode) {
      const transcriptTable = mode === "privacy" ? "ephemeral_transcript_segments" : "transcript_segments";
      const chapterTable = mode === "privacy" ? "ephemeral_chapters" : "chapters";
      const segments = await pool.query<{ id: string; start: number; end: number; text: string }>(
        `SELECT id, start_seconds AS "start", end_seconds AS "end", text FROM ${transcriptTable} WHERE run_id = $1 AND user_id = $2 ORDER BY start_seconds`, [runId, userId]);
      const chapters = await pool.query<{ id: string; title: string; start: number; end: number; summary: string; bulletsJson: unknown; sourceSegmentIdsJson: unknown; alignmentWarning: boolean }>(
        `SELECT id, title, start_seconds AS "start", end_seconds AS "end", summary, bullets_json AS "bulletsJson",
          source_segment_ids_json AS "sourceSegmentIdsJson", alignment_warning AS "alignmentWarning"
         FROM ${chapterTable} WHERE run_id = $1 AND user_id = $2 ORDER BY start_seconds`, [runId, userId]);
      const summary = mode === "privacy"
        ? await pool.query<{ oneLineSummary: string; overallSummary: string }>(`SELECT one_line_summary AS "oneLineSummary", overall_summary AS "overallSummary" FROM ephemeral_run_summaries WHERE run_id = $1 AND user_id = $2`, [runId, userId])
        : await pool.query<{ summaryJson: { oneLineSummary?: string; overallSummary?: string } | null }>(`SELECT summary_json AS "summaryJson" FROM analysis_runs WHERE id = $1 AND user_id = $2`, [runId, userId]);
      const summaryJson = mode === "privacy" ? summary.rows[0] as { oneLineSummary?: string; overallSummary?: string } | undefined : (summary.rows[0] as { summaryJson?: { oneLineSummary?: string; overallSummary?: string } | null } | undefined)?.summaryJson ?? undefined;
      return {
        ...(segments.rows.length ? { transcript: { segments: segments.rows.map((segment) => ({ ...segment, runId })), mergeWarnings: [] } } : {}),
        ...(summaryJson || chapters.rows.length ? { summary: {
          oneLineSummary: summaryJson?.oneLineSummary ?? "", overallSummary: summaryJson?.overallSummary ?? "",
          chapters: chapters.rows.map((chapter) => ({ id: chapter.id, title: chapter.title, start: chapter.start, end: chapter.end,
            summary: chapter.summary, bullets: (chapter.bulletsJson ?? []) as Array<{ text: string; sourceSegmentIds: string[] }>,
            sourceSegmentIds: (chapter.sourceSegmentIdsJson ?? []) as string[], alignmentWarning: chapter.alignmentWarning }))
        } } : {})
      };
    },
    async deleteOwnedResults(userId: string, runId: string, now: Date): Promise<boolean> {
      return inTransaction(pool, async (client) => {
        const owned = await client.query<{ videoId: string }>(`SELECT video_id AS "videoId" FROM analysis_runs WHERE id = $1 AND user_id = $2 FOR UPDATE`, [runId, userId]);
        const run = owned.rows[0];
        if (!run) return false;
        for (const table of ["transcript_segments", "chapters", "ephemeral_transcript_segments", "ephemeral_run_summaries", "ephemeral_chapters"]) await client.query(`DELETE FROM ${table} WHERE run_id = $1`, [runId]);
        await client.query("UPDATE chunks SET transcript_json = NULL, transcript_object_key = NULL, error = NULL WHERE run_id = $1", [runId]);
        await client.query(`UPDATE analysis_runs SET summary_json = NULL, results_deleted_at = COALESCE(results_deleted_at, $3), display_name = '已删除的视频', updated_at = $3 WHERE id = $1 AND user_id = $2`, [runId, userId, now]);
        const labels = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM analysis_runs WHERE video_id = $1 AND id <> $2 AND results_deleted_at IS NULL AND status = 'completed' AND (retention_mode = 'standard' OR result_expires_at > $3)`, [run.videoId, runId, now]);
        if ((labels.rows[0]?.count ?? 0) === 0) await client.query(`UPDATE videos SET file_name = '已删除的视频', updated_at = $3 WHERE id = $1 AND user_id = $2 AND original_deleted_at IS NOT NULL`, [run.videoId, userId, now]);
        return true;
      });
    }
  };
}

async function inTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
