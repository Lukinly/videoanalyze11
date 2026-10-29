import { describe, expect, it, vi } from "vitest";
import { createOpenAiSummaryProvider } from "./openai-summary.js";
import { createSummaryProvider, resolveSummaryProtocol } from "./summary-provider.js";

const transcript = { videoDuration: 20, segments: [{ id: "seg_1", runId: "run", start: 3, end: 20, text: "Transcript" }] };
const summary = { oneLineSummary: "Summary", overallSummary: "Overall", chapters: [] };
const notes = { title: "Notes", topic: "Topic", coreIdeas: ["Idea"], sections: [{ id: "s1", level: 1, title: "Section", body: "Body", citations: [{ segmentId: "seg_1", timestampSeconds: "00:03" }] }], reviewPoints: ["Review"] };
const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });

describe("OpenAI-compatible summary and notes", () => {
  it("routes DashScope to Chat Completions with Bearer auth and JSON output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(summary));
    const provider = createSummaryProvider({ baseUrl: "https://example.test/compatible-mode/v1/", apiKey: "test-key", model: "qwen-test", fetchImpl });
    expect(await provider.summarize(transcript)).toEqual(summary);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://example.test/compatible-mode/v1/chat/completions");
    expect(init.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toMatchObject({ response_format: { type: "json_object" }, enable_thinking: false, messages: [{ role: "system" }, { role: "user" }] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts a complete endpoint without duplicating its path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(summary));
    await createOpenAiSummaryProvider({ baseUrl: "https://example.test/v1/chat/completions", apiKey: "test", model: "model", fetchImpl }).summarize(transcript);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.test/v1/chat/completions");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty("enable_thinking");
  });

  it("generates notes while leaving trusted citation timestamps to the runner", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(notes));
    const result = await createOpenAiSummaryProvider({ baseUrl: "https://example.test/v1", apiKey: "test", model: "model", fetchImpl }).generateNotes(transcript);
    expect(result.sections[0].citations).toEqual([{ segmentId: "seg_1", timestampSeconds: 0 }]);
  });

  it("retries malformed notes once", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(notes));
    await createOpenAiSummaryProvider({ baseUrl: "https://example.test/v1", apiKey: "test", model: "model", fetchImpl }).generateNotes(transcript);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("preserves authentication errors without retrying notes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(createOpenAiSummaryProvider({ baseUrl: "https://example.test/v1", apiKey: "test", model: "model", fetchImpl }).generateNotes(transcript)).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid structured output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}));
    await expect(createOpenAiSummaryProvider({ baseUrl: "https://example.test/v1", apiKey: "test", model: "model", fetchImpl }).summarize(transcript)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("keeps Anthropic as the backward-compatible default and permits explicit overrides", () => {
    expect(resolveSummaryProtocol("https://example.test/anthropic")).toBe("anthropic");
    expect(resolveSummaryProtocol("https://example.test/v1", "openai")).toBe("openai");
    expect(resolveSummaryProtocol("https://example.test/compatible-mode/v1", "anthropic")).toBe("anthropic");
    expect(() => resolveSummaryProtocol("https://example.test", "invalid")).toThrow("LLM_API_PROTOCOL");
  });
});
