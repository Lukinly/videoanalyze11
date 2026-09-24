import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type CreditType = "welcome_grant" | "admin_grant" | "admin_debit" | "analysis_charge" | "refund";

export type CreditLedgerRecord = {
  id: string;
  userId: string;
  amount: number;
  type: CreditType;
  referenceId: string | null;
  idempotencyKey: string;
  reason: string;
  createdBy: string | null;
  createdAt: Date;
};

export type CreditRepository = ReturnType<typeof createCreditRepository>;

export function createCreditRepository(pool: Pool) {
  return {
    async getBalance(userId: string) {
      const result = await pool.query<{ ledgerBalance: number; held: number }>(
        `SELECT
           COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE user_id = $1), 0)::int AS "ledgerBalance",
           COALESCE((SELECT SUM(amount) FROM credit_reservations WHERE user_id = $1 AND status = 'held'), 0)::int AS held`,
        [userId]
      );
      const ledgerBalance = Number(result.rows[0]?.ledgerBalance ?? 0);
      const held = Number(result.rows[0]?.held ?? 0);
      return { ledgerBalance, held, available: ledgerBalance - held };
    },

    async listLedger(userId: string, limit = 50): Promise<CreditLedgerRecord[]> {
      const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
      const result = await pool.query<CreditLedgerRecord>(
        `SELECT id, user_id AS "userId", amount, type, reference_id AS "referenceId",
                idempotency_key AS "idempotencyKey", reason, created_by AS "createdBy", created_at AS "createdAt"
         FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [userId, boundedLimit]
      );
      return result.rows;
    },

    async grant(input: {
      userId: string;
      amount: number;
      type: CreditType;
      referenceId?: string;
      idempotencyKey: string;
      reason: string;
      createdBy?: string;
      client?: PoolClient;
    }): Promise<boolean> {
      if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new Error("credit amount must be a non-zero integer");
      const positive = input.amount > 0;
      if ((input.type === "admin_debit" || input.type === "analysis_charge") === positive) {
        throw new Error("credit amount sign does not match type");
      }
      const executor = input.client ?? pool;
      const result = await executor.query(
        `INSERT INTO credit_ledger
           (id, user_id, amount, type, reference_id, idempotency_key, reason, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [randomUUID(), input.userId, input.amount, input.type, input.referenceId ?? null, input.idempotencyKey, input.reason, input.createdBy ?? null, new Date()]
      );
      return (result.rowCount ?? 0) > 0;
    },

    async reserveAnalysis(input: { userId: string; runId: string; amount: number }): Promise<"held" | "already_held" | "exhausted"> {
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("reservation amount must be positive");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [input.userId]);
        const existing = await client.query<{ status: string }>("SELECT status FROM credit_reservations WHERE run_id = $1 FOR UPDATE", [input.runId]);
        if (existing.rows[0]) {
          await client.query("COMMIT");
          return "already_held";
        }

        const available = await client.query<{ balance: number; held: number }>(
          `SELECT
             COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE user_id = $1), 0)::int AS balance,
             COALESCE((SELECT SUM(amount) FROM credit_reservations WHERE user_id = $1 AND status = 'held'), 0)::int AS held`,
          [input.userId]
        );
        const balance = Number(available.rows[0]?.balance ?? 0);
        const held = Number(available.rows[0]?.held ?? 0);
        if (balance - held < input.amount) {
          await client.query("COMMIT");
          return "exhausted";
        }

        await client.query(
          `INSERT INTO credit_reservations
             (id, user_id, run_id, amount, status, idempotency_key, created_at)
           VALUES ($1, $2, $3, $4, 'held', $5, $6)`,
          [randomUUID(), input.userId, input.runId, input.amount, `analysis:${input.runId}`, new Date()]
        );
        await client.query("COMMIT");
        return "held";
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
          `SELECT user_id AS "userId", amount, status FROM credit_reservations WHERE run_id = $1 FOR UPDATE`,
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
