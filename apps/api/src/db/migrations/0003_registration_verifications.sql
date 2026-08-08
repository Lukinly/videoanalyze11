CREATE TABLE IF NOT EXISTS registration_verifications (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL
);
