import type { Pool } from "pg";
import { parseVideoLink } from "@videoanalyze/domain";
import type { LinkMetadata } from "./link-import-service.js";

type MissingSourceTitle = {
  id: string; userId: string; platform: LinkMetadata["platform"];
  externalId: string; part: number | null; sourceUrl: string;
};

// An explicit maintenance operation: normal history reads never contact video
// platforms. Only the shared title is repaired; analysis and billing stay intact.
export async function repairSourceTitles(input: {
  pool: Pool;
  inspector: { inspect(url: string): Promise<LinkMetadata> };
  url?: string;
  email?: string;
  limit?: number;
}) {
  const source = input.url ? parseVideoLink(input.url) : null;
  if (input.url && !source) throw new Error("a supported public video URL is required");
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be between 1 and 200");
  const candidates = await input.pool.query<MissingSourceTitle>(
    `SELECT video.id, video.user_id AS "userId", video.source_platform AS platform,
       video.external_video_id AS "externalId", video.source_part AS part, video.source_url AS "sourceUrl"
     FROM videos video JOIN users owner ON owner.id = video.user_id
     WHERE video.source_platform IN ('bilibili', 'youtube') AND video.status <> 'deleted'
       AND video.file_name IN ('已删除的视频', '')
       AND ($1::text IS NULL OR (video.source_platform = $1 AND video.external_video_id = $2
         AND COALESCE(video.source_part, 0) = COALESCE($3::int, 0)))
       AND ($4::text IS NULL OR lower(owner.email) = lower($4))
       AND EXISTS (SELECT 1 FROM analysis_runs run WHERE run.video_id = video.id AND run.user_id = video.user_id
         AND run.display_name = '已删除的视频' AND run.results_deleted_at IS NULL
         AND (run.retention_mode = 'standard' OR run.result_expires_at IS NULL OR run.result_expires_at > now()))
     ORDER BY video.created_at DESC, video.id LIMIT $5`,
    [source?.platform ?? null, source?.externalId ?? null, source?.part ?? null, input.email ?? null, limit]
  );
  const report = { scanned: candidates.rows.length, repaired: 0, skipped: 0, failed: 0, failures: [] as Array<{ videoId: string; code: string }> };
  // Multiple owners may reference the same public source. Fetch each part once
  // per invocation, including failures, and keep calls sequential.
  const metadata = new Map<string, Promise<LinkMetadata>>();
  for (const video of candidates.rows) {
    let category = "SOURCE_IDENTITY_MISMATCH";
    try {
      const parsed = parseVideoLink(video.sourceUrl);
      if (!parsed || parsed.platform !== video.platform || parsed.externalId !== video.externalId || parsed.part !== video.part) throw new Error("source identity mismatch");
      const key = parsed.canonicalUrl;
      category = "SOURCE_METADATA_UNAVAILABLE";
      let pending = metadata.get(key);
      if (!pending) { pending = Promise.resolve().then(() => input.inspector.inspect(key)); metadata.set(key, pending); }
      const restored = await pending;
      category = "SOURCE_TITLE_INVALID";
      const title = restored.title.trim();
      if (restored.platform !== video.platform || restored.externalId !== video.externalId || restored.part !== video.part || !title || title === '已删除的视频' || title.length > 2000) throw new Error("source title is unavailable");
      category = "SOURCE_TITLE_SAVE_FAILED";
      const client = await input.pool.connect();
      try {
        await client.query("BEGIN");
        // Deletion also locks the video first. Recheck eligible runs after the
        // lock so a deletion completed during the network request stays deleted.
        await client.query("SELECT id FROM videos WHERE id=$1 AND user_id=$2 FOR UPDATE", [video.id, video.userId]);
        const saved = await client.query(
          `UPDATE videos SET file_name=$3, updated_at=$4
           WHERE id=$1 AND user_id=$2 AND status <> 'deleted' AND file_name IN ('已删除的视频', '')
             AND EXISTS (SELECT 1 FROM analysis_runs run WHERE run.video_id=$1 AND run.user_id=$2
               AND run.display_name='已删除的视频' AND run.results_deleted_at IS NULL
               AND (run.retention_mode='standard' OR run.result_expires_at IS NULL OR run.result_expires_at > now()))`,
          [video.id, video.userId, title, new Date()]
        );
        await client.query("COMMIT");
        if (saved.rowCount === 1) report.repaired += 1;
        else report.skipped += 1;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } catch {
      report.failed += 1;
      report.failures.push({ videoId: video.id, code: category });
    }
  }
  return report;
}
