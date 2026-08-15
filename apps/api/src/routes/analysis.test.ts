import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("analysis routes", () => {
  const authService = {
    sendRegistrationCode: vi.fn(), register: vi.fn(), verifyEmail: vi.fn(), login: vi.fn(), logout: vi.fn(),
    authenticate: vi.fn().mockResolvedValue({ id: "user_1", email: "user@example.com", emailVerifiedAt: new Date().toISOString() })
  };
  const analysisService = {
    start: vi.fn().mockResolvedValue({ id: "run_1", status: "queued" }),
    cancel: vi.fn().mockResolvedValue({ id: "run_1", status: "cancelling" }),
    get: vi.fn().mockResolvedValue({ id: "run_1", status: "completed", stage: "completed", progress: 1 })
  };
  let app: { inject: (options: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }) => Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string; json: () => unknown }>; close: () => Promise<void> };

  beforeAll(async () => {
    const { buildApp } = await import("../app.js");
    app = buildApp({ authService, analysisService }) as typeof app;
    await (app as unknown as { ready: () => Promise<void> }).ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a run only for an authenticated user", async () => {
    const unauthorized = await app.inject({ method: "POST", url: "/api/videos/video_1/analysis-runs" });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({ method: "POST", url: "/api/videos/video_1/analysis-runs", headers: { cookie: "video_session=session-token" } });
    expect(response.statusCode).toBe(202);
    expect(analysisService.start).toHaveBeenCalledWith({ userId: "user_1", videoId: "video_1", retentionMode: "standard" });
  });

  it("passes an explicitly selected privacy mode to the analysis service", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/videos/video_1/analysis-runs",
      headers: { cookie: "video_session=session-token" },
      payload: { retentionMode: "privacy" }
    });

    expect(response.statusCode).toBe(202);
    expect(analysisService.start).toHaveBeenCalledWith({ userId: "user_1", videoId: "video_1", retentionMode: "privacy" });
  });

  it("rejects unsupported retention modes before starting a run", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/videos/video_1/analysis-runs",
      headers: { cookie: "video_session=session-token" },
      payload: { retentionMode: "forever" }
    });

    expect(response.statusCode).toBe(400);
    expect(analysisService.start).not.toHaveBeenCalled();
  });

  it("returns the current run and accepts cancellation", async () => {
    const current = await app.inject({ method: "GET", url: "/api/analysis-runs/run_1", headers: { cookie: "video_session=session-token" } });
    const cancelled = await app.inject({ method: "POST", url: "/api/analysis-runs/run_1/cancel", headers: { cookie: "video_session=session-token" } });

    expect(current.statusCode).toBe(200);
    expect(cancelled.statusCode).toBe(202);
    expect(analysisService.cancel).toHaveBeenCalledWith({ userId: "user_1", runId: "run_1" });
  });
});
