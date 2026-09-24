import type { Pool } from "pg";

export type AnalysisRunRecord = {
  id: string;
  userId: string;
  videoId: string;
  stage: string;
  status: string;
  progress: number;
  error: string | null;
  completedChunks: number;
  totalChunks: number;
  summaryJson?: unknown;
  transcript?: { segments: Array<{ id: string; runId: string; start: number; end: number; text: string }>; mergeWarnings: string[] };
  summary?: {
    oneLineSummary: string;
    overallSummary: string;
    chapters: Array<{
      id: string;
      title: string;
      sourceSegmentIds: string[];
      summary: string;
      bullets: Array<{ text: string; sourceSegmentIds: string[] }>;
      start: number;
      end: number;
      alignmentWarning: boolean;
    }>;
  };
};

export function createAnalysisRunRepository(pool: Pool) {
  return {
    async create(input: { id: string; userId: string; videoId: string }): Promise<AnalysisRunRecord> {
      const now = new Date();
      const result = await pool.query<AnalysisRunRecord>(
        `INSERT INTO analysis_runs (id, user_id, video_id, stage, status, progress, created_at, updated_at)
         VALUES ($1, $2, $3, 'queued', 'queued', 0, $4, $4)
         RETURNING id, user_id AS "userId", video_id AS "videoId", stage, status, progress, error`,
        [input.id, input.userId, input.videoId, now]
      );
      return { ...result.rows[0], completedChunks: 0, totalChunks: 0 };
    },
    async findOwnedById(userId: string, runId: string): Promise<AnalysisRunRecord | null> {
      const result = await pool.query<AnalysisRunRecord & { summaryJson: unknown }>(
        `SELECT id, user_id AS "userId", video_id AS "videoId", stage, status, progress, error, summary_json AS "summaryJson"
         FROM analysis_runs WHERE id = $1 AND user_id = $2`,
        [runId, userId]
      );
      const run = result.rows[0];
      if (!run) return null;
      const chunks = await pool.query<{ totalChunks: number; completedChunks: number }>(
        `SELECT COUNT(*)::int AS "totalChunks",
           COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)::int AS "completedChunks"
         FROM chunks WHERE run_id = $1`,
        [runId]
      );
      const segments = await pool.query<{ id: string; start: number; end: number; text: string }>(
        `SELECT id, start_seconds AS "start", end_seconds AS "end", text
         FROM transcript_segments WHERE run_id = $1 AND user_id = $2 ORDER BY start_seconds`,
        [runId, userId]
      );
      const chapters = await pool.query<{
        id: string; title: string; start: number; end: number; summary: string;
        bulletsJson: unknown; sourceSegmentIdsJson: unknown; alignmentWarning: boolean;
      }>(
        `SELECT id, title, start_seconds AS "start", end_seconds AS "end", summary,
                bullets_json AS "bulletsJson", source_segment_ids_json AS "sourceSegmentIdsJson",
                alignment_warning AS "alignmentWarning"
         FROM chapters WHERE run_id = $1 AND user_id = $2 ORDER BY start_seconds`,
        [runId, userId]
      );
      const record: AnalysisRunRecord = { ...run, ...chunks.rows[0] };
      if (segments.rows.length > 0) {
        record.transcript = {
          segments: segments.rows.map((segment) => ({ ...segment, runId })),
          mergeWarnings: []
        };
      }
      const summaryJson = run.summaryJson as { oneLineSummary?: string; overallSummary?: string } | null;
      if (summaryJson || chapters.rows.length > 0) {
        record.summary = {
          oneLineSummary: summaryJson?.oneLineSummary ?? "",
          overallSummary: summaryJson?.overallSummary ?? "",
          chapters: chapters.rows.map((chapter) => ({
            id: chapter.id,
            title: chapter.title,
            sourceSegmentIds: chapter.sourceSegmentIdsJson as string[],
            summary: chapter.summary,
            bullets: (chapter.bulletsJson ?? []) as Array<{ text: string; sourceSegmentIds: string[] }>,
            start: chapter.start,
            end: chapter.end,
            alignmentWarning: chapter.alignmentWarning
          }))
        };
      }
      return record;
    },
    async requestCancellation(userId: string, runId: string): Promise<AnalysisRunRecord | null> {
      await pool.query(
        `UPDATE analysis_runs SET status = 'cancelling', updated_at = $3
         WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')
         RETURNING id, user_id AS "userId", video_id AS "videoId", stage, status, progress, error`,
        [runId, userId, new Date()]
      );
      return this.findOwnedById(userId, runId);
    }
  };
}
