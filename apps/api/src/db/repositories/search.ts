import type { Pool } from "pg";
import type { SearchResult } from "../../search/search-service.js";

export function createSearchRepository(pool: Pool) {
  return {
    async query(input: { userId: string; runId: string; query: string; limit: number; mode: "trgm" | "like" }): Promise<SearchResult[]> {
      const pattern = `%${input.query}%`;
      const transcriptPredicate = input.mode === "trgm" ? "(text ILIKE $3 OR text % $2)" : "text ILIKE $3";
      const chapterPredicate = input.mode === "trgm" ? "((title || ' ' || summary) ILIKE $3 OR (title || ' ' || summary) % $2)" : "(title || ' ' || summary) ILIKE $3";
      const result = await pool.query<SearchResult>(
        `SELECT 'transcript' AS "sourceType", id AS "sourceId", text, start_seconds AS start, end_seconds AS end
         FROM transcript_segments
         WHERE user_id = $1 AND run_id = $4 AND ${transcriptPredicate}
         UNION ALL
         SELECT 'chapter' AS "sourceType", id AS "sourceId", title || ': ' || summary AS text, start_seconds AS start, end_seconds AS end
         FROM chapters
         WHERE user_id = $1 AND run_id = $4 AND ${chapterPredicate}
         UNION ALL
         SELECT 'transcript' AS "sourceType", id AS "sourceId", text, start_seconds AS start, end_seconds AS end
         FROM ephemeral_transcript_segments
         WHERE user_id = $1 AND run_id = $4 AND ${transcriptPredicate}
         UNION ALL
         SELECT 'chapter' AS "sourceType", id AS "sourceId", title || ': ' || summary AS text, start_seconds AS start, end_seconds AS end
         FROM ephemeral_chapters
         WHERE user_id = $1 AND run_id = $4 AND ${chapterPredicate}
         ORDER BY start ASC
         LIMIT $5`,
        [input.userId, input.query, pattern, input.runId, input.limit]
      );
      return result.rows;
    }
  };
}
