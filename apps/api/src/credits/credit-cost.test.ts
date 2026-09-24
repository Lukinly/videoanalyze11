import { describe, expect, it } from "vitest";
import { calculateAnalysisCost } from "./credit-cost.js";

describe("calculateAnalysisCost", () => {
  it("charges one point for a file up to 10 MB", () => {
    expect(calculateAnalysisCost(1)).toBe(1);
    expect(calculateAnalysisCost(10_000_000)).toBe(1);
  });

  it("rounds every additional 10 MB upward", () => {
    expect(calculateAnalysisCost(10_000_001)).toBe(2);
    expect(calculateAnalysisCost(20_000_000)).toBe(2);
    expect(calculateAnalysisCost(100_000_000)).toBe(10);
  });

  it("rejects non-finite or non-positive sizes", () => {
    expect(() => calculateAnalysisCost(0)).toThrow("file size must be positive");
    expect(() => calculateAnalysisCost(-1)).toThrow("file size must be positive");
    expect(() => calculateAnalysisCost(Number.NaN)).toThrow("file size must be positive");
    expect(() => calculateAnalysisCost(Number.POSITIVE_INFINITY)).toThrow("file size must be positive");
  });
});
