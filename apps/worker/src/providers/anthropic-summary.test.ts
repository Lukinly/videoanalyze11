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

  it("generates structured AI notes through the same messages endpoint", async () => {
    const { createAnthropicSummaryProvider } = await import("./anthropic-summary.js");
    const notes = {
      title: "测试笔记",
      topic: "主题",
      coreIdeas: ["核心观点"],
      sections: [{ id: "section-1", level: 1, title: "第一节", body: "内容", citations: [{ segmentId: "seg_1", timestampSeconds: 0 }] }],
      reviewPoints: ["复习要点"]
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(notes) }] }), { status: 200 }));
    const provider = createAnthropicSummaryProvider({ apiKey: "test-key", baseUrl: "https://api.deepseek.com/anthropic", model: "m", fetchImpl });

    await expect(provider.generateNotes({ videoDuration: 20, segments: [{ id: "seg_1", runId: "r", start: 0, end: 20, text: "t" }] })).resolves.toEqual(notes);
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.system).toContain("study notes");
  });

  it("retries one malformed notes response before failing the analysis", async () => {
    const { createAnthropicSummaryProvider } = await import("./anthropic-summary.js");
    const notes = { title: "笔记", topic: "主题", coreIdeas: ["观点"], sections: [{ id: "s", level: 1, title: "节", body: "内容", citations: [{ segmentId: "seg_1", timestampSeconds: 0 }] }], reviewPoints: ["复习"] };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(notes) }] }), { status: 200 }));
    const provider = createAnthropicSummaryProvider({ apiKey: "test-key", baseUrl: "https://api.deepseek.com/anthropic", model: "m", fetchImpl });

    await expect(provider.generateNotes({ videoDuration: 1, segments: [{ id: "seg_1", runId: "r", start: 0, end: 1, text: "t" }] })).resolves.toEqual(notes);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
