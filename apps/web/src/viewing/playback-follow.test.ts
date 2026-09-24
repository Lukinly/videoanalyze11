import { describe, expect, it } from "vitest";
import { findActiveTimedItem, FOLLOW_RESUME_DELAY_MS } from "./playback-follow";

describe("playback follow", () => {
  const items = [
    { id: "a", start: 0, end: 10 },
    { id: "b", start: 10, end: 20 }
  ];

  it("finds the item containing the current time", () => {
    expect(findActiveTimedItem(items, 12)?.id).toBe("b");
  });

  it("returns no item outside known time ranges", () => {
    expect(findActiveTimedItem(items, 25)).toBeUndefined();
  });

  it("waits before resuming follow after manual scrolling", () => {
    expect(FOLLOW_RESUME_DELAY_MS).toBeGreaterThanOrEqual(2000);
  });
});
