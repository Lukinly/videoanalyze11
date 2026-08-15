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
    original_expires_at TIMESTAMPTZ, result_expires_at TIMESTAMPTZ,
    original_deleted_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    stage TEXT NOT NULL DEFAULT 'queued', status TEXT NOT NULL DEFAULT 'queued',
    progress REAL NOT NULL DEFAULT 0, heartbeat_at TIMESTAMPTZ, error TEXT, failure_kind TEXT,
    summary_json JSONB, display_name TEXT NOT NULL DEFAULT '',
    retention_mode TEXT NOT NULL DEFAULT 'standard' CHECK (retention_mode IN ('standard', 'privacy')),
    result_expires_at TIMESTAMPTZ, results_deleted_at TIMESTAMPTZ,
    media_cleanup_status TEXT NOT NULL DEFAULT 'pending' CHECK (media_cleanup_status IN ('pending', 'cleaning', 'cleaned', 'failed')),
    media_cleanup_attempts INTEGER NOT NULL DEFAULT 0, media_cleanup_error TEXT, media_cleaned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transcript_segments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    start_seconds REAL NOT NULL, end_seconds REAL NOT NULL, text TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    title TEXT NOT NULL, start_seconds REAL NOT NULL, end_seconds REAL NOT NULL,
    summary TEXT NOT NULL, bullets_json JSONB NOT NULL, source_segment_ids_json JSONB NOT NULL,
    alignment_warning BOOLEAN NOT NULL DEFAULT FALSE
  )`,
  `CREATE TABLE IF NOT EXISTS transient_objects (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id TEXT REFERENCES videos(id) ON DELETE CASCADE, run_id TEXT REFERENCES analysis_runs(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('original', 'audio', 'chunk', 'temporary_result')),
    size_bytes BIGINT NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ NOT NULL, deleted_at TIMESTAMPTZ,
    cleanup_attempts INTEGER NOT NULL DEFAULT 0, last_cleanup_error TEXT,
    cleanup_status TEXT NOT NULL DEFAULT 'pending', cleanup_lease_expires_at TIMESTAMPTZ,
    cleanup_claim_token TEXT, created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ephemeral_transcript_segments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    start_seconds REAL NOT NULL, end_seconds REAL NOT NULL, text TEXT NOT NULL, expires_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS ephemeral_run_summaries (
    run_id TEXT PRIMARY KEY REFERENCES analysis_runs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    one_line_summary TEXT NOT NULL, overall_summary TEXT NOT NULL, expires_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS ephemeral_chapters (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    title TEXT NOT NULL, start_seconds REAL NOT NULL, end_seconds REAL NOT NULL, summary TEXT NOT NULL,
    bullets_json JSONB NOT NULL, source_segment_ids_json JSONB NOT NULL,
    alignment_warning BOOLEAN NOT NULL DEFAULT FALSE, expires_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL, start_seconds REAL NOT NULL, end_seconds REAL NOT NULL,
    object_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (run_id, chunk_index)
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
