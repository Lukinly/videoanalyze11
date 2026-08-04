import { describe, expect, it } from "vitest";

describe("transcript merge", () => {
  it("offsets relative chunk timestamps and removes an exact overlap duplicate", async () => {
    const { mergeChunkTranscripts } = await import("./transcript-merge.js");
    const result = mergeChunkTranscripts({
      videoDuration: 20,
      chunks: [
        { start: 0, end: 12, segments: [{ start: 10, end: 12, text: "same sentence" }] },
        { start: 10, end: 20, segments: [{ start: 0, end: 2, text: "same sentence" }] }
      ]
    });

    expect(result.segments).toEqual([{ id: "seg_1", runId: "merged", start: 10, end: 12, text: "same sentence" }]);
    expect(result.mergeWarnings).toEqual([]);
  });

  it("keeps uncertain overlap content and reports a warning", async () => {
    const { mergeChunkTranscripts } = await import("./transcript-merge.js");
    const result = mergeChunkTranscripts({
      videoDuration: 20,
      chunks: [
        { start: 0, end: 12, segments: [{ start: 10, end: 12, text: "first wording" }] },
        { start: 10, end: 20, segments: [{ start: 0, end: 2, text: "different wording" }] }
      ]
    });

    expect(result.segments).toHaveLength(2);
    expect(result.mergeWarnings).toHaveLength(1);
  });
});
