import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { LinkMetadata } from "../../links/link-import-service.js";

export type VideoRecord = {
  id: string;
  userId: string;
  objectKey: string;
  fileName: string;
  fileSize: number;
  duration: number | null;
  status: string;
  originalDeletedAt: Date | null;
  sourcePlatform?: string;
  sourceUrl?: string | null;
  sourceAuthor?: string | null;
  thumbnailUrl?: string | null;
};

export function createVideoRepository(pool: Pool) {
  return {
    async findOwnedBySource(userId: string, platform: LinkMetadata["platform"], externalId: string, part: number | null) {
      const result = await pool.query<{ videoId: string; runId: string | null; runStatus: string | null }>(
        `SELECT video.id AS "videoId", run.id AS "runId", run.status AS "runStatus"
         FROM videos video
         LEFT JOIN LATERAL (
           SELECT id, status FROM analysis_runs WHERE video_id = video.id
           ORDER BY created_at DESC LIMIT 1
         ) run ON TRUE
         WHERE video.user_id = $1 AND video.source_platform = $2 AND video.external_video_id = $3
           AND COALESCE(video.source_part, 0) = COALESCE($4, 0) AND video.status <> 'deleted'
         ORDER BY video.created_at DESC LIMIT 1`,
        [userId, platform, externalId, part]
      );
      return result.rows[0] ?? null;
    },
    async createLinkVideo(input: LinkMetadata & { userId: string }): Promise<VideoRecord> {
      const now = new Date();
      const id = randomUUID();
      const result = await pool.query<VideoRecord>(
        `INSERT INTO videos (id, user_id, object_key, file_name, file_size, duration, status, created_at, updated_at,
           original_deleted_at, source_platform, source_url, external_video_id, source_part, source_author, thumbnail_url, subtitle_language, subtitle_kind)
         VALUES ($1, $2, $3, $4, 0, $5, 'available', $6, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT DO NOTHING
         RETURNING id, user_id AS "userId", object_key AS "objectKey", file_name AS "fileName",
           file_size::bigint AS "fileSize", duration, status, original_deleted_at AS "originalDeletedAt",
           source_platform AS "sourcePlatform", source_url AS "sourceUrl", source_author AS "sourceAuthor", thumbnail_url AS "thumbnailUrl"`,
        [id, input.userId, `remote/${encodeURIComponent(input.userId)}/${input.platform}/${input.externalId}${input.part ? `/p${input.part}` : ""}`, input.title, input.duration, now,
          input.platform, input.canonicalUrl, input.externalId, input.part, input.author, input.thumbnailUrl, input.subtitleLanguage, input.subtitleKind ?? null]
      );
      if (result.rows[0]) return result.rows[0];
      const existing = await this.findOwnedBySource(input.userId, input.platform, input.externalId, input.part);
      if (!existing) throw new Error("link video conflict could not be resolved");
      const record = await this.findOwnedById(input.userId, existing.videoId);
      if (!record) throw new Error("link video conflict disappeared");
      return record;
    },
    async create(input: { id?: string; userId: string; objectKey: string; fileName: string; fileSize?: number }): Promise<VideoRecord> {
      const now = new Date();
      const result = await pool.query<VideoRecord>(
        `INSERT INTO videos (id, user_id, object_key, file_name, file_size, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id, user_id AS "userId", object_key AS "objectKey", file_name AS "fileName",
           file_size::bigint AS "fileSize", duration, status, original_deleted_at AS "originalDeletedAt"`,
        [input.id ?? randomUUID(), input.userId, input.objectKey, input.fileName, input.fileSize ?? 0, now]
      );
      return result.rows[0];
    },
    async findOwnedById(userId: string, videoId: string): Promise<VideoRecord | null> {
      const result = await pool.query<VideoRecord>(
        `SELECT id, user_id AS "userId", object_key AS "objectKey", file_name AS "fileName",
           file_size::bigint AS "fileSize", duration, status, original_deleted_at AS "originalDeletedAt",
           source_platform AS "sourcePlatform", source_url AS "sourceUrl", source_author AS "sourceAuthor", thumbnail_url AS "thumbnailUrl"
         FROM videos WHERE id = $1 AND user_id = $2 AND status <> 'deleted'`,
        [videoId, userId]
      );
      return result.rows[0] ?? null;
    },
    async listOwnedObjectKeys(userId: string, videoId: string): Promise<string[] | null> {
      const video = await this.findOwnedById(userId, videoId);
      if (!video) return null;
      const runs = await pool.query<{ id: string }>("SELECT id FROM analysis_runs WHERE video_id = $1 AND user_id = $2", [videoId, userId]);
      const keys = [video.objectKey];
      for (const run of runs.rows) {
        keys.push(`users/${encodeURIComponent(userId)}/runs/${encodeURIComponent(run.id)}/audio.flac`);
        keys.push(`users/${encodeURIComponent(userId)}/runs/${encodeURIComponent(run.id)}/summary.json`);
        const chunks = await pool.query<{ objectKey: string; transcriptObjectKey: string | null }>("SELECT object_key AS \"objectKey\", transcript_object_key AS \"transcriptObjectKey\" FROM chunks WHERE run_id = $1 AND user_id = $2", [run.id, userId]);
        for (const chunk of chunks.rows) {
          keys.push(chunk.objectKey);
          if (chunk.transcriptObjectKey) keys.push(chunk.transcriptObjectKey);
        }
      }
      return [...new Set(keys)];
    },
    async markDeleted(userId: string, videoId: string): Promise<void> {
      await pool.query("UPDATE videos SET status = 'deleted', updated_at = $3 WHERE id = $1 AND user_id = $2", [videoId, userId, new Date()]);
    }
  };
}
