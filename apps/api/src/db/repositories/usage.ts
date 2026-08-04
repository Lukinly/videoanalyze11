import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export function createUsageRepository(pool: Pool) {
  return {
    async grantCredits(userId: string, count: number, reason: string): Promise<void> {
      const now = new Date();
      for (let index = 0; index < count; index += 1) {
        await pool.query(
          `INSERT INTO usage_ledger (id, user_id, amount, kind, status, idempotency_key, reason, created_at)
           VALUES ($1, $2, 1, 'trial_grant', 'confirmed', $3, $4, $5)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [randomUUID(), userId, `trial:${userId}:${index}`, reason, now]
        );
      }
    },
    async getAvailableCredits(userId: string): Promise<number> {
      const result = await pool.query<{ available: number }>(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE status IN ('confirmed', 'reserved')), 0)::int AS available
         FROM usage_ledger WHERE user_id = $1`,
        [userId]
      );
      return Number(result.rows[0]?.available ?? 0);
    },
    async reserveAnalysis(input: { userId: string; runId: string; idempotencyKey: string }): Promise<"reserved" | "already_reserved" | "exhausted"> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query<{ status: string }>(
          `SELECT status FROM usage_ledger WHERE idempotency_key = $1`,
          [input.idempotencyKey]
        );
        if (existing.rows[0]) {
          await client.query("COMMIT");
          return existing.rows[0].status === "released" ? "reserved" : "already_reserved";
        }

        await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [input.userId]);
        const available = await client.query<{ count: number }>(
          `SELECT COALESCE(SUM(amount) FILTER (WHERE status IN ('confirmed', 'reserved')), 0)::int AS count
           FROM usage_ledger WHERE user_id = $1`,
          [input.userId]
        );
        if (Number(available.rows[0]?.count ?? 0) < 1) {
          await client.query("COMMIT");
          return "exhausted";
        }

        await client.query(
          `INSERT INTO usage_ledger (id, user_id, run_id, amount, kind, status, idempotency_key, created_at)
           VALUES ($1, $2, $3, -1, 'analysis_reservation', 'reserved', $4, $5)`,
          [randomUUID(), input.userId, input.runId, input.idempotencyKey, new Date()]
        );
        await client.query("COMMIT");
        return "reserved";
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async confirmAnalysis(runId: string): Promise<void> {
      await pool.query(`UPDATE usage_ledger SET status = 'confirmed' WHERE run_id = $1 AND status = 'reserved'`, [runId]);
    },
    async releaseAnalysis(runId: string, reason: string): Promise<void> {
      await pool.query(`UPDATE usage_ledger SET status = 'released', reason = $2 WHERE run_id = $1 AND status = 'reserved'`, [runId, reason]);
    }
  };
}
