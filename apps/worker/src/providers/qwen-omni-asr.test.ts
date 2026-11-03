import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createQwenOmniAsrProvider, QWEN_ASR_MAX_BYTES } from "./qwen-omni-asr.js";

const transcript = { segments: [{ start: 0.2, end: 1.5, text: "你好，世界😀" }] };
function events(payload: unknown, options: { finish?: string; done?: boolean; oneByte?: boolean } = {}) {
  const content = JSON.stringify(payload);
  const body = [
    { choices: [{ delta: { reasoning_content: "must never enter the transcript" } }] },
    { choices: [{ delta: { content: content.slice(0, 10) } }] },
    { choices: [{ delta: { content: content.slice(10) } }] },
    { choices: [{ delta: {}, finish_reason: options.finish ?? "stop" }] },
    { choices: [], usage: { completion_tokens: 40 } }
  ].map((value) => `data: ${JSON.stringify(value)}\r\n\r\n`).join("") + (options.done === false ? "" : "data: [DONE]\n\n");
  const bytes = new TextEncoder().encode(body);
  return new Response(new ReadableStream({ start(controller) {
    if (options.oneByte) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
async function withAudio(check: (audioFile: string) => Promise<void>, size = 32044) {
  const directory = await mkdtemp(join(tmpdir(), "qwen-asr-"));
  try {
    const file = join(directory, "chunk.wav");
    const wav = Buffer.alloc(size); wav.write("RIFF"); wav.write("WAVE", 8);
    await writeFile(file, wav);
    await check(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

describe("Qwen Omni audio transcription", () => {
  it("sends inline WAV using the shared key and parses fragmented streaming JSON without reasoning or usage text", async () => {
    await withAudio(async (audioFile) => {
      const fetchImpl = vi.fn().mockResolvedValue(events(transcript, { oneByte: true }));
      const provider = createQwenOmniAsrProvider({ apiKey: "shared-llm-key", fetchImpl });
      await expect(provider.transcribeChunk({ audioFile, durationSeconds: 2, language: null, timestampLevel: "segment" })).resolves.toEqual(transcript);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1/chat/completions");
      expect(init.headers.Authorization).toBe("Bearer shared-llm-key");
      expect(init.redirect).toBe("error");
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({ model: "qwen3.8-omni-flash", modalities: ["text"], stream: true, enable_thinking: false, response_format: { type: "json_object" }, stream_options: { include_usage: true } });
      expect(body).not.toHaveProperty("audio");
      expect(body.messages[0].content[1]).toMatchObject({ type: "input_audio", input_audio: { format: "wav", data: expect.stringMatching(/^data:audio\/wav;base64,/) } });
    });
  });
  it.each([
    { segments: [{ start: -1, end: 1, text: "bad" }] },
    { segments: [{ start: 0, end: 3, text: "beyond chunk" }] },
    { segments: [{ start: 1, end: 1, text: "empty range" }] },
    { segments: [{ start: 1, end: 2, text: "later" }, { start: 0, end: 1, text: "earlier" }] },
    { segments: [{ start: "0", end: 1, text: "wrong type" }] },
    { text: "missing timestamps" }
  ])("rejects invalid timestamps instead of inventing timing: %j", async (payload) => {
    await withAudio(async (audioFile) => {
      const provider = createQwenOmniAsrProvider({ apiKey: "key", fetchImpl: vi.fn().mockResolvedValue(events(payload)) });
      await expect(provider.transcribeChunk({ audioFile, durationSeconds: 2, language: null, timestampLevel: "segment" })).rejects.toMatchObject({ code: "invalid_request" });
    });
  });
  it.each([{ options: { finish: "length" }, code: "invalid_request" }, { options: { done: false }, code: "network_error" }])("rejects truncated streams: %j", async ({ options, code }) => {
    await withAudio(async (audioFile) => {
      const provider = createQwenOmniAsrProvider({ apiKey: "key", fetchImpl: vi.fn().mockResolvedValue(events(transcript, options)) });
      await expect(provider.transcribeChunk({ audioFile, durationSeconds: 2, language: null, timestampLevel: "segment" })).rejects.toMatchObject({ code });
    });
  });
  it("accepts silence as an empty transcript without fabricating words", async () => {
    await withAudio(async (audioFile) => {
      const provider = createQwenOmniAsrProvider({ apiKey: "key", fetchImpl: vi.fn().mockResolvedValue(events({ segments: [] })) });
      await expect(provider.transcribeChunk({ audioFile, durationSeconds: 2, language: null, timestampLevel: "segment" })).resolves.toEqual({ segments: [] });
    });
  });
  it("does not send an oversized audio chunk", async () => {
    await withAudio(async (audioFile) => {
      const fetchImpl = vi.fn();
      await expect(createQwenOmniAsrProvider({ apiKey: "key", fetchImpl }).transcribeChunk({ audioFile, durationSeconds: 120, language: null, timestampLevel: "segment" })).rejects.toMatchObject({ code: "unsupported_file" });
      expect(fetchImpl).not.toHaveBeenCalled();
    }, QWEN_ASR_MAX_BYTES + 1);
  });
  it("keeps credentials and provider-echoed audio out of persisted failures", async () => {
    await withAudio(async (audioFile) => {
      const provider = createQwenOmniAsrProvider({ apiKey: "secret-sentinel", fetchImpl: vi.fn().mockResolvedValue(new Response("secret-sentinel audio-base64-sentinel", { status: 403 })) });
      const error = await provider.transcribeChunk({ audioFile, durationSeconds: 2, language: null, timestampLevel: "segment" }).catch((error: Error) => error);
      expect(error).toMatchObject({ code: "unauthorized", message: "provider request failed with status 403: Qwen ASR request rejected" });
      expect(JSON.stringify(error)).not.toMatch(/secret-sentinel|audio-base64-sentinel/);
    });
  });
  it("cancels in-flight HTTP requests and preserves cancellation", async () => {
    await withAudio(async (audioFile) => {
      const controller = new AbortController();
      const fetchImpl = vi.fn(async (_url, init) => { controller.abort(new Error("cancelled")); throw init.signal.reason; });
      await expect(createQwenOmniAsrProvider({ apiKey: "key", fetchImpl }).transcribeChunk({ audioFile, durationSeconds: 2, signal: controller.signal, language: null, timestampLevel: "segment" })).rejects.toThrow("cancelled");
    });
  });

  it.each([
    ["InternalError", "server_error"], ["Throttling.RateQuota", "rate_limited"],
    ["DataInspectionFailed", "invalid_request"], ["Throttling.AllocationQuota", "invalid_request"],
    ["InvalidApiKey", "unauthorized"], ["unknown-secret-sentinel", "invalid_request"]
  ])("classifies streaming %s without storing upstream messages", async (code, kind) => {
    await withAudio(async (audioFile) => {
      const id = "761fcd5e-071f-4ef0-8564-fbc7855a7650";
      const body = `data: ${JSON.stringify({ error: { code, message: "secret-sentinel audio-base64-sentinel" }, request_id: id })}\n\n`;
      const provider = createQwenOmniAsrProvider({ apiKey: "secret-sentinel", fetchImpl: vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } })) });
      const error = await provider.transcribeChunk({ audioFile, durationSeconds: 2, language: null, timestampLevel: "segment" }).catch((error: Error) => error);
      expect(error).toMatchObject({ code: kind, message: expect.stringContaining(`request_id=${id}`) });
      expect((error as Error).message).toContain(`code=${code === "unknown-secret-sentinel" ? "unrecognized" : code}`);
      expect(JSON.stringify(error)).not.toMatch(/secret-sentinel|audio-base64-sentinel/);
    });
  });

  it("bounds Retry-After and recognizes nonretryable exhausted quota even with HTTP 429", async () => {
    await withAudio(async (audioFile) => {
      const provider = createQwenOmniAsrProvider({ apiKey: "key", fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "secret-sentinel" } }), { status: 429, headers: { "retry-after": "999999", "x-request-id": "secret-sentinel" } })) });
      const error = await provider.transcribeChunk({ audioFile, durationSeconds: 2, language: null, timestampLevel: "segment" }).catch((error: Error) => error);
      expect(error).toMatchObject({ code: "invalid_request", retryAfterMs: 30_000 });
      expect((error as Error).message).not.toContain("secret-sentinel");
    });
  });

  it("recognizes named SSE error frames with a top-level code", async () => {
    await withAudio(async (audioFile) => {
      const body = 'event: error\ndata: {"code":"ServiceUnavailable","message":"secret-sentinel"}\n\n';
      const provider = createQwenOmniAsrProvider({ apiKey: "key", fetchImpl: vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } })) });
      await expect(provider.transcribeChunk({ audioFile, durationSeconds: 2, language: null, timestampLevel: "segment" })).rejects.toMatchObject({ code: "server_error", providerCode: "ServiceUnavailable", message: "Qwen ASR streaming error (code=ServiceUnavailable)" });
    });
  });

  it("classifies a broken streaming transport as retryable", async () => {
    await withAudio(async (audioFile) => {
      const body = new ReadableStream({ start(controller) { controller.error(new TypeError("secret-sentinel")); } });
      const provider = createQwenOmniAsrProvider({ apiKey: "key", fetchImpl: vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } })) });
      await expect(provider.transcribeChunk({ audioFile, durationSeconds: 2, language: null, timestampLevel: "segment" })).rejects.toMatchObject({ code: "network_error", message: "Qwen ASR response connection was interrupted" });
    });
  });

  it("bounds error body reads and does not persist oversized provider echoes", async () => {
    await withAudio(async (audioFile) => {
      const provider = createQwenOmniAsrProvider({ apiKey: "key", fetchImpl: vi.fn().mockResolvedValue(new Response("secret-sentinel".repeat(2000), { status: 503 })) });
      await expect(provider.transcribeChunk({ audioFile, durationSeconds: 2, language: null, timestampLevel: "segment" })).rejects.toMatchObject({ code: "server_error", message: "provider request failed with status 503: Qwen ASR request rejected" });
    });
  });
});
