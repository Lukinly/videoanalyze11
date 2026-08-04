import { describe, expect, it } from "vitest";

describe("health routes", () => {
  it("reports liveness and readiness without exposing configuration", async () => {
    const { buildApp } = await import("../app.js");
    const app = buildApp({
      authService: {
        register: async () => ({ userId: "u1", verificationSent: true }),
        verifyEmail: async () => ({ userId: "u1", trialCreditsGranted: true }),
        login: async () => ({ sessionToken: "token", user: {} }),
        authenticate: async () => ({}),
        logout: async () => undefined
      }
    });
    await app.ready();

    const live = await app.inject({ method: "GET", url: "/healthz" });
    const ready = await app.inject({ method: "GET", url: "/readyz" });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok", service: "api" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ready", dependencies: { database: "ok", redis: "ok", storage: "ok" } });
    expect(ready.body).not.toContain("GROQ_API_KEY");
    await app.close();
  });
});
