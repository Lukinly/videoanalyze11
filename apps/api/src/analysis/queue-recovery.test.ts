import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { recoverQueuedRuns } from "./queue-recovery.js";
import { createAnalysisService } from "./analysis-service.js";

describe("durable analysis dispatch", () => {
  it("recovers persisted queued rows with stable BullMQ job IDs", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: "run", userId: "user", videoId: "video" }] }) };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    await recoverQueuedRuns({ pool: pool as unknown as Pool, queue });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("WHERE status IN ('queued', 'cancelling')"));
    expect(queue.add).toHaveBeenCalledWith("analysis", { userId: "user", videoId: "video", runId: "run" }, { jobId: "run" });
  });

  it("retries dispatch of the same saved run after Redis recovers", async () => {
    let saved: { id: string; status: string } | null = null;
    const runs = {
      findActiveOwnedByVideo: vi.fn(async () => saved),
      create: vi.fn(async ({ id }: { id: string }) => { saved = { id, status: "queued" }; return saved; }),
      findOwnedById: vi.fn(), requestCancellation: vi.fn()
    };
    const queue = { add: vi.fn().mockRejectedValueOnce(new Error("redis disconnected")).mockResolvedValue(undefined) };
    const service = createAnalysisService({
      videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "video", userId: "user", fileName: "clip.mp4", fileSize: 1 }) }, runs, queue
    });
    await expect(service.start({ userId: "user", videoId: "video" })).rejects.toMatchObject({ code: "QUEUE_UNAVAILABLE", status: 503 });
    const result = await service.start({ userId: "user", videoId: "video" });
    expect(runs.create).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0]).toEqual(queue.add.mock.calls[1]);
    expect(result.id).toBe(saved!.id);
  });

  it("does not redispatch a running or cancelling task", async () => {
    const queue = { add: vi.fn() };
    for (const status of ["running", "cancelling"]) {
      const service = createAnalysisService({
        videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "video" }) },
        runs: { create: vi.fn(), findActiveOwnedByVideo: vi.fn().mockResolvedValue({ id: "run", status }), findOwnedById: vi.fn(), requestCancellation: vi.fn() }, queue
      });
      await service.start({ userId: "user", videoId: "video" });
    }
    expect(queue.add).not.toHaveBeenCalled();
  });
});
