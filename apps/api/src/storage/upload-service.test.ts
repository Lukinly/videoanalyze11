import { describe, expect, it, vi } from "vitest";

describe("upload service", () => {
  it("creates a user-scoped upload session without using the client filename as a path", async () => {
    const { createUploadService } = await import("./upload-service.js");
    const videos = {
      create: vi.fn().mockImplementation(async (input: { id: string; objectKey: string }) => ({ id: input.id, objectKey: input.objectKey })),
      findOwnedById: vi.fn()
    };
    const storage = { createUpload: vi.fn().mockResolvedValue({ uploadUrl: "https://signed", expiresAt: "2026-08-04T00:00:00.000Z" }) };
    const service = createUploadService({ videos, storage, maxBytes: 1000, maxDurationSeconds: 7200 });

    const result = await service.start({ userId: "user_1", fileName: "../../secret.mp4", contentType: "video/mp4", contentLength: 100 });

    expect(result.videoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(videos.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", objectKey: expect.stringMatching(/^users\/user_1\/videos\/[a-z0-9-]+\/original$/) }));
    expect(storage.createUpload).toHaveBeenCalledWith(expect.objectContaining({ objectKey: result.objectKey }));
  });
});
