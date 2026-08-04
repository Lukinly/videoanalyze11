import { describe, expect, it, vi } from "vitest";

describe("analysis service", () => {
  it("reserves one credit and enqueues one idempotent run", async () => {
    const { createAnalysisService } = await import("./analysis-service.js");
    const dependencies = {
      videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "video_1", userId: "user_1" }) },
      usage: { reserveAnalysis: vi.fn().mockResolvedValue("reserved"), releaseAnalysis: vi.fn() },
      runs: {
        create: vi.fn().mockImplementation(async (input: { id: string }) => ({ id: input.id, status: "queued" })),
        findOwnedById: vi.fn(),
        requestCancellation: vi.fn()
      },
      queue: { add: vi.fn().mockResolvedValue(undefined) }
    };
    const service = createAnalysisService(dependencies);

    const result = await service.start({ userId: "user_1", videoId: "video_1" });

    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(dependencies.usage.reserveAnalysis).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", runId: result.id, idempotencyKey: result.id }));
    expect(dependencies.queue.add).toHaveBeenCalledWith("analysis", expect.objectContaining({ runId: result.id }), expect.objectContaining({ jobId: result.id }));
  });

  it("rejects an analysis when no credit is available", async () => {
    const { createAnalysisService } = await import("./analysis-service.js");
    const dependencies = {
      videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "video_1", userId: "user_1" }) },
      usage: { reserveAnalysis: vi.fn().mockResolvedValue("exhausted"), releaseAnalysis: vi.fn() },
      runs: { create: vi.fn(), findOwnedById: vi.fn(), requestCancellation: vi.fn() },
      queue: { add: vi.fn() }
    };

    await expect(createAnalysisService(dependencies).start({ userId: "user_1", videoId: "video_1" }))
      .rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
    expect(dependencies.runs.create).not.toHaveBeenCalled();
  });
});
