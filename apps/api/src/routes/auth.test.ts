import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("auth routes", () => {
  const authService = {
    sendRegistrationCode: vi.fn().mockResolvedValue({ sent: true, expiresInSeconds: 600 }),
    register: vi.fn().mockResolvedValue({ userId: "user_1", verified: true }),
    verifyEmail: vi.fn().mockResolvedValue({ userId: "user_1", trialCreditsGranted: true }),
    login: vi.fn().mockResolvedValue({ sessionToken: "session-token", user: { id: "user_1", email: "user@example.com", emailVerifiedAt: new Date().toISOString() } }),
    authenticate: vi.fn().mockResolvedValue({ id: "user_1", email: "user@example.com", emailVerifiedAt: new Date().toISOString() }),
    logout: vi.fn().mockResolvedValue(undefined),
    forgotPassword: vi.fn().mockResolvedValue({ ok: true }),
    resetPassword: vi.fn().mockResolvedValue({ ok: true }),
    changePassword: vi.fn().mockResolvedValue({ ok: true })
  };
  let app: { inject: (options: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }) => Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string; json: () => unknown }>; close: () => Promise<void> };

  beforeAll(async () => {
    const { buildApp } = await import("../app.js");
    app = buildApp({ authService }) as typeof app;
    await (app as unknown as { ready: () => Promise<void> }).ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it("registers through the API without returning a password or token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "user@example.com", password: "correct horse battery staple", confirmPassword: "correct horse battery staple", verificationCode: "123456" }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ userId: "user_1", verified: true });
    expect(authService.register).toHaveBeenCalledWith(expect.objectContaining({ verificationCode: "123456" }));
    expect(response.body).not.toContain("123456");
    expect(response.body).not.toContain("session-token");
  });

  it("sends a registration code through the API", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/registration-code",
      payload: { email: "user@example.com" }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ sent: true, expiresInSeconds: 600 });
    expect(authService.sendRegistrationCode).toHaveBeenCalledWith({ email: "user@example.com" });
  });

  it("sets a secure HttpOnly session cookie on login", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "user@example.com", password: "correct horse battery staple" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toEqual(expect.stringContaining("video_session=session-token"));
    expect(response.headers["set-cookie"]).toEqual(expect.stringContaining("HttpOnly"));
  });

  it("requires the session cookie for current-user access", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(response.statusCode).toBe(401);

    const authenticated = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: "video_session=session-token" }
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authService.authenticate).toHaveBeenCalledWith("session-token");
  });

  it("accepts a public reset request and returns only an acknowledgement", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email: "user@example.com" } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    expect(authService.forgotPassword).toHaveBeenCalledWith({ email: "user@example.com" });
    for (const payload of [{}, { email: 123 }, null]) {
      const invalid = await app.inject({ method: "POST", url: "/api/auth/forgot-password", payload });
      expect(invalid.statusCode).toBe(400);
    }
  });

  it("clears the session cookie after resetting a password", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/password-reset", payload: { token: "reset-token", password: "new secure password", confirmPassword: "new secure password" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toEqual(expect.stringContaining("video_session=;"));
  });
});


describe("public auth protection", () => {
  it("checks origin and rate limits before calling account services, and ignores untrusted forwarded IPs", async () => {
    const { buildApp } = await import("../app.js");
    const { DomainError } = await import("@videoanalyze/domain");
    const requestLimit = vi.fn().mockRejectedValue(new DomainError("AUTH_RATE_LIMITED", "请求过于频繁", 429));
    const send = vi.fn();
    const authService = { sendRegistrationCode: send } as unknown as import("./auth.js").AuthServiceContract;
    const app = buildApp({ authService, authOrigin: "https://app.example.com", authRequestLimit: requestLimit });
    try {
      const crossSite = await app.inject({ method: "POST", url: "/api/auth/registration-code", headers: { origin: "https://evil.example" }, payload: { email: "user@example.com" } });
      expect(crossSite.statusCode).toBe(403);
      expect(requestLimit).not.toHaveBeenCalled();
      const blocked = await app.inject({ method: "POST", url: "/api/auth/registration-code", headers: { "x-forwarded-for": "203.0.113.99", origin: "https://app.example.com" }, payload: { email: "user@example.com" } });
      expect(blocked.statusCode).toBe(429);
      expect(requestLimit).toHaveBeenCalledWith("127.0.0.1");
      expect(send).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
