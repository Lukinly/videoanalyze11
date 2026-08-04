import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ProviderError, type AsrCapabilities, type AsrProvider, type TranscribeChunkInput, type TranscribeChunkResult } from "@videoanalyze/domain";
import { providerErrorFromResponse } from "./http-client.js";

type FetchLike = typeof fetch;

export function createGroqAsrProvider(input: { apiKey: string; model: string; fetchImpl?: FetchLike; maxUploadBytes?: number; maxConcurrency?: number }): AsrProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
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
      const form = new FormData();
      const bytes = await readFile(chunk.audioFile);
      form.append("file", new Blob([bytes], { type: "audio/flac" }), basename(chunk.audioFile));
      form.append("model", input.model);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", chunk.timestampLevel);
      if (chunk.language) form.append("language", chunk.language);
      if (chunk.prompt) form.append("prompt", chunk.prompt);

      const response = await fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}` },
        body: form
      });
      if (!response.ok) throw providerErrorFromResponse(response, await response.text());

      const payload = await response.json() as { segments?: Array<{ start?: number; end?: number; text?: string }> };
      if (!Array.isArray(payload.segments)) throw new ProviderError("invalid_request", "ASR response did not include segments");
      const segments = payload.segments.map((segment) => {
        if (typeof segment.start !== "number" || typeof segment.end !== "number" || typeof segment.text !== "string") {
          throw new ProviderError("invalid_request", "ASR response contains an invalid segment");
        }
        return { start: segment.start, end: segment.end, text: segment.text };
      });
      return { segments };
    }
  };
}
