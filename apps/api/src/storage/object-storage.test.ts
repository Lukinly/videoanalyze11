import { describe, expect, it, vi } from "vitest";

describe("object storage", () => {
  it("creates an object key that ignores path traversal in the file name", async () => {
    const { createOriginalVideoKey } = await import("./object-keys.js");

    expect(createOriginalVideoKey("user_1", "video_1", "../secret.mp4"))
      .toMatch(/^users\/user_1\/videos\/video_1\/original$/);
  });

  it("rejects an upload beyond the configured byte limit", async () => {
    const { validateUploadInput } = await import("./upload-validation.js");

    expect(() => validateUploadInput({
      fileName: "large.mp4",
      contentType: "video/mp4",
      contentLength: 101
    }, { maxBytes: 100, maxDurationSeconds: 7200 })).toThrowError("upload exceeds size limit");
  });

  it("presigns a put without exposing the bucket to the caller", async () => {
    const { createS3ObjectStorage } = await import("./s3-storage.js");
    const send = vi.fn();
    const presign = vi.fn().mockResolvedValue("https://signed/upload");
    const storage = createS3ObjectStorage({
      client: { send },
      bucket: "private-bucket",
      presign
    });

    const result = await storage.createUpload({
      objectKey: "users/u1/videos/v1/original",
      contentType: "video/mp4",
      contentLength: 10
    });

    expect(result.uploadUrl).toBe("https://signed/upload");
    expect(presign).toHaveBeenCalledOnce();
    expect(JSON.stringify(presign.mock.calls[0][1])).toContain("users/u1/videos/v1/original");
  }, 30_000);
});
