import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type TransientMediaRepository = ReturnType<typeof createTransientMediaRepository>;

export function createTransientMediaRepository(pool: Pool) {
  return {
    async getLiveBytes(): Promise<number> {
      const result = await pool.query<{ liveBytes: string | number }>(
        `SELECT COALESCE(SUM(size_bytes), 0) AS "liveBytes"
         FROM transient_objects
         WHERE deleted_at IS NULL AND expires_at > NOW()`
      );
      return Number(result.rows[0]?.liveBytes ?? 0);
    },

    async createTrackedOriginal(input: {
      userId: string;
      videoId: string;
      objectKey: string;
      fileName: string;
      sizeBytes: number;
      expiresAt: Date;
    }): Promise<void> {
      const client = await pool.connect();
      const createdAt = new Date();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO videos (id, user_id, object_key, file_name, file_size, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [input.videoId, input.userId, input.objectKey, input.fileName, input.sizeBytes, createdAt]
        );
        await client.query(
          `INSERT INTO transient_objects (id, user_id, video_id, object_key, kind, size_bytes, expires_at, created_at)
           VALUES ($1, $2, $3, $4, 'original', $5, $6, $7)`,
          [randomUUID(), input.userId, input.videoId, input.objectKey, input.sizeBytes, input.expiresAt, createdAt]
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
