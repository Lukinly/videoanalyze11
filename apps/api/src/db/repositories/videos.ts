import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type VideoRecord = {
  id: string;
  userId: string;
  objectKey: string;
  fileName: string;
  fileSize: number;
  duration: number | null;
  status: string;
};

export function createVideoRepository(pool: Pool) {
  return {
    async create(input: { id?: string; userId: string; objectKey: string; fileName: string; fileSize?: number }): Promise<VideoRecord> {
      const now = new Date();
      const result = await pool.query<VideoRecord>(
        `INSERT INTO videos (id, user_id, object_key, file_name, file_size, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id, user_id AS "userId", object_key AS "objectKey", file_name AS "fileName",
           file_size::bigint AS "fileSize", duration, status`,
        [input.id ?? randomUUID(), input.userId, input.objectKey, input.fileName, input.fileSize ?? 0, now]
      );
      return result.rows[0];
    },
    async findOwnedById(userId: string, videoId: string): Promise<VideoRecord | null> {
      const result = await pool.query<VideoRecord>(
        `SELECT id, user_id AS "userId", object_key AS "objectKey", file_name AS "fileName",
           file_size::bigint AS "fileSize", duration, status
         FROM videos WHERE id = $1 AND user_id = $2 AND status <> 'deleted'`,
        [videoId, userId]
      );
      return result.rows[0] ?? null;
    },
    async listOwnedObjectKeys(userId: string, videoId: string): Promise<string[] | null> {
      const video = await this.findOwnedById(userId, videoId);
      if (!video) return null;
      const runs = await pool.query<{ id: string }>("SELECT id FROM analysis_runs WHERE video_id = $1 AND user_id = $2", [videoId, userId]);
      const keys = [video.objectKey];
      for (const run of runs.rows) {
        keys.push(`users/${encodeURIComponent(userId)}/runs/${encodeURIComponent(run.id)}/audio.flac`);
        keys.push(`users/${encodeURIComponent(userId)}/runs/${encodeURIComponent(run.id)}/summary.json`);
        const chunks = await pool.query<{ objectKey: string; transcriptObjectKey: string | null }>("SELECT object_key AS \"objectKey\", transcript_object_key AS \"transcriptObjectKey\" FROM chunks WHERE run_id = $1 AND user_id = $2", [run.id, userId]);
        for (const chunk of chunks.rows) {
          keys.push(chunk.objectKey);
          if (chunk.transcriptObjectKey) keys.push(chunk.transcriptObjectKey);
        }
      }
      return [...new Set(keys)];
    },
    async markDeleted(userId: string, videoId: string): Promise<void> {
      await pool.query("UPDATE videos SET status = 'deleted', updated_at = $3 WHERE id = $1 AND user_id = $2", [videoId, userId, new Date()]);
    }
  };
}
