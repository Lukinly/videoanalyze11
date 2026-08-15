import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@videoanalyze/domain";
import { createMediaService } from "./media.js";

describe("media lifecycle routes", () => {
  it("does not sign a playback URL after the original has been deleted", async () => {
    const storage = { getDownloadUrl: vi.fn() };
    const service = createMediaService({
      videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "v1", objectKey: "secret-key", originalDeletedAt: new Date() }) },
      storage
    });

    await expect(service.getPlaybackUrl({ userId: "u1", videoId: "v1" })).rejects.toMatchObject({ code: "ORIGINAL_DELETED", status: 410 });
    expect(storage.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("returns HTTP 410 when the original has been deleted", async () => {
    const { buildApp } = await import("../app.js");
    const authService = { sendRegistrationCode: vi.fn(), register: vi.fn(), verifyEmail: vi.fn(), login: vi.fn(), logout: vi.fn(), authenticate: vi.fn().mockResolvedValue({ id: "u1" }) };
    const app = buildApp({ authService, mediaService: { getPlaybackUrl: vi.fn().mockRejectedValue(new DomainError("ORIGINAL_DELETED", "original deleted", 410)) } });
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/videos/v1/playback-url", headers: { cookie: "video_session=s" } });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ code: "ORIGINAL_DELETED" });
    await app.close();
  });
});
