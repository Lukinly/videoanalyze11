import { describe, expect, it, vi } from "vitest";

describe("anthropic-compatible summary provider", () => {
  it("posts to {baseUrl}/v1/messages and parses the first text block", async () => {
    const { createAnthropicSummaryProvider } = await import("./anthropic-summary.js");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [
        { type: "thinking", thinking: "reasoning…" },
        { type: "text", text: JSON.stringify({ oneLineSummary: "一句话", overallSummary: "整体", chapters: [] }) }
      ]
    }), { status: 200 }));

    const provider = createAnthropicSummaryProvider({ apiKey: "test-key", baseUrl: "https://api.deepseek.com/anthropic/", model: "deepseek-v4-flash", fetchImpl });
    const result = await provider.summarize({
      videoDuration: 20,
      segments: [{ id: "seg_1", runId: "run_1", start: 0, end: 20, text: "transcript" }]
    });

    expect(result).toMatchObject({ oneLineSummary: "一句话", overallSummary: "整体" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect((init as RequestInit).headers).toMatchObject({ "x-api-key": "test-key" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages[0].content[0].type).toBe("text");
  });

  it("authenticates with x-api-key, never Authorization", async () => {
    const { createAnthropicSummaryProvider } = await import("./anthropic-summary.js");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), { status: 200 }));
    const provider = createAnthropicSummaryProvider({ apiKey: "test-key", baseUrl: "https://api.deepseek.com/anthropic", model: "m", fetchImpl });

    await expect(provider.summarize({ videoDuration: 1, segments: [] })).rejects.toMatchObject({ code: "invalid_request" });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ "x-api-key": "test-key" });
    expect(JSON.stringify(init.headers)).not.toContain("Authorization");
  });

  it("rejects malformed JSON with invalid_request", async () => {
    const { createAnthropicSummaryProvider } = await import("./anthropic-summary.js");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: "not json" }] }), { status: 200 }));
    const provider = createAnthropicSummaryProvider({ apiKey: "test-key", baseUrl: "https://api.deepseek.com/anthropic", model: "m", fetchImpl });

    await expect(provider.summarize({ videoDuration: 20, segments: [{ id: "s", runId: "r", start: 0, end: 20, text: "t" }] })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("maps provider status codes through providerErrorFromResponse", async () => {
    const { createAnthropicSummaryProvider } = await import("./anthropic-summary.js");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { type: "authentication_error" } }), { status: 401 }));
    const provider = createAnthropicSummaryProvider({ apiKey: "test-key", baseUrl: "https://api.deepseek.com/anthropic", model: "m", fetchImpl });

    await expect(provider.summarize({ videoDuration: 1, segments: [] })).rejects.toMatchObject({ code: "unauthorized" });
  });
});
