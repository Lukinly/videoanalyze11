import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "@videoanalyze/domain";
import { InvalidProviderOutputError, requestWithRetry } from "./provider-request.js";

describe("structured provider retries", () => {
  it("backs off temporary errors and returns only the successful result", async () => {
    const request = vi.fn().mockRejectedValueOnce(new ProviderError("rate_limited", "busy", { retryAfterMs: 7000 }))
      .mockRejectedValueOnce(new ProviderError("server_error", "unavailable")).mockResolvedValue("ok");
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(requestWithRetry(request, { wait })).resolves.toBe("ok");
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([7000, 2000]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each(["unauthorized", "invalid_request", "unsupported_file"] as const)("never retries permanent %s errors", async (code) => {
    const error = new ProviderError(code, "rejected");
    const request = vi.fn().mockRejectedValue(error);
    await expect(requestWithRetry(request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("repairs malformed model output once without retrying forever", async () => {
    const request = vi.fn().mockRejectedValue(new InvalidProviderOutputError("invalid JSON"));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(requestWithRetry(request, { wait })).rejects.toMatchObject({ code: "invalid_request" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stops before another request when cancellation occurs in backoff", async () => {
    const controller = new AbortController();
    const request = vi.fn().mockRejectedValue(new ProviderError("network_error", "disconnected"));
    const wait = vi.fn(async () => { controller.abort(); });
    await expect(requestWithRetry(request, { wait, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
