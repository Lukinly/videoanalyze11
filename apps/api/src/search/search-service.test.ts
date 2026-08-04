import { describe, expect, it, vi } from "vitest";
import { createSearchService } from "./search-service.js";

describe("search service", () => {
  it("uses substring fallback for one- and two-character Chinese queries", async () => {
    const search = { query: vi.fn().mockResolvedValue([{ sourceType: "transcript", sourceId: "s1", text: "人类", start: 12, end: 15 }]) };
    const service = createSearchService({ search });

    const result = await service.query({ userId: "u1", runId: "r1", query: "人", limit: 20 });

    expect(search.query).toHaveBeenCalledWith({ userId: "u1", runId: "r1", query: "人", limit: 20, mode: "like" });
    expect(result[0]).toMatchObject({ sourceType: "transcript", start: 12 });
  });

  it("never searches without the authenticated owner and run id", async () => {
    const search = { query: vi.fn().mockResolvedValue([]) };
    const service = createSearchService({ search });

    await service.query({ userId: "u1", runId: "r1", query: "topic", limit: 20 });

    expect(search.query).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", runId: "r1" }));
  });
});
