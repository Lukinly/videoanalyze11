import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("admin routes", () => {
  const authService = {
    sendRegistrationCode: vi.fn(), register: vi.fn(), verifyEmail: vi.fn(), login: vi.fn(), logout: vi.fn(),
    authenticate: vi.fn()
  };
  const credits = {
    getBalance: vi.fn().mockResolvedValue({ ledgerBalance: 0, held: 0, available: 0 }),
    listLedger: vi.fn().mockResolvedValue([]),
    grant: vi.fn().mockResolvedValue(undefined)
  };
  const users = {
    list: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    setRole: vi.fn(),
    setStatus: vi.fn(),
    setMustChangePassword: vi.fn()
  };
  const adminRepository = {
    createTopup: vi.fn(),
    listTopups: vi.fn().mockResolvedValue([]),
    approveTopup: vi.fn().mockResolvedValue({ id: "request_1", status: "approved" }),
    rejectTopup: vi.fn().mockResolvedValue({ id: "request_1", status: "rejected" }),
    adjustCredits: vi.fn().mockResolvedValue(undefined),
    createAudit: vi.fn().mockResolvedValue(undefined),
    listAudit: vi.fn().mockResolvedValue([])
  };
  let app: { inject: (options: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }) => Promise<{ statusCode: number; json: () => unknown }>; close: () => Promise<void> };

  beforeAll(async () => {
    const { buildApp } = await import("../app.js");
    app = buildApp({ authService, credits, users, adminRepository }) as typeof app;
    await (app as unknown as { ready: () => Promise<void> }).ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it("denies a normal user from the administrator API", async () => {
    authService.authenticate.mockResolvedValue({ id: "user_1", role: "user", status: "active" });
    const response = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: "video_session=session" } });
    expect(response.statusCode).toBe(403);
    expect(users.list).not.toHaveBeenCalled();
  });

  it("approves a top-up and records the repository audit event", async () => {
    authService.authenticate.mockResolvedValue({ id: "admin_1", role: "admin", status: "active" });
    const response = await app.inject({ method: "POST", url: "/api/admin/credit-requests/request_1/approve", headers: { cookie: "video_session=admin-session" }, payload: { note: "bank transfer received" } });
    expect(response.statusCode).toBe(200);
    expect(adminRepository.approveTopup).toHaveBeenCalledWith({ requestId: "request_1", adminUserId: "admin_1", reviewNote: "bank transfer received" });
  });

  it("returns the applicant identity with administrator top-up requests", async () => {
    authService.authenticate.mockResolvedValue({ id: "admin_1", role: "admin", status: "active" });
    adminRepository.listTopups.mockResolvedValueOnce([{
      id: "request_1",
      userId: "user_1",
      userEmail: "applicant@example.com",
      requestedAmount: 30,
      note: "bank transfer",
      status: "pending",
      reviewedBy: null,
      reviewNote: null,
      createdAt: new Date("2026-08-11T08:30:00.000Z"),
      reviewedAt: null
    }]);

    const response = await app.inject({ method: "GET", url: "/api/admin/credit-requests?status=pending", headers: { cookie: "video_session=admin-session" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ userId: "user_1", userEmail: "applicant@example.com" }]
    });
  });
});
