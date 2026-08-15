import type { Pool, PoolClient } from "pg";
import { transcriptSegmentSchema, type RetentionMode, type TranscriptSegment } from "@videoanalyze/domain";
import type { AlignedSummaryResult } from "../summary/v1-runner.js";

export type ResultStore = {
  saveTranscript(input: { runId: string; userId: string; mode: RetentionMode; expiresAt: Date | null; segments: TranscriptSegment[] }): Promise<void>;
  getTranscript(runId: string): Promise<{ duration: number; segments: TranscriptSegment[] }>;
  saveSummary(input: { runId: string; userId: string; mode: RetentionMode; expiresAt: Date | null; result: AlignedSummaryResult }): Promise<void>;
  finalizePrivacyExpiry(runId: string, expiresAt: Date): Promise<void>;
  clearChunkPayloads(runId: string): Promise<void>;
};

export function privacyResultExpiry(completedAt: Date): Date {
  return new Date(completedAt.getTime() + 24 * 60 * 60 * 1000);
}

export function createResultStore(pool: Pool): ResultStore {
  const clearChunkPayloads = async (runId: string) => {
    await pool.query(
      `UPDATE chunks
       SET transcript_json = NULL, transcript_object_key = NULL, error = NULL
       WHERE run_id = $1`,
      [runId]
    );
  };

  return {
    async saveTranscript(input) {
      const segments = transcriptSegmentSchema.array().parse(input.segments);
      await inTransaction(pool, async (client) => {
        await client.query("DELETE FROM transcript_segments WHERE run_id = $1", [input.runId]);
        await client.query("DELETE FROM ephemeral_transcript_segments WHERE run_id = $1", [input.runId]);
        const table = input.mode === "privacy" ? "ephemeral_transcript_segments" : "transcript_segments";
        const expiryColumn = input.mode === "privacy" ? ", expires_at" : "";
        const expiryValue = input.mode === "privacy" ? ", $7" : "";
        for (const [index, segment] of segments.entries()) {
          await client.query(
            `INSERT INTO ${table} (id, user_id, run_id, start_seconds, end_seconds, text${expiryColumn})
             VALUES ($1, $2, $3, $4, $5, $6${expiryValue})`,
            input.mode === "privacy"
              ? [`${input.runId}_seg_${index + 1}`, input.userId, input.runId, segment.start, segment.end, segment.text, input.expiresAt]
              : [`${input.runId}_seg_${index + 1}`, input.userId, input.runId, segment.start, segment.end, segment.text]
          );
        }
      });
      await clearChunkPayloads(input.runId);
    },

    async getTranscript(runId) {
      const run = await pool.query<{ duration: number | null; mode: RetentionMode }>(
        `SELECT v.duration, ar.retention_mode AS mode
         FROM analysis_runs ar JOIN videos v ON v.id = ar.video_id
         WHERE ar.id = $1`,
        [runId]
      );
      const mode = run.rows[0]?.mode;
      if (!mode) throw new Error("analysis run does not exist");
      const table = mode === "privacy" ? "ephemeral_transcript_segments" : "transcript_segments";
      const segments = await pool.query<{ id: string; start: number; end: number; text: string }>(
        `SELECT id, start_seconds AS "start", end_seconds AS "end", text
         FROM ${table} WHERE run_id = $1 ORDER BY start_seconds`,
        [runId]
      );
      return {
        duration: run.rows[0]?.duration ?? 0,
        segments: segments.rows.map((segment) => ({ ...segment, runId }))
      };
    },

    async saveSummary(input) {
      await inTransaction(pool, async (client) => {
        await client.query("DELETE FROM chapters WHERE run_id = $1", [input.runId]);
        await client.query("DELETE FROM ephemeral_chapters WHERE run_id = $1", [input.runId]);
        await client.query("DELETE FROM ephemeral_run_summaries WHERE run_id = $1", [input.runId]);

        if (input.mode === "privacy") {
          await client.query("UPDATE analysis_runs SET summary_json = NULL WHERE id = $1", [input.runId]);
          await client.query(
            `INSERT INTO ephemeral_run_summaries (run_id, user_id, one_line_summary, overall_summary, expires_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [input.runId, input.userId, input.result.oneLineSummary, input.result.overallSummary, input.expiresAt]
          );
        } else {
          await client.query(
            "UPDATE analysis_runs SET summary_json = $2 WHERE id = $1",
            [input.runId, JSON.stringify({ oneLineSummary: input.result.oneLineSummary, overallSummary: input.result.overallSummary })]
          );
        }

        const table = input.mode === "privacy" ? "ephemeral_chapters" : "chapters";
        const expiryColumn = input.mode === "privacy" ? ", expires_at" : "";
        const expiryValue = input.mode === "privacy" ? ", $11" : "";
        for (const chapter of input.result.chapters) {
          await client.query(
            `INSERT INTO ${table} (id, user_id, run_id, title, start_seconds, end_seconds, summary, bullets_json, source_segment_ids_json, alignment_warning${expiryColumn})
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10${expiryValue})`,
            input.mode === "privacy"
              ? [`${input.runId}_${chapter.id}`, input.userId, input.runId, chapter.title, chapter.start, chapter.end, chapter.summary, JSON.stringify(chapter.bullets), JSON.stringify(chapter.sourceSegmentIds), chapter.alignmentWarning, input.expiresAt]
              : [`${input.runId}_${chapter.id}`, input.userId, input.runId, chapter.title, chapter.start, chapter.end, chapter.summary, JSON.stringify(chapter.bullets), JSON.stringify(chapter.sourceSegmentIds), chapter.alignmentWarning]
          );
        }
      });
    },

    async finalizePrivacyExpiry(runId, expiresAt) {
      await inTransaction(pool, async (client) => {
        await client.query("UPDATE analysis_runs SET result_expires_at = $2 WHERE id = $1 AND retention_mode = 'privacy'", [runId, expiresAt]);
        await client.query("UPDATE ephemeral_transcript_segments SET expires_at = $2 WHERE run_id = $1", [runId, expiresAt]);
        await client.query("UPDATE ephemeral_run_summaries SET expires_at = $2 WHERE run_id = $1", [runId, expiresAt]);
        await client.query("UPDATE ephemeral_chapters SET expires_at = $2 WHERE run_id = $1", [runId, expiresAt]);
      });
    },

    clearChunkPayloads
  };
}

async function inTransaction(pool: Pool, operation: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await operation(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
