import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtureDirectory = join(tmpdir(), "videoanalyze-groq-tests");
const audioPath = join(fixtureDirectory, "chunk.flac");
const specialAudioPath = join(fixtureDirectory, 'chunk,semi;quote"slash\\name.flac');
await mkdir(fixtureDirectory, { recursive: true });
await writeFile(audioPath, "fake audio");
await writeFile(specialAudioPath, "special fake audio");

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unexpected real fetch boundary")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Groq adapters", () => {
  it("uses curl for default ASR requests with exact required multipart fields and protected temporary authorization", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    const apiKey = "unit-test-super-secret";
    let authorizationHeaderPath = "";
    let responseHeaderPath = "";
    let invocationArguments: readonly string[] = [];
    const curlRunner = vi.fn(async (args: readonly string[]) => {
      invocationArguments = args;
      const authorizationHeaderArgument = args[args.indexOf("--header") + 1];
      authorizationHeaderPath = authorizationHeaderArgument.slice(1);
      responseHeaderPath = args[args.indexOf("--dump-header") + 1];

      expect(args.join("\0")).not.toContain(apiKey);
      expect(authorizationHeaderArgument).toMatch(/^@/);
      expect((await stat(authorizationHeaderPath)).mode & 0o777).toBe(0o600);
      expect(await readFile(authorizationHeaderPath, "utf8")).toBe(`Authorization: Bearer ${apiKey}\n`);

      await writeFile(responseHeaderPath, "HTTP/2 200\r\ncontent-type: application/json\r\n\r\n");
      return {
        exitCode: 0,
        stdout: JSON.stringify({ segments: [{ start: 1, end: 2, text: "hello" }] }),
        stderr: "",
      };
    });
    const unexpectedFetch = vi.fn().mockRejectedValue(new Error("default fetch transport was used"));
    vi.stubGlobal("fetch", unexpectedFetch);

    try {
      const providerOptions = { apiKey, curlRunner, model: "whisper-large-v3-turbo" };
      const provider = createGroqAsrProvider(providerOptions);
      const result = await provider.transcribeChunk({ audioFile: audioPath, language: null, timestampLevel: "segment" });

      expect(result.segments).toEqual([{ start: 1, end: 2, text: "hello" }]);
      expect(unexpectedFetch).not.toHaveBeenCalled();
      expect(invocationArguments.slice(0, 6)).toEqual([
        "--silent",
        "--show-error",
        "--connect-timeout",
        "15",
        "--max-time",
        "600",
      ]);
      expect(valuesAfter(invocationArguments, "--form")).toEqual([`file=@"${audioPath}";type=audio/flac`]);
      expect(valuesAfter(invocationArguments, "--form-string")).toEqual([
        "model=whisper-large-v3-turbo",
        "response_format=verbose_json",
        "timestamp_granularities[]=segment",
      ]);
      expect(invocationArguments.at(-1)).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
      await expect(stat(authorizationHeaderPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(responseHeaderPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("adds optional ASR language and prompt as curl form strings", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    let invocationArguments: readonly string[] = [];
    const curlRunner = vi.fn(async (args: readonly string[]) => {
      invocationArguments = args;
      await writeFile(args[args.indexOf("--dump-header") + 1], "HTTP/1.1 200 OK\r\n\r\n");
      return { exitCode: 0, stdout: JSON.stringify({ segments: [] }), stderr: "" };
    });
    const providerOptions = { apiKey: "optional-fields-key", curlRunner, model: "whisper-large-v3-turbo" };
    const provider = createGroqAsrProvider(providerOptions);

    await provider.transcribeChunk({ audioFile: audioPath, language: "zh", timestampLevel: "segment", prompt: "previous tail" });

    expect(valuesAfter(invocationArguments, "--form-string")).toEqual([
      "model=whisper-large-v3-turbo",
      "response_format=verbose_json",
      "timestamp_granularities[]=segment",
      "language=zh",
      "prompt=previous tail",
    ]);
  });

  it("passes curl form-string edge values literally", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    let invocationArguments: readonly string[] = [];
    const curlRunner = vi.fn(async (args: readonly string[]) => {
      invocationArguments = args;
      await writeFile(args[args.indexOf("--dump-header") + 1], "HTTP/1.1 200 OK\r\n\r\n");
      return { exitCode: 0, stdout: JSON.stringify({ segments: [] }), stderr: "" };
    });
    const providerOptions = { apiKey: "form-string-key", curlRunner, model: "@model;literal" };
    const provider = createGroqAsrProvider(providerOptions);

    await provider.transcribeChunk({
      audioFile: audioPath,
      language: "<language;literal",
      timestampLevel: "segment",
      prompt: "/prompt;literal@<",
    });

    expect(valuesAfter(invocationArguments, "--form-string")).toEqual([
      "model=@model;literal",
      "response_format=verbose_json",
      "timestamp_granularities[]=segment",
      "language=<language;literal",
      "prompt=/prompt;literal@<",
    ]);
  });

  it("quotes curl form file paths without changing special characters", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    let invocationArguments: readonly string[] = [];
    const curlRunner = vi.fn(async (args: readonly string[]) => {
      invocationArguments = args;
      await writeFile(args[args.indexOf("--dump-header") + 1], "HTTP/1.1 200 OK\r\n\r\n");
      return { exitCode: 0, stdout: JSON.stringify({ segments: [] }), stderr: "" };
    });
    const providerOptions = { apiKey: "special-path-key", curlRunner, model: "whisper-large-v3-turbo" };
    const provider = createGroqAsrProvider(providerOptions);

    await provider.transcribeChunk({ audioFile: specialAudioPath, language: null, timestampLevel: "segment" });

    expect(valuesAfter(invocationArguments, "--form")).toEqual([
      `file=@"${fixtureDirectory}/chunk,semi;quote\\"slash\\\\name.flac";type=audio/flac`,
    ]);
  });

  it("honors Retry-After from curl ASR responses", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    const apiKey = "rate-limit-key";
    const signedData = "https://storage.invalid/file?X-Amz-Signature=signed-value";
    const curlRunner = vi.fn(async (args: readonly string[]) => {
      await writeFile(args[args.indexOf("--dump-header") + 1], "HTTP/2 429\r\nRetry-After: 4\r\n\r\n");
      return { exitCode: 0, stdout: `rate limited ${apiKey} ${signedData}`, stderr: "" };
    });
    const providerOptions = { apiKey, curlRunner, model: "whisper-large-v3-turbo" };
    const provider = createGroqAsrProvider(providerOptions);

    const failure = await provider.transcribeChunk({ audioFile: audioPath, language: null, timestampLevel: "segment" })
      .then(() => null, (error: unknown) => error as Error & { code?: string; retryAfterMs?: number });

    expect(failure).toMatchObject({ code: "rate_limited", retryAfterMs: 4000 });
    expect(failure?.message).not.toContain(apiKey);
    expect(failure?.message).not.toContain("X-Amz-Signature");
  });

  it("selects status and Retry-After from the final response after proxy and interim headers", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    const curlRunner = vi.fn(async (args: readonly string[]) => {
      await writeFile(args[args.indexOf("--dump-header") + 1], [
        "HTTP/1.1 200 Connection established",
        "Retry-After: 99",
        "",
        "HTTP/1.1 100 Continue",
        "Retry-After: 88",
        "",
        "HTTP/2 429",
        "Retry-After: 6",
        "",
        "",
      ].join("\r\n"));
      return { exitCode: 0, stdout: "rate limited", stderr: "" };
    });
    const providerOptions = { apiKey: "final-headers-key", curlRunner, model: "whisper-large-v3-turbo" };
    const provider = createGroqAsrProvider(providerOptions);

    await expect(provider.transcribeChunk({ audioFile: audioPath, language: null, timestampLevel: "segment" }))
      .rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 6000 });
  });

  it("rejects oversized aggregate curl response headers as a sanitized network error", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    const curlRunner = vi.fn(async (args: readonly string[]) => {
      const oversizedHeaders = `HTTP/1.1 200 OK\r\nX-Fill: ${"x".repeat(70 * 1024)}\r\n\r\n`;
      await writeFile(args[args.indexOf("--dump-header") + 1], oversizedHeaders);
      return { exitCode: 0, stdout: JSON.stringify({ segments: [] }), stderr: "" };
    });
    const providerOptions = { apiKey: "oversized-headers-key", curlRunner, model: "whisper-large-v3-turbo" };
    const provider = createGroqAsrProvider(providerOptions);

    const failure = await provider.transcribeChunk({ audioFile: audioPath, language: null, timestampLevel: "segment" })
      .then(() => null, (error: unknown) => error as Error & { code?: string });

    expect(failure).toMatchObject({ code: "network_error" });
    expect(failure?.message).toContain("HEADERS_TOO_LARGE");
    expect(failure?.message).not.toContain("X-Fill");
    expect(failure?.message.length).toBeLessThanOrEqual(160);
  });

  it("classifies curl process failures as sanitized network errors and cleans temporary files", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    const apiKey = "network-failure-secret";
    const signedData = "https://storage.invalid/file?X-Amz-Signature=signed-value";
    let authorizationHeaderPath = "";
    let responseHeaderPath = "";
    const curlRunner = vi.fn(async (args: readonly string[]) => {
      authorizationHeaderPath = args[args.indexOf("--header") + 1].slice(1);
      responseHeaderPath = args[args.indexOf("--dump-header") + 1];
      return { exitCode: 28, stdout: "", stderr: `timeout ${apiKey} ${signedData}` };
    });
    const providerOptions = { apiKey, curlRunner, model: "whisper-large-v3-turbo" };
    const provider = createGroqAsrProvider(providerOptions);

    const failure = await provider.transcribeChunk({ audioFile: audioPath, language: null, timestampLevel: "segment" })
      .then(() => null, (error: unknown) => error as Error & { code?: string });

    expect(failure).toMatchObject({ code: "network_error" });
    expect(failure?.message).toContain("28");
    expect(failure?.message).not.toContain(apiKey);
    expect(failure?.message).not.toContain("X-Amz-Signature");
    expect(failure?.message.length).toBeLessThanOrEqual(160);
    await expect(stat(authorizationHeaderPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(responseHeaderPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects multiline API keys before creating a curl invocation", async () => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    const apiKey = "first-line\nInjected-Header: secret";
    const curlRunner = vi.fn();
    const providerOptions = { apiKey, curlRunner, model: "whisper-large-v3-turbo" };
    const provider = createGroqAsrProvider(providerOptions);

    const failure = await provider.transcribeChunk({ audioFile: audioPath, language: null, timestampLevel: "segment" })
      .then(() => null, (error: unknown) => error as Error & { code?: string });

    expect(failure).toMatchObject({ code: "unauthorized" });
    expect(failure?.message).not.toContain("first-line");
    expect(failure?.message).not.toContain("Injected-Header");
    expect(curlRunner).not.toHaveBeenCalled();
  });

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

  it.each([
    ["curl", "malformed JSON", "{not-json sensitive-marker"],
    ["curl", "a null payload", "null"],
    ["curl", "a null segment", JSON.stringify({ segments: [null] })],
    ["curl", "a primitive segment", JSON.stringify({ segments: [7] })],
    ["fetch", "malformed JSON", "{not-json sensitive-marker"],
    ["fetch", "a null payload", "null"],
    ["fetch", "a null segment", JSON.stringify({ segments: [null] })],
    ["fetch", "a primitive segment", JSON.stringify({ segments: [7] })],
  ])("normalizes %s ASR success responses containing %s", async (transport, _caseName, responseBody) => {
    const { createGroqAsrProvider } = await import("./groq-asr.js");
    const apiKey = "invalid-success-key";
    const model = "whisper-large-v3-turbo";
    const provider = transport === "curl"
      ? createGroqAsrProvider({
          apiKey,
          model,
          curlRunner: async (args) => {
            await writeFile(args[args.indexOf("--dump-header") + 1], "HTTP/1.1 200 OK\r\n\r\n");
            return { exitCode: 0, stdout: responseBody, stderr: "" };
          },
        })
      : createGroqAsrProvider({
          apiKey,
          model,
          fetchImpl: vi.fn().mockResolvedValue(new Response(responseBody, { status: 200 })),
        });

    const failure = await provider.transcribeChunk({ audioFile: audioPath, language: null, timestampLevel: "segment" })
      .then(() => null, (error: unknown) => error as Error & { code?: string });

    expect(failure).toMatchObject({ name: "ProviderError", code: "invalid_request" });
    expect(failure?.message).not.toContain("sensitive-marker");
    expect(failure?.message.length).toBeLessThanOrEqual(160);
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

function valuesAfter(args: readonly string[], flag: string): string[] {
  return args.flatMap((value, index) => value === flag ? [args[index + 1]] : []);
}
