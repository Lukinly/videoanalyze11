import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const fixtureDirectory = join(tmpdir(), "videoanalyze-groq-tests");
const audioPath = join(fixtureDirectory, "chunk.flac");
await mkdir(fixtureDirectory, { recursive: true });
await writeFile(audioPath, "fake audio");

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

describe("Groq adapters", () => {
  it("maps ASR timestamp and optional context parameters", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ segments: [{ start: 1, end: 2, text: "hello" }] }), { status: 200 }));
    const provider = createGroqAsrProvider({ apiKey: "test-key", fetchImpl, model: "whisper-large-v3-turbo" });

    const result = await provider.transcribeChunk({ audioFile: audioPath, language: null, timestampLevel: "segment", prompt: "previous tail" });
    const body = fetchImpl.mock.calls[0][1].body as FormData;

    expect(result.segments).toEqual([{ start: 1, end: 2, text: "hello" }]);
    expect(body.get("response_format")).toBe("verbose_json");
    expect(body.getAll("timestamp_granularities[]")).toEqual(["segment"]);
    expect(body.get("prompt")).toBe("previous tail");
    expect(body.get("language")).toBeNull();
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer test-key" });
  }, 30_000);

  it("honors Retry-After for ASR rate limits", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    const fetchImpl = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429, headers: { "retry-after": "4" } }));
    const provider = createGroqAsrProvider({ apiKey: "test-key", fetchImpl, model: "whisper-large-v3-turbo" });

    await expect(provider.transcribeChunk({ audioFile: audioPath, language: "zh", timestampLevel: "segment" }))
      .rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 4000 });
  });

  it("validates structured summary output and rejects malformed JSON", async () => {
    const { createGroqSummaryProvider } = await import("./groq-summary.js");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }));
    const provider = createGroqSummaryProvider({ apiKey: "test-key", fetchImpl, model: "summary-model" });

    await expect(provider.summarize({
      videoDuration: 20,
      segments: [{ id: "seg_1", runId: "run_1", start: 0, end: 20, text: "transcript" }]
    })).rejects.toMatchObject({ code: "invalid_request" });
  });
});
