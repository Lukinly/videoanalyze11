import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

type VerificationRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export type RegistrationCodeRecord = {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
  createdAt: Date;
};

type SessionRecord = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

type PasswordResetRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export function createAuthRepository(pool: Pool) {
  return {
    async createVerification(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
      await pool.query(
        `INSERT INTO email_verifications (id, user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), input.userId, input.tokenHash, input.expiresAt, new Date()]
      );
    },
    async findVerification(tokenHash: string): Promise<VerificationRecord | null> {
      const result = await pool.query<VerificationRecord>(
        `SELECT id, user_id AS "userId", token_hash AS "tokenHash", expires_at AS "expiresAt", used_at AS "usedAt"
         FROM email_verifications WHERE token_hash = $1`,
        [tokenHash]
      );
      return result.rows[0] ?? null;
    },
    async markVerificationUsed(id: string, usedAt: Date): Promise<boolean> {
      const result = await pool.query(`UPDATE email_verifications SET used_at = $2 WHERE id = $1 AND used_at IS NULL RETURNING id`, [id, usedAt]);
      return (result.rowCount ?? 0) > 0;
    },
    async createRegistrationCode(input: { email: string; codeHash: string; expiresAt: Date; createdAt: Date }): Promise<void> {
      await pool.query(
        `INSERT INTO registration_verifications (id, email, code_hash, expires_at, used_at, attempts, created_at)
         VALUES ($1, $2, $3, $4, NULL, 0, $5)
         ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash,
           expires_at = EXCLUDED.expires_at, used_at = NULL, attempts = 0, created_at = EXCLUDED.created_at`,
        [randomUUID(), input.email, input.codeHash, input.expiresAt, input.createdAt]
      );
    },
    async findRegistrationCode(email: string): Promise<RegistrationCodeRecord | null> {
      const result = await pool.query<RegistrationCodeRecord>(
        `SELECT id, email, code_hash AS "codeHash", expires_at AS "expiresAt",
           used_at AS "usedAt", attempts, created_at AS "createdAt"
         FROM registration_verifications WHERE email = $1`,
        [email]
      );
      return result.rows[0] ?? null;
    },
    async incrementRegistrationAttempts(id: string, now: Date): Promise<number> {
      void now;
      const result = await pool.query<{ attempts: number }>(
        `UPDATE registration_verifications SET attempts = attempts + 1
         WHERE id = $1 AND used_at IS NULL RETURNING attempts`,
        [id]
      );
      return result.rows[0]?.attempts ?? 0;
    },
    async markRegistrationCodeUsed(id: string, usedAt: Date): Promise<boolean> {
      const result = await pool.query(
        `UPDATE registration_verifications SET used_at = $2
         WHERE id = $1 AND used_at IS NULL RETURNING id`,
        [id, usedAt]
      );
      return (result.rowCount ?? 0) > 0;
    },
    async createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
      await pool.query(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), input.userId, input.tokenHash, input.expiresAt, new Date()]
      );
    },
    async findSession(tokenHash: string): Promise<SessionRecord | null> {
      const result = await pool.query<SessionRecord>(
        `SELECT id, user_id AS "userId", expires_at AS "expiresAt", revoked_at AS "revokedAt"
         FROM sessions WHERE token_hash = $1`,
        [tokenHash]
      );
      return result.rows[0] ?? null;
    },
    async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
      await pool.query(`UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL`, [tokenHash, revokedAt]);
    },
    async createPasswordResetToken(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
      await pool.query("INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)", [randomUUID(), input.userId, input.tokenHash, input.expiresAt, new Date()]);
    },
    async findPasswordResetToken(tokenHash: string): Promise<PasswordResetRecord | null> {
      const result = await pool.query<PasswordResetRecord>("SELECT id, user_id AS \"userId\", token_hash AS \"tokenHash\", expires_at AS \"expiresAt\", used_at AS \"usedAt\" FROM password_reset_tokens WHERE token_hash = $1", [tokenHash]);
      return result.rows[0] ?? null;
    },
    async consumePasswordResetToken(id: string, usedAt: Date): Promise<boolean> {
      const result = await pool.query("UPDATE password_reset_tokens SET used_at = $2 WHERE id = $1 AND used_at IS NULL RETURNING id", [id, usedAt]);
      return (result.rowCount ?? 0) > 0;
    }
  };
}
