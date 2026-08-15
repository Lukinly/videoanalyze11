ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  type TEXT NOT NULL CHECK (type IN ('welcome_grant', 'admin_grant', 'admin_debit', 'analysis_charge', 'refund')),
  reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (type IN ('welcome_grant', 'admin_grant', 'refund') AND amount > 0)
    OR (type IN ('admin_debit', 'analysis_charge') AND amount < 0)
  )
);

CREATE TABLE IF NOT EXISTS credit_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('held', 'consumed', 'released')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  release_reason TEXT
);

CREATE TABLE IF NOT EXISTS credit_topup_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_amount INTEGER NOT NULL CHECK (requested_amount > 0),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES users(id),
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_user_id TEXT REFERENCES users(id),
  target_record_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx ON credit_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_reservations_user_status_idx ON credit_reservations(user_id, status);
CREATE INDEX IF NOT EXISTS credit_topup_requests_status_created_idx ON credit_topup_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC);

INSERT INTO credit_reservations
  (id, user_id, run_id, amount, status, idempotency_key, created_at)
SELECT
  'migrated-reservation-' || ul.id,
  ul.user_id,
  COALESCE(ul.run_id, 'migrated-run-' || ul.id),
  ABS(ul.amount),
  'held',
  'migration:reservation:' || ul.id,
  ul.created_at
FROM usage_ledger ul
WHERE ul.kind = 'analysis_reservation' AND ul.status = 'reserved' AND ul.amount < 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO credit_ledger
  (id, user_id, amount, type, reference_id, idempotency_key, reason, created_at)
SELECT
  'migrated-' || ul.id,
  ul.user_id,
  ul.amount,
  CASE WHEN ul.kind = 'trial_grant' THEN 'welcome_grant' ELSE 'analysis_charge' END,
  ul.run_id,
  'migration:usage:' || ul.id,
  'migrated from usage_ledger',
  ul.created_at
FROM usage_ledger ul
WHERE (ul.kind = 'trial_grant' AND ul.amount > 0)
   OR (ul.kind = 'analysis_reservation' AND ul.status = 'confirmed' AND ul.amount < 0)
ON CONFLICT (idempotency_key) DO NOTHING;
