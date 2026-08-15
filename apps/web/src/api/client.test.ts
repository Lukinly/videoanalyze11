import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";

describe("analysis API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the selected retention mode when starting analysis", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ id: "r1" }) });
    vi.stubGlobal("fetch", fetch);
    await api.startAnalysis("v1", "privacy");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/videos/v1/analysis-runs"), expect.objectContaining({ body: JSON.stringify({ retentionMode: "privacy" }) }));
  });
});
