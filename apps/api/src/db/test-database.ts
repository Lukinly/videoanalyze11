import type { Pool } from "pg";

const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    email_verified_at TIMESTAMPTZ, role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active',
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_verifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS registration_verifications (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL
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
  `CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    stage TEXT NOT NULL DEFAULT 'queued', status TEXT NOT NULL DEFAULT 'queued',
    progress REAL NOT NULL DEFAULT 0, heartbeat_at TIMESTAMPTZ, error TEXT,
    created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS usage_ledger (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id TEXT, amount INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE, reason TEXT, created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS credit_ledger (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount <> 0), type TEXT NOT NULL, reference_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE, reason TEXT NOT NULL, created_by TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS credit_reservations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL CHECK (amount > 0), status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ, released_at TIMESTAMPTZ, release_reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS credit_topup_requests (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_amount INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by TEXT REFERENCES users(id), review_note TEXT, created_at TIMESTAMPTZ NOT NULL, reviewed_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id TEXT PRIMARY KEY, admin_user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
    target_user_id TEXT REFERENCES users(id), target_record_id TEXT, metadata_json JSONB NOT NULL DEFAULT '{}',
    reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL
  )`
];

export async function migrateTestDatabase(pool: Pool) {
  for (const statement of migrationStatements) {
    await pool.query(statement);
  }
}
