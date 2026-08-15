import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createSearchRepository } from "./search.js";

describe("search repository retention routing", () => {
  it("searches privacy transcript and chapter bodies in ephemeral storage", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ sourceType: "transcript", sourceId: "s1", text: "private topic", start: 3, end: 5 }] });
    const repository = createSearchRepository({ query } as unknown as Pool);

    await expect(repository.query({ userId: "u1", runId: "r1", query: "topic", limit: 20, mode: "like" })).resolves.toEqual([
      { sourceType: "transcript", sourceId: "s1", text: "private topic", start: 3, end: 5 }
    ]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("FROM ephemeral_transcript_segments");
    expect(sql).toContain("FROM ephemeral_chapters");
  });
});
