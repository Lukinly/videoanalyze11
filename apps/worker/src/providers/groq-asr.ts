import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ProviderError, type AsrCapabilities, type AsrProvider, type TranscribeChunkInput, type TranscribeChunkResult } from "@videoanalyze/domain";
import { requestGroqAsrWithCurl, type CurlRunner } from "./groq-asr-curl.js";
import { providerErrorFromResponse } from "./http-client.js";

type FetchLike = typeof fetch;

export function createGroqAsrProvider(input: { apiKey: string; model: string; fetchImpl?: FetchLike; curlRunner?: CurlRunner; maxUploadBytes?: number; maxConcurrency?: number }): AsrProvider {
  const capabilities: AsrCapabilities = {
    maxUploadBytes: input.maxUploadBytes ?? 25 * 1024 * 1024,
    maxConcurrency: input.maxConcurrency ?? 2,
    supportedTimestampLevels: ["segment"]
  };

  return {
    async capabilities() {
      return capabilities;
    },
    async transcribeChunk(chunk: TranscribeChunkInput): Promise<TranscribeChunkResult> {
      if (!input.fetchImpl) {
        const response = await requestGroqAsrWithCurl({
          apiKey: input.apiKey,
          audioFile: chunk.audioFile,
          curlRunner: input.curlRunner,
          language: chunk.language,
          model: input.model,
          prompt: chunk.prompt,
          timestampLevel: chunk.timestampLevel,
        });
        if (response.status < 200 || response.status >= 300) {
          const headers = response.retryAfter ? { "retry-after": response.retryAfter } : undefined;
          const body = sanitizeProviderBody(response.body, input.apiKey);
          throw providerErrorFromResponse(new Response(null, { headers, status: response.status }), body);
        }

        return parseTranscriptionPayload(parseJsonText(response.body));
      }

      const form = new FormData();
      const bytes = await readFile(chunk.audioFile);
      form.append("file", new Blob([bytes], { type: "audio/flac" }), basename(chunk.audioFile));
      form.append("model", input.model);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", chunk.timestampLevel);
      if (chunk.language) form.append("language", chunk.language);
      if (chunk.prompt) form.append("prompt", chunk.prompt);

      const response = await input.fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}` },
        body: form
      });
      if (!response.ok) throw providerErrorFromResponse(response, await response.text());

      return parseTranscriptionPayload(await parseJsonResponse(response));
    }
  };
}

function parseTranscriptionPayload(payload: unknown): TranscribeChunkResult {
  if (typeof payload !== "object" || payload === null) {
    throw new ProviderError("invalid_request", "ASR response did not include segments");
  }
  const segments = (payload as { segments?: unknown[] }).segments;
  if (!Array.isArray(segments)) throw new ProviderError("invalid_request", "ASR response did not include segments");
  return {
    segments: segments.map((segment) => {
      if (typeof segment !== "object" || segment === null) {
        throw new ProviderError("invalid_request", "ASR response contains an invalid segment");
      }
      const candidate = segment as { start?: unknown; end?: unknown; text?: unknown };
      if (typeof candidate.start !== "number" || typeof candidate.end !== "number" || typeof candidate.text !== "string") {
        throw new ProviderError("invalid_request", "ASR response contains an invalid segment");
      }
      return { start: candidate.start, end: candidate.end, text: candidate.text };
    }),
  };
}

function parseJsonText(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new ProviderError("invalid_request", "ASR response was not valid JSON");
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ProviderError("invalid_request", "ASR response was not valid JSON");
  }
}

function sanitizeProviderBody(body: string, apiKey: string): string {
  const withoutKey = apiKey ? body.replaceAll(apiKey, "[REDACTED]") : body;
  return withoutKey.replace(/https?:\/\/[^\s?]+\?[^\s]*/gi, "[REDACTED_URL]");
}
