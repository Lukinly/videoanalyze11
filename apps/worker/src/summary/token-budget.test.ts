import { describe, expect, it } from "vitest";
import { chooseSummaryPlan } from "./token-budget.js";

describe("summary token budget", () => {
  it("uses map-reduce above the 60 percent input budget", () => {
    expect(chooseSummaryPlan({ estimatedInputTokens: 7_000, contextWindow: 10_000, segmentCount: 1_000 })).toBe("map_reduce");
  });

  it("keeps a small transcript in one request", () => {
    expect(chooseSummaryPlan({ estimatedInputTokens: 2_000, contextWindow: 10_000, segmentCount: 10 })).toBe("single");
  });
});
