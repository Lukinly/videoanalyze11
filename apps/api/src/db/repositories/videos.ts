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
    }
  };
}
