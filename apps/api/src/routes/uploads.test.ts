import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("upload routes", () => {
  const authService = {
    register: vi.fn(), verifyEmail: vi.fn(), login: vi.fn(), logout: vi.fn(),
    authenticate: vi.fn().mockResolvedValue({ id: "user_1", email: "user@example.com", emailVerifiedAt: new Date().toISOString() })
  };
  const uploadService = {
    start: vi.fn().mockResolvedValue({ videoId: "video_1", objectKey: "users/user_1/videos/video_1/original", uploadUrl: "https://signed", expiresAt: "2026-08-04T00:00:00.000Z" })
  };
  let app: { inject: (options: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }) => Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string; json: () => unknown }>; close: () => Promise<void> };

  beforeAll(async () => {
    const { buildApp } = await import("../app.js");
    app = buildApp({ authService, uploadService }) as typeof app;
    await (app as unknown as { ready: () => Promise<void> }).ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it("requires a session before creating an upload", async () => {
    const response = await app.inject({ method: "POST", url: "/api/videos/upload-session", payload: { fileName: "a.mp4", contentType: "video/mp4", contentLength: 10 } });
    expect(response.statusCode).toBe(401);
  });

  it("creates an upload for the authenticated user", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/videos/upload-session",
      headers: { cookie: "video_session=session-token" },
      payload: { fileName: "a.mp4", contentType: "video/mp4", contentLength: 10 }
    });

    expect(response.statusCode).toBe(201);
    expect(uploadService.start).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", fileName: "a.mp4" }));
  });
});
