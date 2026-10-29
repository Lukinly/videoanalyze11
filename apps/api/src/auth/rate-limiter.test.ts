import { describe, expect, it, vi } from "vitest";
import { createAuthRateLimiter } from "./rate-limiter.js";

describe("distributed auth budgets", () => {
  it("hashes identities and rejects shared Redis limits before delivery", async () => {
    const evaluate = vi.fn().mockResolvedValue(5000);
    const limit = createAuthRateLimiter(evaluate, () => 10_000);
    await expect(limit([{ scope: "recipient", identity: "user@example.com", windowMs: 60_000, limit: 2 }])).rejects.toMatchObject({ code: "AUTH_RATE_LIMITED", status: 429 });
    expect(evaluate.mock.calls[0][1][0]).not.toContain("user@example.com");
    expect(evaluate.mock.calls[0][2]).toEqual(["2", "50000"]);
  });
  it("fails closed and does not disclose a Redis response", async () => {
    const limit = createAuthRateLimiter(async () => { throw new Error("sensitive Redis response"); });
    await expect(limit([{ scope: "ip", identity: "127.0.0.1", windowMs: 60_000, limit: 2 }])).rejects.toMatchObject({ code: "MAIL_UNAVAILABLE", status: 503, message: "验证服务暂时不可用，请稍后重试" });
  });
});
