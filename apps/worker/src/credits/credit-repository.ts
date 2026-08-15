import { randomUUID } from "node:crypto";
import { calculateDurationTieredCredits, type BillingSnapshot } from "@videoanalyze/domain";
import type { Pool } from "pg";

export function createWorkerCreditRepository(pool: Pool) {
  return {
    async reserveForDuration(input: { runId: string; userId: string; durationSeconds: number }): Promise<BillingSnapshot | "exhausted"> {
      const snapshot = calculateDurationTieredCredits(input.durationSeconds);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const runResult = await client.query<{
          billingRuleVersion: string | null; billedDurationSeconds: number | null; billedMinutes: number | null; reservedCredits: number | null;
        }>(`SELECT billing_rule_version AS "billingRuleVersion", billed_duration_seconds AS "billedDurationSeconds",
                   billed_minutes AS "billedMinutes", reserved_credits AS "reservedCredits"
            FROM analysis_runs WHERE id = $1 AND user_id = $2 FOR UPDATE`, [input.runId, input.userId]);
        const run = runResult.rows[0];
        if (!run) throw new Error("analysis run does not exist");
        if (run.billingRuleVersion) {
          await client.query("COMMIT");
          return {
            billingRuleVersion: "duration-tiered-v2",
            billedDurationSeconds: Number(run.billedDurationSeconds),
            billedMinutes: Number(run.billedMinutes),
            reservedCredits: Number(run.reservedCredits)
          };
        }

        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [input.userId]);
        const balanceResult = await client.query<{ balance: number; held: number }>(
          `SELECT COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE user_id = $1), 0)::int AS balance,
                  COALESCE((SELECT SUM(amount) FROM credit_reservations WHERE user_id = $1 AND status = 'held'), 0)::int AS held`,
          [input.userId]
        );
        const available = Number(balanceResult.rows[0]?.balance ?? 0) - Number(balanceResult.rows[0]?.held ?? 0);
        if (available < snapshot.reservedCredits) {
          await client.query("COMMIT");
          return "exhausted";
        }
        await client.query(
          `UPDATE analysis_runs SET billing_rule_version = $3, billed_duration_seconds = $4, billed_minutes = $5, reserved_credits = $6
           WHERE id = $1 AND user_id = $2 AND billing_rule_version IS NULL`,
          [input.runId, input.userId, snapshot.billingRuleVersion, snapshot.billedDurationSeconds, snapshot.billedMinutes, snapshot.reservedCredits]
        );
        await client.query(
          `INSERT INTO credit_reservations (id, user_id, run_id, amount, status, idempotency_key, created_at)
           VALUES ($1, $2, $3, $4, 'held', $5, $6)`,
          [randomUUID(), input.userId, input.runId, snapshot.reservedCredits, `analysis:${input.runId}`, new Date()]
        );
        await client.query("COMMIT");
        return snapshot;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
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
