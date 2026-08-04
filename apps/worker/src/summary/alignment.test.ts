import { describe, expect, it } from "vitest";
import { alignChapter } from "./alignment.js";

describe("chapter source alignment", () => {
  it("derives chapter time from referenced segments", () => {
    expect(alignChapter({
      chapterId: "ch1",
      sourceSegmentIds: ["s2", "s1"],
      segments: [
        { id: "s1", runId: "r1", start: 10, end: 20, text: "a" },
        { id: "s2", runId: "r1", start: 42, end: 60, text: "b" }
      ],
      duration: 100
    })).toMatchObject({ id: "ch1", start: 10, end: 60, alignmentWarning: false });
  });

  it("marks missing references and falls back to deterministic bounds", () => {
    expect(alignChapter({
      chapterId: "ch1",
      sourceSegmentIds: ["missing"],
      segments: [],
      duration: 100
    })).toMatchObject({ start: 0, end: 100, alignmentWarning: true });
  });
});
