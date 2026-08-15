-- V1 summary results: overall/one-line summary on the run, aligned flag on chapters.
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS summary_json JSONB;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS alignment_warning BOOLEAN NOT NULL DEFAULT FALSE;
