import { describe, expect, it } from "vitest";

describe("provider errors", () => {
  it("classifies rate limits as retryable and requests lower concurrency", async () => {
    const { ProviderError, classifyProviderFailure, getRetryDecision } = await import("./provider.js");
    const error = new ProviderError("rate_limited", "try again", { retryAfterMs: 1_000 });
    const failure = classifyProviderFailure(error);

    expect(failure).toMatchObject({ kind: "rate_limited", retryAfterMs: 1_000 });
    expect(getRetryDecision(failure, 1)).toEqual({
      retry: true,
      delayMs: 1_000,
      reduceConcurrency: true
    });
  });

  it("does not retry authentication failures", async () => {
    const { ProviderError, classifyProviderFailure, getRetryDecision } = await import("./provider.js");
    const failure = classifyProviderFailure(new ProviderError("unauthorized", "invalid key"));

    expect(getRetryDecision(failure, 1)).toEqual({
      retry: false,
      delayMs: 0,
      reduceConcurrency: false
    });
  });
});
