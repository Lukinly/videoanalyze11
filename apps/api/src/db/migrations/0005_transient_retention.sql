ALTER TABLE videos ADD COLUMN IF NOT EXISTS original_deleted_at TIMESTAMPTZ;

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS retention_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK (retention_mode IN ('standard', 'privacy'));
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS result_expires_at TIMESTAMPTZ;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS results_deleted_at TIMESTAMPTZ;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS media_cleanup_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (media_cleanup_status IN ('pending', 'cleaning', 'cleaned', 'failed'));
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS media_cleanup_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS media_cleanup_error TEXT;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS media_cleaned_at TIMESTAMPTZ;

UPDATE analysis_runs
SET display_name = videos.file_name
FROM videos
WHERE analysis_runs.video_id = videos.id
  AND analysis_runs.display_name = '';

CREATE TABLE IF NOT EXISTS transient_objects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES analysis_runs(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('original','audio','chunk','temporary_result')),
  size_bytes BIGINT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  last_cleanup_error TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ephemeral_transcript_segments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  text TEXT NOT NULL,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ephemeral_run_summaries (
  run_id TEXT PRIMARY KEY REFERENCES analysis_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  one_line_summary TEXT NOT NULL,
  overall_summary TEXT NOT NULL,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ephemeral_chapters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  summary TEXT NOT NULL,
  bullets_json JSONB NOT NULL,
  source_segment_ids_json JSONB NOT NULL,
  alignment_warning BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS analysis_runs_result_expires_at_idx ON analysis_runs(result_expires_at);
CREATE INDEX IF NOT EXISTS transient_objects_expires_at_idx ON transient_objects(expires_at);
CREATE INDEX IF NOT EXISTS transient_objects_run_id_idx ON transient_objects(run_id);
CREATE INDEX IF NOT EXISTS ephemeral_transcript_segments_expires_at_idx ON ephemeral_transcript_segments(expires_at);
CREATE INDEX IF NOT EXISTS ephemeral_transcript_segments_run_time_idx ON ephemeral_transcript_segments(run_id, start_seconds);
CREATE INDEX IF NOT EXISTS ephemeral_run_summaries_expires_at_idx ON ephemeral_run_summaries(expires_at);
CREATE INDEX IF NOT EXISTS ephemeral_chapters_expires_at_idx ON ephemeral_chapters(expires_at);
CREATE INDEX IF NOT EXISTS ephemeral_chapters_run_time_idx ON ephemeral_chapters(run_id, start_seconds);
