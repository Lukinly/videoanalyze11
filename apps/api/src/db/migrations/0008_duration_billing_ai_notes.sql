ALTER TABLE analysis_runs
  ADD COLUMN IF NOT EXISTS billing_rule_version TEXT,
  ADD COLUMN IF NOT EXISTS billed_duration_seconds DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS billed_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS reserved_credits INTEGER;

ALTER TABLE analysis_runs
  ADD CONSTRAINT analysis_runs_billing_snapshot_complete CHECK (
    (billing_rule_version IS NULL AND billed_duration_seconds IS NULL AND billed_minutes IS NULL AND reserved_credits IS NULL)
    OR
    (billing_rule_version IS NOT NULL AND billed_duration_seconds > 0 AND billed_minutes > 0 AND reserved_credits > 0)
  );

CREATE OR REPLACE FUNCTION reject_analysis_billing_snapshot_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.billing_rule_version IS NOT NULL AND (
    NEW.billing_rule_version IS DISTINCT FROM OLD.billing_rule_version OR
    NEW.billed_duration_seconds IS DISTINCT FROM OLD.billed_duration_seconds OR
    NEW.billed_minutes IS DISTINCT FROM OLD.billed_minutes OR
    NEW.reserved_credits IS DISTINCT FROM OLD.reserved_credits
  ) THEN
    RAISE EXCEPTION 'analysis billing snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS analysis_runs_billing_snapshot_immutable ON analysis_runs;
CREATE TRIGGER analysis_runs_billing_snapshot_immutable
BEFORE UPDATE ON analysis_runs
FOR EACH ROW EXECUTE FUNCTION reject_analysis_billing_snapshot_update();

CREATE TABLE ai_notes (
  run_id TEXT PRIMARY KEY REFERENCES analysis_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notes_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ai_notes_user_run_idx ON ai_notes(user_id, run_id);

CREATE TABLE ephemeral_ai_notes (
  run_id TEXT PRIMARY KEY REFERENCES analysis_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notes_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ephemeral_ai_notes_expires_at_idx ON ephemeral_ai_notes(expires_at);
CREATE INDEX ephemeral_ai_notes_user_run_idx ON ephemeral_ai_notes(user_id, run_id);
