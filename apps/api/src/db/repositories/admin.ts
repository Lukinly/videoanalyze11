import { randomUUID } from "node:crypto";
import { DomainError, WELCOME_CREDITS } from "@videoanalyze/domain";
import type { Pool } from "pg";
import { createCreditRepository } from "./credits.js";
import { createUserRepository } from "./users.js";

export type TopupRecord = {
  id: string;
  userId: string;
  requestedAmount: number;
  note: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
};

export type AdminTopupRecord = TopupRecord & {
  userEmail: string | null;
};

export type AuditRecord = {
  id: string;
  adminUserId: string;
  action: string;
  targetUserId: string | null;
  targetRecordId: string | null;
  metadata: Record<string, unknown>;
  reason: string;
  createdAt: Date;
};

const topupColumns = `id, user_id AS "userId", requested_amount AS "requestedAmount", note, status,
  reviewed_by AS "reviewedBy", review_note AS "reviewNote", created_at AS "createdAt", reviewed_at AS "reviewedAt"`;

export function createAdminRepository(pool: Pool) {
  const credits = createCreditRepository(pool);
  const users = createUserRepository(pool);
  return {
    async createUser(input: { email: string; passwordHash: string; adminUserId: string; reason: string }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const user = await users.create({
          email: input.email,
          passwordHash: input.passwordHash,
          role: "user",
          status: "active",
          emailVerifiedAt: new Date(),
          mustChangePassword: true,
          client
        });
        await credits.grant({ client, userId: user.id, amount: WELCOME_CREDITS, type: "welcome_grant", idempotencyKey: `welcome:${user.id}`, reason: "admin_created", createdBy: input.adminUserId });
        await insertAudit(client, { adminUserId: input.adminUserId, action: "create_user", targetUserId: user.id, metadata: { email: user.email }, reason: input.reason });
        await client.query("COMMIT");
        return user;
      } catch (error) {
        await client.query("ROLLBACK");
        if (error && typeof error === "object" && "code" in error && error.code === "23505") {
          throw new DomainError("EMAIL_ALREADY_REGISTERED", "该邮箱已存在，请使用其他邮箱", 409);
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async createTopup(input: { userId: string; requestedAmount: number; note: string }): Promise<TopupRecord> {
      if (!Number.isSafeInteger(input.requestedAmount) || input.requestedAmount <= 0) throw new DomainError("INVALID_CREDIT_REQUEST", "requested amount must be a positive integer", 400);
      const result = await pool.query<TopupRecord>(
        `INSERT INTO credit_topup_requests (id, user_id, requested_amount, note, status, created_at)
         VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING ${topupColumns}`,
        [randomUUID(), input.userId, input.requestedAmount, input.note.trim().slice(0, 500), new Date()]
      );
      return result.rows[0];
    },

    async listTopups(input: { userId?: string; status?: "pending" | "approved" | "rejected"; limit?: number; offset?: number } = {}): Promise<AdminTopupRecord[]> {
      const values: unknown[] = [];
      const predicates: string[] = [];
      if (input.userId) { values.push(input.userId); predicates.push(`r.user_id = $${values.length}`); }
      if (input.status) { values.push(input.status); predicates.push(`r.status = $${values.length}`); }
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100);
      const offset = Math.max(Math.trunc(input.offset ?? 0), 0);
      values.push(limit, offset);
      const result = await pool.query<AdminTopupRecord>(
        `SELECT r.id, r.user_id AS "userId", u.email AS "userEmail",
           r.requested_amount AS "requestedAmount", r.note, r.status,
           r.reviewed_by AS "reviewedBy", r.review_note AS "reviewNote",
           r.created_at AS "createdAt", r.reviewed_at AS "reviewedAt"
         FROM credit_topup_requests r
         LEFT JOIN users u ON u.id = r.user_id
         ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""}
         ORDER BY r.created_at DESC, r.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      );
      return result.rows;
    },

    async approveTopup(input: { requestId: string; adminUserId: string; reviewNote: string }): Promise<TopupRecord> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<TopupRecord>(`SELECT ${topupColumns} FROM credit_topup_requests WHERE id = $1 FOR UPDATE`, [input.requestId]);
        const request = result.rows[0];
        if (!request) throw new DomainError("NOT_FOUND", "top-up request not found", 404);
        if (request.status !== "pending") {
          await client.query("COMMIT");
          return request;
        }
        const reviewedAt = new Date();
        await credits.grant({
          client,
          userId: request.userId,
          amount: request.requestedAmount,
          type: "admin_grant",
          referenceId: request.id,
          idempotencyKey: `topup:${request.id}`,
          reason: input.reviewNote.trim() || "top-up approved",
          createdBy: input.adminUserId
        });
        await client.query("UPDATE credit_topup_requests SET status = 'approved', reviewed_by = $2, review_note = $3, reviewed_at = $4 WHERE id = $1", [request.id, input.adminUserId, input.reviewNote.trim(), reviewedAt]);
        await insertAudit(client, { adminUserId: input.adminUserId, action: "approve_topup", targetUserId: request.userId, targetRecordId: request.id, metadata: { amount: request.requestedAmount }, reason: input.reviewNote.trim() || "top-up approved" });
        const approved = await client.query<TopupRecord>(`SELECT ${topupColumns} FROM credit_topup_requests WHERE id = $1`, [request.id]);
        await client.query("COMMIT");
        return approved.rows[0];
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async rejectTopup(input: { requestId: string; adminUserId: string; reviewNote: string }): Promise<TopupRecord> {
      if (!input.reviewNote.trim()) throw new DomainError("INVALID_REASON", "rejection reason is required", 400);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<TopupRecord>(`SELECT ${topupColumns} FROM credit_topup_requests WHERE id = $1 FOR UPDATE`, [input.requestId]);
        const request = result.rows[0];
        if (!request) throw new DomainError("NOT_FOUND", "top-up request not found", 404);
        if (request.status !== "pending") {
          await client.query("COMMIT");
          return request;
        }
        const reviewedAt = new Date();
        await client.query("UPDATE credit_topup_requests SET status = 'rejected', reviewed_by = $2, review_note = $3, reviewed_at = $4 WHERE id = $1", [request.id, input.adminUserId, input.reviewNote.trim(), reviewedAt]);
        await insertAudit(client, { adminUserId: input.adminUserId, action: "reject_topup", targetUserId: request.userId, targetRecordId: request.id, metadata: {}, reason: input.reviewNote.trim() });
        const rejected = await client.query<TopupRecord>(`SELECT ${topupColumns} FROM credit_topup_requests WHERE id = $1`, [request.id]);
        await client.query("COMMIT");
        return rejected.rows[0];
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async adjustCredits(input: { targetUserId: string; adminUserId: string; amount: number; type: "admin_grant" | "admin_debit"; reason: string; idempotencyKey: string }): Promise<void> {
      if (!input.reason.trim()) throw new DomainError("INVALID_REASON", "reason is required", 400);
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new DomainError("INVALID_CREDIT_REQUEST", "amount must be a positive integer", 400);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const target = await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [input.targetUserId]);
        if (!target.rowCount) throw new DomainError("NOT_FOUND", "user not found", 404);
        const existing = await client.query("SELECT id FROM credit_ledger WHERE idempotency_key = $1", [input.idempotencyKey]);
        if (existing.rowCount) {
          await client.query("COMMIT");
          return;
        }
        if (input.type === "admin_debit") {
          const balance = await client.query<{ ledger: number; held: number }>(
            `SELECT
               COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE user_id = $1), 0)::int AS ledger,
               COALESCE((SELECT SUM(amount) FROM credit_reservations WHERE user_id = $1 AND status = 'held'), 0)::int AS held`,
            [input.targetUserId]
          );
          const available = Number(balance.rows[0]?.ledger ?? 0) - Number(balance.rows[0]?.held ?? 0);
          if (available < Math.abs(input.amount)) throw new DomainError("CREDITS_EXHAUSTED", "cannot debit more credits than are available", 400);
        }
        const inserted = await credits.grant({ client, userId: input.targetUserId, amount: input.type === "admin_grant" ? Math.abs(input.amount) : -Math.abs(input.amount), type: input.type, idempotencyKey: input.idempotencyKey, reason: input.reason.trim(), createdBy: input.adminUserId });
        if (inserted) {
          await insertAudit(client, { adminUserId: input.adminUserId, action: input.type === "admin_grant" ? "grant_credits" : "debit_credits", targetUserId: input.targetUserId, targetRecordId: input.idempotencyKey, metadata: { amount: Math.abs(input.amount) }, reason: input.reason.trim() });
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async createAudit(input: { adminUserId: string; action: string; targetUserId?: string; targetRecordId?: string; metadata?: Record<string, unknown>; reason: string }): Promise<void> {
      await insertAudit(pool, input);
    },

    async listAudit(input: { limit?: number; offset?: number } = {}): Promise<AuditRecord[]> {
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100);
      const offset = Math.max(Math.trunc(input.offset ?? 0), 0);
      const result = await pool.query<AuditRecord>(
        `SELECT id, admin_user_id AS "adminUserId", action, target_user_id AS "targetUserId",
           target_record_id AS "targetRecordId", metadata_json AS metadata, reason, created_at AS "createdAt"
         FROM admin_audit_logs ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return result.rows;
    }
  };
}

async function insertAudit(executor: Pick<Pool, "query">, input: { adminUserId: string; action: string; targetUserId?: string; targetRecordId?: string; metadata?: Record<string, unknown>; reason: string }): Promise<void> {
  await executor.query(
    `INSERT INTO admin_audit_logs (id, admin_user_id, action, target_user_id, target_record_id, metadata_json, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), input.adminUserId, input.action, input.targetUserId ?? null, input.targetRecordId ?? null, JSON.stringify(input.metadata ?? {}), input.reason.trim(), new Date()]
  );
}
