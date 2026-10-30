import { randomUUID } from "node:crypto";
import { DomainError } from "@videoanalyze/domain";
import type { Pool, PoolClient } from "pg";

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  mustChangePassword: boolean;
};

type PublicUserRecord = Omit<UserRecord, "passwordHash">;

export function createUserRepository(pool: Pool) {
  return {
    async create(input: {
      email: string;
      passwordHash: string;
      role?: "user" | "admin";
      status?: "active" | "suspended";
      mustChangePassword?: boolean;
      emailVerifiedAt?: Date | null;
      client?: PoolClient;
    }): Promise<UserRecord> {
      const now = new Date();
      const result = await (input.client ?? pool).query<UserRecord>(
        `INSERT INTO users (id, email, password_hash, email_verified_at, role, status, must_change_password, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         RETURNING id, email, password_hash AS "passwordHash", email_verified_at AS "emailVerifiedAt",
           role, status, must_change_password AS "mustChangePassword"`,
        [randomUUID(), input.email, input.passwordHash, input.emailVerifiedAt ?? null, input.role ?? "user", input.status ?? "active", input.mustChangePassword ?? false, now]
      );
      return result.rows[0];
    },
    async findById(id: string): Promise<UserRecord | null> {
      const result = await pool.query<UserRecord>(
        `SELECT id, email, password_hash AS "passwordHash", email_verified_at AS "emailVerifiedAt",
           role, status, must_change_password AS "mustChangePassword" FROM users WHERE id = $1`,
        [id]
      );
      return result.rows[0] ?? null;
    },
    async findByEmail(email: string): Promise<UserRecord | null> {
      const result = await pool.query<UserRecord>(
        `SELECT id, email, password_hash AS "passwordHash", email_verified_at AS "emailVerifiedAt",
           role, status, must_change_password AS "mustChangePassword" FROM users WHERE email = $1`,
        [email]
      );
      return result.rows[0] ?? null;
    },
    async markEmailVerified(id: string, verifiedAt: Date): Promise<void> {
      await pool.query(`UPDATE users SET email_verified_at = $2, updated_at = $2 WHERE id = $1`, [id, verifiedAt]);
    },
    async list(input: { search?: string; status?: "active" | "suspended"; limit?: number; offset?: number }): Promise<PublicUserRecord[]> {
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100);
      const offset = Math.max(Math.trunc(input.offset ?? 0), 0);
      const values: unknown[] = [];
      const predicates: string[] = [];
      if (input.search) {
        values.push(`%${input.search.trim().toLowerCase()}%`);
        predicates.push(`LOWER(email) LIKE $${values.length}`);
      }
      if (input.status) {
        values.push(input.status);
        predicates.push(`status = $${values.length}`);
      }
      values.push(limit, offset);
      const result = await pool.query<PublicUserRecord>(
        `SELECT id, email, email_verified_at AS "emailVerifiedAt", role, status,
           must_change_password AS "mustChangePassword"
         FROM users ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""}
         ORDER BY created_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      );
      return result.rows;
    },
    async setRole(id: string, role: "user" | "admin"): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query<{ role: "user" | "admin" }>("SELECT role FROM users WHERE id = $1 FOR UPDATE", [id]);
        if (!current.rows[0]) throw new DomainError("NOT_FOUND", "user not found", 404);
        if (current.rows[0].role === "admin" && role !== "admin") {
          const admins = await client.query<{ count: string }>("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active'");
          if (Number(admins.rows[0]?.count ?? 0) <= 1) throw new DomainError("LAST_ADMIN_PROTECTED", "the last active administrator cannot be removed", 409);
        }
        await client.query("UPDATE users SET role = $2, updated_at = $3 WHERE id = $1", [id, role, new Date()]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async setStatus(id: string, status: "active" | "suspended"): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query<{ role: "user" | "admin"; status: "active" | "suspended" }>("SELECT role, status FROM users WHERE id = $1 FOR UPDATE", [id]);
        if (!current.rows[0]) throw new DomainError("NOT_FOUND", "user not found", 404);
        if (current.rows[0].role === "admin" && current.rows[0].status === "active" && status === "suspended") {
          const admins = await client.query<{ count: string }>("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active'");
          if (Number(admins.rows[0]?.count ?? 0) <= 1) throw new DomainError("LAST_ADMIN_PROTECTED", "the last active administrator cannot be suspended", 409);
        }
        await client.query("UPDATE users SET status = $2, updated_at = $3 WHERE id = $1", [id, status, new Date()]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async setMustChangePassword(id: string, value: boolean): Promise<void> {
      await pool.query("UPDATE users SET must_change_password = $2, updated_at = $3 WHERE id = $1", [id, value, new Date()]);
    },
    async updatePassword(id: string, passwordHash: string): Promise<void> {
      await pool.query("UPDATE users SET password_hash = $2, must_change_password = FALSE, updated_at = $3 WHERE id = $1", [id, passwordHash, new Date()]);
    }
  };
}
