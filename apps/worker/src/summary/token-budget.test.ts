import { describe, expect, it } from "vitest";
import { chooseSummaryPlan, estimateTranscriptTokens } from "./token-budget.js";

describe("summary token budget", () => {
  it("uses map-reduce above the 60 percent input budget", () => {
    expect(chooseSummaryPlan({ estimatedInputTokens: 7_000, contextWindow: 10_000, segmentCount: 1_000 })).toBe("map_reduce");
  });

  it("keeps a small transcript in one request", () => {
    expect(chooseSummaryPlan({ estimatedInputTokens: 2_000, contextWindow: 10_000, segmentCount: 10 })).toBe("single");
  });

  it("budgets Chinese transcript text conservatively instead of treating it as English", () => {
    const tokens = estimateTranscriptTokens([{ id: "seg_1", runId: "run", start: 0, end: 60, text: "中文内容".repeat(1000) }]);
    expect(tokens).toBeGreaterThanOrEqual(8000);
    expect(chooseSummaryPlan({ estimatedInputTokens: tokens, contextWindow: 10_000, segmentCount: 1 })).toBe("map_reduce");
  });
});
