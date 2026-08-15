ALTER TABLE transient_objects ADD COLUMN IF NOT EXISTS cleanup_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (cleanup_status IN ('pending', 'cleaning', 'failed', 'cleaned'));
ALTER TABLE transient_objects ADD COLUMN IF NOT EXISTS cleanup_lease_expires_at TIMESTAMPTZ;
ALTER TABLE transient_objects ADD COLUMN IF NOT EXISTS cleanup_claim_token TEXT;

CREATE INDEX IF NOT EXISTS transient_objects_cleanup_claim_idx
  ON transient_objects(cleanup_status, cleanup_lease_expires_at, expires_at)
  WHERE deleted_at IS NULL;
