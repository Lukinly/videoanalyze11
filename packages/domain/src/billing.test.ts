import { describe, expect, it } from "vitest";
import { calculateDurationTieredCredits } from "./billing.js";

describe("duration-tiered-v2 billing", () => {
  it.each([
    [1, 1, 1],
    [30 * 60, 30, 30],
    [60 * 60, 60, 60],
    [90 * 60, 90, 95],
    [120 * 60, 120, 130],
    [180 * 60, 180, 220],
    [240 * 60, 240, 310],
    [60 * 60 + 1, 61, 62]
  ])("bills %s seconds as %s minutes and %s credits", (seconds, minutes, credits) => {
    expect(calculateDurationTieredCredits(seconds)).toEqual({
      billingRuleVersion: "duration-tiered-v2",
      billedDurationSeconds: seconds,
      billedMinutes: minutes,
      reservedCredits: credits
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 14_400.001])("rejects unsupported duration %s", (seconds) => {
    expect(() => calculateDurationTieredCredits(seconds)).toThrow(/duration/i);
  });
});
