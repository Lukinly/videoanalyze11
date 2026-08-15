import { describe, expect, it, vi } from "vitest";

describe("analysis service", () => {
  it("enqueues an unpaid run whose exact cost waits for the server duration probe", async () => {
    const { createAnalysisService } = await import("./analysis-service.js");
    const dependencies = {
      videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "video_1", userId: "user_1", fileName: "recording.mp4", fileSize: 100_000_000 }) },
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
    expect(result).toMatchObject({ billingStatus: "pending_duration_probe" });
    expect(dependencies.runs.create).toHaveBeenCalledWith({ id: result.id, userId: "user_1", videoId: "video_1", displayName: "recording.mp4", retentionMode: "standard" });
    expect(dependencies.queue.add).toHaveBeenCalledWith("analysis", expect.objectContaining({ runId: result.id }), expect.objectContaining({ jobId: result.id }));
  });

  it("creates a privacy run with the video's display name", async () => {
    const { createAnalysisService } = await import("./analysis-service.js");
    const dependencies = {
      videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "video_1", userId: "user_1", fileName: "private meeting.mp4", fileSize: 20_000_000 }) },
      runs: {
        create: vi.fn().mockImplementation(async (input: { id: string }) => ({ id: input.id, status: "queued" })),
        findOwnedById: vi.fn(),
        requestCancellation: vi.fn()
      },
      queue: { add: vi.fn().mockResolvedValue(undefined) }
    };
    const service = createAnalysisService(dependencies);

    const result = await service.start({ userId: "user_1", videoId: "video_1", retentionMode: "privacy" });

    expect(dependencies.runs.create).toHaveBeenCalledWith({ id: result.id, userId: "user_1", videoId: "video_1", displayName: "private meeting.mp4", retentionMode: "privacy" });
  });

  it("does not create a file-size reservation when run creation fails", async () => {
    const { createAnalysisService } = await import("./analysis-service.js");
    const dependencies = {
      videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "video_1", userId: "user_1", fileSize: 20_000_000 }) },
      runs: { create: vi.fn().mockRejectedValue(new Error("database unavailable")), findOwnedById: vi.fn(), requestCancellation: vi.fn() },
      queue: { add: vi.fn() }
    };

    await expect(createAnalysisService(dependencies).start({ userId: "user_1", videoId: "video_1" })).rejects.toThrow("database unavailable");
    expect(dependencies.queue.add).not.toHaveBeenCalled();
  });
});
