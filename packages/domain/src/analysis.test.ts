import { describe, expect, it } from "vitest";

describe("analysis domain contracts", () => {
  it("rejects a transcript segment whose end precedes its start", async () => {
    const { transcriptSegmentSchema } = await import("./analysis.js");

    expect(() => transcriptSegmentSchema.parse({
      id: "seg_1",
      runId: "run_1",
      start: 12,
      end: 4,
      text: "invalid"
    })).toThrow();
  });

  it("accepts a segment with a zero start time", async () => {
    const { transcriptSegmentSchema } = await import("./analysis.js");

    expect(transcriptSegmentSchema.parse({
      id: "seg_1",
      runId: "run_1",
      start: 0,
      end: 4,
      text: "valid"
    })).toMatchObject({ start: 0, end: 4 });
  });

  it("rejects analysis stages outside the task state machine", async () => {
    const { analysisStageSchema } = await import("./analysis.js");

    expect(() => analysisStageSchema.parse("uploading_to_cloud")).toThrow();
  });
});
