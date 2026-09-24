import { describe, expect, it, vi } from "vitest";

describe("analysis service", () => {
  it("reserves the stored video size cost and enqueues one idempotent run", async () => {
    const { createAnalysisService } = await import("./analysis-service.js");
    const dependencies = {
      videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "video_1", userId: "user_1", fileSize: 100_000_000 }) },
      credits: { reserveAnalysis: vi.fn().mockResolvedValue("held"), releaseReservation: vi.fn() },
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
    expect(result.estimatedCost).toBe(10);
    expect(dependencies.credits.reserveAnalysis).toHaveBeenCalledWith({ userId: "user_1", runId: result.id, amount: 10 });
    expect(dependencies.queue.add).toHaveBeenCalledWith("analysis", expect.objectContaining({ runId: result.id }), expect.objectContaining({ jobId: result.id }));
  });

  it("rejects an analysis when no credit is available", async () => {
    const { createAnalysisService } = await import("./analysis-service.js");
    const dependencies = {
      videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "video_1", userId: "user_1", fileSize: 100_000_000 }) },
      credits: { reserveAnalysis: vi.fn().mockResolvedValue("exhausted"), releaseReservation: vi.fn() },
      runs: { create: vi.fn(), findOwnedById: vi.fn(), requestCancellation: vi.fn() },
      queue: { add: vi.fn() }
    };

    await expect(createAnalysisService(dependencies).start({ userId: "user_1", videoId: "video_1" }))
      .rejects.toMatchObject({ code: "CREDITS_EXHAUSTED" });
    expect(dependencies.runs.create).not.toHaveBeenCalled();
  });

  it("releases a held reservation when run creation fails", async () => {
    const { createAnalysisService } = await import("./analysis-service.js");
    const dependencies = {
      videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "video_1", userId: "user_1", fileSize: 20_000_000 }) },
      credits: { reserveAnalysis: vi.fn().mockResolvedValue("held"), releaseReservation: vi.fn().mockResolvedValue(undefined) },
      runs: { create: vi.fn().mockRejectedValue(new Error("database unavailable")), findOwnedById: vi.fn(), requestCancellation: vi.fn() },
      queue: { add: vi.fn() }
    };

    await expect(createAnalysisService(dependencies).start({ userId: "user_1", videoId: "video_1" })).rejects.toThrow("database unavailable");
    expect(dependencies.credits.releaseReservation).toHaveBeenCalledWith(expect.any(String), "analysis creation failed");
  });
});
