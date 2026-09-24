import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("credit routes", () => {
  const authService = {
    sendRegistrationCode: vi.fn(), register: vi.fn(), verifyEmail: vi.fn(), login: vi.fn(), logout: vi.fn(),
    authenticate: vi.fn().mockResolvedValue({ id: "user_1", role: "user", status: "active" })
  };
  const credits = {
    getBalance: vi.fn().mockResolvedValue({ ledgerBalance: 12, held: 2, available: 10 }),
    listLedger: vi.fn().mockResolvedValue([])
  };
  const topups = {
    createTopup: vi.fn().mockResolvedValue({ id: "request_1", requestedAmount: 50, status: "pending" }),
    listTopups: vi.fn().mockResolvedValue([])
  };
  let app: { inject: (options: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }) => Promise<{ statusCode: number; json: () => unknown }>; close: () => Promise<void> };

  beforeAll(async () => {
    const { buildApp } = await import("../app.js");
    app = buildApp({ authService, credits, topups }) as typeof app;
    await (app as unknown as { ready: () => Promise<void> }).ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it("returns the authenticated user's available credits", async () => {
    const response = await app.inject({ method: "GET", url: "/api/credits", headers: { cookie: "video_session=session" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ledgerBalance: 12, held: 2, available: 10 });
  });

  it("creates a positive top-up request for the authenticated user", async () => {
    const response = await app.inject({ method: "POST", url: "/api/credit-requests", headers: { cookie: "video_session=session" }, payload: { requestedAmount: 50, note: "bank transfer" } });
    expect(response.statusCode).toBe(201);
    expect(topups.createTopup).toHaveBeenCalledWith({ userId: "user_1", requestedAmount: 50, note: "bank transfer" });
  });
});
