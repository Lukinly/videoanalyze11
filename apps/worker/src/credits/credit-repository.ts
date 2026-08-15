import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export function createWorkerCreditRepository(pool: Pool) {
  return {
    async consumeReservation(runId: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<{ userId: string; amount: number; status: string }>(
          `SELECT user_id AS "userId", amount, status
           FROM credit_reservations WHERE run_id = $1 FOR UPDATE`,
          [runId]
        );
        const reservation = result.rows[0];
        if (!reservation || reservation.status !== "held") {
          await client.query("COMMIT");
          return;
        }
        await client.query(
          `INSERT INTO credit_ledger
             (id, user_id, amount, type, reference_id, idempotency_key, reason, created_at)
           VALUES ($1, $2, $3, 'analysis_charge', $4, $5, 'analysis completed', $6)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [randomUUID(), reservation.userId, -Math.abs(Number(reservation.amount)), runId, `analysis-charge:${runId}`, new Date()]
        );
        await client.query("UPDATE credit_reservations SET status = 'consumed', consumed_at = $2 WHERE run_id = $1 AND status = 'held'", [runId, new Date()]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async releaseReservation(runId: string, reason: string): Promise<void> {
      await pool.query(
        `UPDATE credit_reservations
         SET status = 'released', released_at = $2, release_reason = $3
         WHERE run_id = $1 AND status = 'held'`,
        [runId, new Date(), reason]
      );
    }
  };
}
