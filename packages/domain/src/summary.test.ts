import { describe, expect, it } from "vitest";

describe("summary domain contracts", () => {
  it("requires source segment ids for chapters", async () => {
    const { summaryResultSchema } = await import("./summary.js");

    expect(() => summaryResultSchema.parse({
      oneLineSummary: "one line",
      overallSummary: "overall",
      chapters: [{
        id: "chapter_1",
        title: "Chapter",
        sourceSegmentIds: [],
        summary: "summary",
        bullets: []
      }]
    })).toThrow();
  });
});
