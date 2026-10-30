import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "../auth/passwords.js";

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
    createUser: vi.fn().mockResolvedValue({ id: "created_1", email: "new@example.com", passwordHash: "private-hash", emailVerifiedAt: new Date("2026-10-30T00:00:00Z"), role: "user", status: "active", mustChangePassword: true }),
    createTopup: vi.fn(),
    listTopups: vi.fn().mockResolvedValue([]),
    approveTopup: vi.fn().mockResolvedValue({ id: "request_1", status: "approved" }),
    rejectTopup: vi.fn().mockResolvedValue({ id: "request_1", status: "rejected" }),
    adjustCredits: vi.fn().mockResolvedValue(undefined),
    createAudit: vi.fn().mockResolvedValue(undefined),
    listAudit: vi.fn().mockResolvedValue([])
  };
  const requestLimit = vi.fn().mockResolvedValue(undefined);
  let app: { inject: (options: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }) => Promise<{ statusCode: number; json: () => unknown }>; close: () => Promise<void> };

  beforeAll(async () => {
    const { buildApp } = await import("../app.js");
    app = buildApp({ authService, credits, users, adminRepository, authOrigin: "https://app.example.com", authRequestLimit: requestLimit }) as typeof app;
    await (app as unknown as { ready: () => Promise<void> }).ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authService.authenticate.mockResolvedValue({ id: "admin_1", role: "admin", status: "active" });
  });

  it("creates only a normal user, normalizes email and hashes the password without returning credentials", async () => {
    const response = await app.inject({ method: "POST", url: "/api/admin/users", headers: { cookie: "video_session=admin-session", origin: "https://app.example.com" }, payload: { email: " New@Example.com ", password: "initial password", confirmPassword: "initial password", reason: "support request" } });
    expect(response.statusCode).toBe(201);
    const input = adminRepository.createUser.mock.calls[0][0];
    expect(input).toMatchObject({ email: "new@example.com", adminUserId: "admin_1", reason: "support request" });
    expect(await verifyPassword("initial password", input.passwordHash)).toBe(true);
    expect(input.passwordHash).not.toBe("initial password");
    expect(requestLimit).toHaveBeenCalledOnce();
    expect(response.json()).toEqual({ user: { id: "created_1", email: "new@example.com", emailVerifiedAt: "2026-10-30T00:00:00.000Z", role: "user", status: "active", mustChangePassword: true }, welcomeCredits: 12 });
  });

  it.each([
    [undefined, undefined, 401],
    ["user", "active", 403],
    ["admin", "suspended", 403]
  ])("rejects creation by role %s with status %s", async (role, status, expected) => {
    authService.authenticate.mockResolvedValue({ id: "actor", role, status });
    const response = await app.inject({ method: "POST", url: "/api/admin/users", headers: role ? { cookie: "video_session=session" } : {}, payload: { email: "new@example.com", password: "initial password", confirmPassword: "initial password" } });
    expect(response.statusCode).toBe(expected);
    expect(adminRepository.createUser).not.toHaveBeenCalled();
  });

  it.each([
    { email: "invalid" },
    { password: "short", confirmPassword: "short" },
    { confirmPassword: "different password" },
    { password: "中".repeat(25), confirmPassword: "中".repeat(25) },
    { role: "admin" },
    { welcomeCredits: 9999 },
    { reason: "x".repeat(501) }
  ])("rejects invalid or privilege-changing input %j", async (invalid) => {
    const response = await app.inject({ method: "POST", url: "/api/admin/users", headers: { cookie: "video_session=session" }, payload: { email: "new@example.com", password: "initial password", confirmPassword: "initial password", ...invalid } });
    expect(response.statusCode).toBe(400);
    expect(adminRepository.createUser).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin administrator request before creating a user", async () => {
    const response = await app.inject({ method: "POST", url: "/api/admin/users", headers: { cookie: "video_session=session", origin: "https://other.example.com" }, payload: { email: "new@example.com", password: "initial password", confirmPassword: "initial password" } });
    expect(response.statusCode).toBe(403);
    expect(adminRepository.createUser).not.toHaveBeenCalled();
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
