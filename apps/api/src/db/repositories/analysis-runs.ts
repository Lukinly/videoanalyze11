import type { Pool } from "pg";

export type AnalysisRunRecord = {
  id: string;
  userId: string;
  videoId: string;
  stage: string;
  status: string;
  progress: number;
  error: string | null;
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
      return result.rows[0];
    },
    async findOwnedById(userId: string, runId: string): Promise<AnalysisRunRecord | null> {
      const result = await pool.query<AnalysisRunRecord>(
        `SELECT id, user_id AS "userId", video_id AS "videoId", stage, status, progress, error
         FROM analysis_runs WHERE id = $1 AND user_id = $2`,
        [runId, userId]
      );
      return result.rows[0] ?? null;
    },
    async requestCancellation(userId: string, runId: string): Promise<AnalysisRunRecord | null> {
      const result = await pool.query<AnalysisRunRecord>(
        `UPDATE analysis_runs SET status = 'cancelling', updated_at = $3
         WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')
         RETURNING id, user_id AS "userId", video_id AS "videoId", stage, status, progress, error`,
        [runId, userId, new Date()]
      );
      return result.rows[0] ?? this.findOwnedById(userId, runId);
    }
  };
}
