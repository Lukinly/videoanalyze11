import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

type VerificationRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

type SessionRecord = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
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
    async markVerificationUsed(id: string, usedAt: Date): Promise<void> {
      await pool.query(`UPDATE email_verifications SET used_at = $2 WHERE id = $1 AND used_at IS NULL`, [id, usedAt]);
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
    }
  };
}
