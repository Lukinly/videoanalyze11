import type { Pool } from "pg";

const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    email_verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_verifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL, file_name TEXT NOT NULL, file_size BIGINT NOT NULL DEFAULT 0,
    fingerprint TEXT, duration REAL, status TEXT NOT NULL DEFAULT 'available',
    created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
    original_expires_at TIMESTAMPTZ, result_expires_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS usage_ledger (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id TEXT, amount INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE, reason TEXT, created_at TIMESTAMPTZ NOT NULL
  )`
];

export async function migrateTestDatabase(pool: Pool) {
  for (const statement of migrationStatements) {
    await pool.query(statement);
  }
}
