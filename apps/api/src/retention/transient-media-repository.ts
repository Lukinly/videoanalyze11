import { randomUUID } from "node:crypto";
import { DomainError } from "@videoanalyze/domain";
import type { Pool, PoolClient } from "pg";

export type TransientMediaRepository = ReturnType<typeof createTransientMediaRepository>;
export type TransientMediaCapacityGate = {
  acquire(client: PoolClient): Promise<() => void>;
};

const postgresCapacityGate: TransientMediaCapacityGate = {
  async acquire(client) {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [734_682]);
    return () => {};
  }
};

export function createTransientMediaRepository(pool: Pool, options: {
  capacityBytes?: number;
  capacityGate?: TransientMediaCapacityGate;
} = {}) {
  const capacityBytes = options.capacityBytes ?? Number.POSITIVE_INFINITY;
  const capacityGate = options.capacityGate ?? postgresCapacityGate;
  return {
    async getLiveBytes(): Promise<number> {
      const result = await pool.query<{ liveBytes: string | number }>(liveBytesQuery);
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
        const releaseCapacityGate = await capacityGate.acquire(client);
        try {
          const liveBytes = await getLiveBytes(client);
          const rejectionBytes = Math.floor(capacityBytes * 0.80);
          if (liveBytes + input.sizeBytes > rejectionBytes) {
            throw new DomainError("TEMP_STORAGE_FULL", "临时存储空间繁忙，请稍后重试", 503);
          }
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
        } finally {
          releaseCapacityGate();
        }
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

const liveBytesQuery = `SELECT COALESCE(SUM(size_bytes), 0) AS "liveBytes"
  FROM transient_objects
  WHERE deleted_at IS NULL`;

async function getLiveBytes(client: PoolClient): Promise<number> {
  const result = await client.query<{ liveBytes: string | number }>(liveBytesQuery);
  return Number(result.rows[0]?.liveBytes ?? 0);
}
