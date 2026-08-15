ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS failure_kind TEXT
  CHECK (failure_kind IS NULL OR failure_kind IN ('stale_timeout'));

CREATE INDEX IF NOT EXISTS analysis_runs_failure_kind_idx
  ON analysis_runs(failure_kind)
  WHERE failure_kind IS NOT NULL;
