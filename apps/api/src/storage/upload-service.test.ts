import { describe, expect, it, vi } from "vitest";

describe("upload service", () => {
  it("creates a user-scoped upload session without using the client filename as a path", async () => {
    const { createUploadService } = await import("./upload-service.js");
    const transientMedia = {
      getLiveBytes: vi.fn().mockResolvedValue(0),
      createTrackedOriginal: vi.fn().mockResolvedValue(undefined)
    };
    const storage = { createUpload: vi.fn().mockResolvedValue({ uploadUrl: "https://signed", expiresAt: "2026-08-04T00:00:00.000Z" }) };
    const clock = () => new Date("2026-08-04T00:00:00.000Z");
    const service = createUploadService({ transientMedia, storage, maxBytes: 1000, maxDurationSeconds: 7200, transientCapacityBytes: 40_000_000_000, clock });

    const result = await service.start({ userId: "user_1", fileName: "../../secret.mp4", contentType: "video/mp4", contentLength: 100 });

    expect(result.videoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).not.toHaveProperty("estimatedCost");
    expect(transientMedia.createTrackedOriginal).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      objectKey: expect.stringMatching(/^users\/user_1\/videos\/[a-z0-9-]+\/original$/),
      expiresAt: new Date("2026-08-05T00:00:00.000Z")
    }));
    expect(storage.createUpload).toHaveBeenCalledWith(expect.objectContaining({ objectKey: result.objectKey }));
  });

  it("rejects an upload that would exceed 80 percent of transient capacity", async () => {
    const { createUploadService } = await import("./upload-service.js");
    const transientMedia = {
      getLiveBytes: vi.fn().mockResolvedValue(31_000_000_000),
      createTrackedOriginal: vi.fn()
    };
    const storage = { createUpload: vi.fn() };
    const service = createUploadService({ transientMedia, storage, maxBytes: 2_000_000_000, maxDurationSeconds: 7200, transientCapacityBytes: 40_000_000_000 });

    await expect(service.start({ userId: "user_1", fileName: "clip.mp4", contentType: "video/mp4", contentLength: 1_000_000_001 }))
      .rejects.toMatchObject({ code: "TEMP_STORAGE_FULL", status: 503 });

    expect(transientMedia.createTrackedOriginal).not.toHaveBeenCalled();
    expect(storage.createUpload).not.toHaveBeenCalled();
  });

  it("accepts an upload that reaches exactly 80 percent of transient capacity", async () => {
    const { createUploadService } = await import("./upload-service.js");
    const transientMedia = {
      getLiveBytes: vi.fn().mockResolvedValue(31_000_000_000),
      createTrackedOriginal: vi.fn().mockResolvedValue(undefined)
    };
    const storage = { createUpload: vi.fn().mockResolvedValue({ uploadUrl: "https://signed", expiresAt: "2026-08-04T00:00:00.000Z" }) };
    const service = createUploadService({ transientMedia, storage, maxBytes: 2_000_000_000, maxDurationSeconds: 7200, transientCapacityBytes: 40_000_000_000, logger: { warn: vi.fn() } });

    await expect(service.start({ userId: "user_1", fileName: "clip.mp4", contentType: "video/mp4", contentLength: 1_000_000_000 }))
      .resolves.toMatchObject({ uploadUrl: "https://signed" });
  });

  it("logs only byte counts when an accepted upload crosses the warning threshold", async () => {
    const { createUploadService } = await import("./upload-service.js");
    const transientMedia = {
      getLiveBytes: vi.fn().mockResolvedValue(27_000_000_000),
      createTrackedOriginal: vi.fn().mockResolvedValue(undefined)
    };
    const storage = { createUpload: vi.fn().mockResolvedValue({ uploadUrl: "https://signed", expiresAt: "2026-08-04T00:00:00.000Z" }) };
    const logger = { warn: vi.fn() };
    const service = createUploadService({ transientMedia, storage, maxBytes: 2_000_000_000, maxDurationSeconds: 7200, transientCapacityBytes: 40_000_000_000, logger });

    await service.start({ userId: "sensitive-user", fileName: "sensitive.mp4", contentType: "video/mp4", contentLength: 1_000_000_000 });

    expect(logger.warn).toHaveBeenCalledWith({ liveBytes: 27_000_000_000, incomingBytes: 1_000_000_000, capacityBytes: 40_000_000_000 });
  });

  it("retains the tracked original when signing the upload URL fails", async () => {
    const { createUploadService } = await import("./upload-service.js");
    const transientMedia = {
      getLiveBytes: vi.fn().mockResolvedValue(0),
      createTrackedOriginal: vi.fn().mockResolvedValue(undefined)
    };
    const storage = { createUpload: vi.fn().mockRejectedValue(new Error("signing failed")) };
    const service = createUploadService({ transientMedia, storage, maxBytes: 2_000_000_000, maxDurationSeconds: 7200, transientCapacityBytes: 40_000_000_000 });

    await expect(service.start({ userId: "user_1", fileName: "clip.mp4", contentType: "video/mp4", contentLength: 100 }))
      .rejects.toThrow("signing failed");

    expect(transientMedia.createTrackedOriginal).toHaveBeenCalledOnce();
  });
});
