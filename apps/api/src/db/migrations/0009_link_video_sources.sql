ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS source_platform TEXT NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS external_video_id TEXT,
  ADD COLUMN IF NOT EXISTS source_part INTEGER,
  ADD COLUMN IF NOT EXISTS source_author TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS subtitle_language TEXT,
  ADD COLUMN IF NOT EXISTS subtitle_kind TEXT;

ALTER TABLE videos
  ADD CONSTRAINT videos_source_platform_check CHECK (source_platform IN ('upload', 'youtube', 'bilibili')),
  ADD CONSTRAINT videos_link_source_complete CHECK (
    source_platform = 'upload' OR
    (source_url IS NOT NULL AND external_video_id IS NOT NULL AND duration > 0)
  );

CREATE UNIQUE INDEX IF NOT EXISTS videos_external_source_idx
  ON videos(user_id, source_platform, external_video_id, COALESCE(source_part, 0))
  WHERE source_platform <> 'upload' AND status <> 'deleted';
