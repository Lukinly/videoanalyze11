import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
};

export function createUserRepository(pool: Pool) {
  return {
    async create(input: { email: string; passwordHash: string }): Promise<UserRecord> {
      const now = new Date();
      const result = await pool.query<UserRecord>(
        `INSERT INTO users (id, email, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         RETURNING id, email, password_hash AS "passwordHash", email_verified_at AS "emailVerifiedAt"`,
        [randomUUID(), input.email, input.passwordHash, now]
      );
      return result.rows[0];
    },
    async findById(id: string): Promise<UserRecord | null> {
      const result = await pool.query<UserRecord>(
        `SELECT id, email, password_hash AS "passwordHash", email_verified_at AS "emailVerifiedAt" FROM users WHERE id = $1`,
        [id]
      );
      return result.rows[0] ?? null;
    },
    async findByEmail(email: string): Promise<UserRecord | null> {
      const result = await pool.query<UserRecord>(
        `SELECT id, email, password_hash AS "passwordHash", email_verified_at AS "emailVerifiedAt" FROM users WHERE email = $1`,
        [email]
      );
      return result.rows[0] ?? null;
    }
  };
}
