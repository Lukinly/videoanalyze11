import { describe, expect, it, vi } from "vitest";
import { cleanupExpiredObjects } from "./cleanup-worker.js";

describe("retention cleanup", () => {
  it("deletes expired original and temporary objects idempotently", async () => {
    const storage = { delete: vi.fn().mockResolvedValue(undefined) };
    const state = {
      listExpiredObjects: vi.fn().mockResolvedValue([
        { key: "users/u1/videos/v1/original", kind: "original" },
        { key: "users/u1/runs/r1/chunks/c1.flac", kind: "temporary" }
      ]),
      markObjectDeleted: vi.fn().mockResolvedValue(undefined)
    };

    await cleanupExpiredObjects({ state, storage, now: new Date("2026-08-04T00:00:00.000Z") });
    await cleanupExpiredObjects({ state, storage, now: new Date("2026-08-04T00:00:00.000Z") });

    expect(storage.delete).toHaveBeenCalledWith("users/u1/videos/v1/original");
    expect(storage.delete).toHaveBeenCalledWith("users/u1/runs/r1/chunks/c1.flac");
    expect(state.markObjectDeleted).toHaveBeenCalledTimes(4);
  });
});
