CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  fingerprint TEXT,
  duration REAL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'missing', 'error', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  original_expires_at TIMESTAMPTZ,
  result_expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'queued',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'cancelling', 'cancelled', 'completed', 'failed')),
  progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  heartbeat_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  object_key TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  transcript_object_key TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  UNIQUE (run_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  summary TEXT NOT NULL,
  bullets_json JSONB NOT NULL,
  source_segment_ids_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('trial_grant', 'analysis_reservation')),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'reserved', 'released')),
  idempotency_key TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS videos_user_id_idx ON videos(user_id);
CREATE INDEX IF NOT EXISTS analysis_runs_user_id_idx ON analysis_runs(user_id);
CREATE INDEX IF NOT EXISTS chunks_run_id_idx ON chunks(run_id, chunk_index);
CREATE INDEX IF NOT EXISTS transcript_segments_run_time_idx ON transcript_segments(run_id, start_seconds);
CREATE INDEX IF NOT EXISTS chapters_run_time_idx ON chapters(run_id, start_seconds);
CREATE INDEX IF NOT EXISTS transcript_segments_text_trgm_idx ON transcript_segments USING gin (text gin_trgm_ops);
