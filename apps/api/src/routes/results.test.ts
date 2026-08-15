import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

describe("result routes", () => {
  const authService = { sendRegistrationCode: vi.fn(), register: vi.fn(), verifyEmail: vi.fn(), login: vi.fn(), logout: vi.fn(), authenticate: vi.fn().mockResolvedValue({ id: "u1" }) };
  const resultService = {
    assertAvailable: vi.fn(),
    list: vi.fn().mockResolvedValue({ items: [{ id: "r1", resultAvailability: "available" }] }),
    get: vi.fn().mockResolvedValue({ id: "r1", resultAvailability: "available" }),
    delete: vi.fn().mockResolvedValue(undefined)
  };
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../app.js"); app = buildApp({ authService, resultService }); await app.ready(); });
  afterAll(() => app.close());

  it("requires ownership context and exposes history, detail, and permanent deletion", async () => {
    expect((await app.inject({ method: "GET", url: "/api/analysis-runs" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/analysis-runs?limit=25", headers: { cookie: "video_session=s" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/analysis-runs/r1", headers: { cookie: "video_session=s" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/api/analysis-runs/r1/results", headers: { cookie: "video_session=s" } })).statusCode).toBe(204);
    expect(resultService.list).toHaveBeenCalledWith({ userId: "u1", limit: 25 });
    expect(resultService.get).toHaveBeenCalledWith({ userId: "u1", runId: "r1" });
    expect(resultService.delete).toHaveBeenCalledWith({ userId: "u1", runId: "r1" });
  });
});
