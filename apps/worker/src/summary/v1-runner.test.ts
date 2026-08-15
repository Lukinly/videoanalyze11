import { describe, expect, it, vi } from "vitest";
import { createV1SummaryRunner } from "./v1-runner.js";

describe("v1 summary runner", () => {
  it("retries one provider failure and persists aligned chapters", async () => {
    const summary = {
      capabilities: vi.fn().mockResolvedValue({ contextWindow: 10_000, structuredOutput: true }),
      summarize: vi.fn()
        .mockRejectedValueOnce(new Error("temporary provider failure"))
        .mockResolvedValueOnce({ oneLineSummary: "一句话", overallSummary: "整体", chapters: [{ id: "ch1", title: "背景", sourceSegmentIds: ["seg_1"], summary: "简介", bullets: [{ text: "要点", sourceSegmentIds: ["seg_1"] }] }] })
    };
    const state = {
      getTranscript: vi.fn().mockResolvedValue({
        duration: 100,
        segments: [{ id: "s1", runId: "r1", start: 10, end: 20, text: "内容" }]
      }),
      setStage: vi.fn().mockResolvedValue(true),
      saveSummary: vi.fn()
    };
    const runner = createV1SummaryRunner({ summary, state });

    await runner.run({ runId: "r1" });

    expect(summary.summarize).toHaveBeenCalledTimes(2);
    // The model is handed compact ids (the full "<runId>_seg_N" ids get
    // truncated by models), then the runner remaps citations back to real ids.
    expect(summary.summarize).toHaveBeenCalledWith(expect.objectContaining({
      segments: [{ id: "seg_1", runId: "r1", start: 10, end: 20, text: "内容" }]
    }));
    expect(state.saveSummary).toHaveBeenCalledWith("r1", expect.objectContaining({
      chapters: [expect.objectContaining({ start: 10, end: 20, alignmentWarning: false, sourceSegmentIds: ["s1"] })]
    }));
  });

  it("does not call the summary provider after the run loses its stage fence", async () => {
    const summary = {
      capabilities: vi.fn().mockResolvedValue({ contextWindow: 10_000, structuredOutput: true }),
      summarize: vi.fn()
    };
    const state = {
      getTranscript: vi.fn().mockResolvedValue({ duration: 100, segments: [] }),
      setStage: vi.fn().mockResolvedValue(false),
      saveSummary: vi.fn()
    };
    const runner = createV1SummaryRunner({ summary, state });

    await expect(runner.run({ runId: "r1" })).rejects.toThrow("analysis run is no longer writable");

    expect(summary.capabilities).not.toHaveBeenCalled();
    expect(summary.summarize).not.toHaveBeenCalled();
  });
});
