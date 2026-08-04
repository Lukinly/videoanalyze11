import { describe, expect, it, vi } from "vitest";
import { createV1SummaryRunner } from "./v1-runner.js";

describe("v1 summary runner", () => {
  it("retries one provider failure and persists aligned chapters", async () => {
    const summary = {
      capabilities: vi.fn().mockResolvedValue({ contextWindow: 10_000, structuredOutput: true }),
      summarize: vi.fn()
        .mockRejectedValueOnce(new Error("temporary provider failure"))
        .mockResolvedValueOnce({ oneLineSummary: "一句话", overallSummary: "整体", chapters: [{ id: "ch1", title: "背景", sourceSegmentIds: ["s1"], summary: "简介", bullets: [] }] })
    };
    const state = {
      getTranscript: vi.fn().mockResolvedValue({
        duration: 100,
        segments: [{ id: "s1", runId: "r1", start: 10, end: 20, text: "内容" }]
      }),
      setStage: vi.fn(),
      saveSummary: vi.fn()
    };
    const runner = createV1SummaryRunner({ summary, state });

    await runner.run({ runId: "r1" });

    expect(summary.summarize).toHaveBeenCalledTimes(2);
    expect(state.saveSummary).toHaveBeenCalledWith("r1", expect.objectContaining({
      chapters: [expect.objectContaining({ start: 10, end: 20, alignmentWarning: false })]
    }));
  });
});
