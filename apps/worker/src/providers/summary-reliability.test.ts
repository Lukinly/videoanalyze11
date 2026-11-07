import { describe, expect, it, vi } from "vitest";
import { createOpenAiSummaryProvider } from "./openai-summary.js";
import { createAnthropicSummaryProvider } from "./anthropic-summary.js";

const transcript = { videoDuration: 20, segments: [{ id: "seg_1", runId: "run", start: 0, end: 20, text: "speech" }] };
const notes = { title: "Notes", topic: "Topic", coreIdeas: ["Idea"], sections: [{ id: "s1", level: 1, title: "Section", body: "Body", citations: [{ segmentId: "seg_1", timestampSeconds: 0 }] }], reviewPoints: ["Review"] };

describe.each([
  { name: "openai", create: createOpenAiSummaryProvider, response: () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(notes) } }] })) },
  { name: "anthropic", create: createAnthropicSummaryProvider, response: () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(notes) }] })) }
])("$name transport reliability", ({ create, response }) => {
  it("recovers notes after rate limits and server errors with bounded backoff", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 429 })).mockResolvedValueOnce(new Response("unavailable", { status: 503 })).mockResolvedValueOnce(response());
    const waitForRetry = vi.fn().mockResolvedValue(undefined);
    const provider = create({ apiKey: "secret", baseUrl: "https://example.test", model: "model", fetchImpl, waitForRetry });
    await expect(provider.generateNotes(transcript)).resolves.toEqual(notes);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waitForRetry.mock.calls.map(([ms]) => ms)).toEqual([5000, 2000]);
  });

  it.each([400, 401, 403])("does not retry HTTP %s or expose its response body", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("secret-sentinel transcript payload", { status }));
    const provider = create({ apiKey: "secret", baseUrl: "https://example.test", model: "model", fetchImpl });
    const error = await provider.generateNotes(transcript).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("secret-sentinel");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the deadline active while the response body stalls", async () => {
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => new Response(new ReadableStream({ start(controller) {
      init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
    } })));
    const provider = create({ apiKey: "secret", baseUrl: "https://example.test", model: "model", fetchImpl, requestTimeoutMs: 10, waitForRetry: vi.fn().mockResolvedValue(undefined) });
    await expect(provider.generateNotes(transcript)).rejects.toMatchObject({ code: "network_error" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not start a request when the analysis is already cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    const fetchImpl = vi.fn();
    const provider = create({ apiKey: "secret", baseUrl: "https://example.test", model: "model", fetchImpl });
    await expect(provider.generateNotes({ ...transcript, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
