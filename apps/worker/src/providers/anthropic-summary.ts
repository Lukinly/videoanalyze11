import { normalizeProviderCitationTimes } from "./structured-output.js";
import { aiNotesSchema, summaryResultSchema, ProviderError, type AiNotes, type AiNotesProvider, type SummaryCapabilities, type SummaryInput, type SummaryProvider, type SummaryResult } from "@videoanalyze/domain";
import { providerErrorFromResponse } from "./http-client.js";
import { summarySystemPrompt } from "./summary-prompt.js";
import { notesSystemPrompt } from "../notes/notes-prompt.js";

type FetchLike = typeof fetch;

// Anthropic Messages API-compatible summary provider. Used for providers that
// expose the /v1/messages contract (e.g. DeepSeek's Anthropic-compatible
// endpoint https://api.deepseek.com/anthropic), which authenticates with
// `x-api-key` rather than `Authorization: Bearer`.
export function createAnthropicSummaryProvider(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: FetchLike;
  contextWindow?: number;
  maxTokens?: number;
  requestTimeoutMs?: number;
}): SummaryProvider & AiNotesProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const capabilities: SummaryCapabilities = { contextWindow: input.contextWindow ?? 128_000, structuredOutput: false };
  const endpoint = `${input.baseUrl.replace(/\/+$/, "")}/v1/messages`;
  const maxTokens = input.maxTokens ?? 16_384;
  const requestTimeoutMs = input.requestTimeoutMs ?? 120_000;

  async function request(system: string, summaryInput: SummaryInput) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          max_tokens: maxTokens,
          thinking: { type: "disabled" },
          system,
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({ videoDuration: summaryInput.videoDuration, segments: summaryInput.segments }) }] }]
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw providerErrorFromResponse(response, await response.text());
    const payload = await response.json() as { content?: Array<{ type?: string; text?: string | null }> };
    const content = payload.content?.find((block) => block.type === "text")?.text;
    if (!content) throw new ProviderError("invalid_request", "provider response did not contain message content");
    try { return JSON.parse(content) as unknown; }
    catch { throw new ProviderError("invalid_request", "provider response was not valid JSON"); }
  }

  return {
    async capabilities() {
      return capabilities;
    },
    async summarize(summaryInput: SummaryInput): Promise<SummaryResult> {
      try {
        return summaryResultSchema.parse(await request(summarySystemPrompt, summaryInput));
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError("invalid_request", "summary response did not match the summary schema");
      }
    },
    async generateNotes(summaryInput: SummaryInput): Promise<AiNotes> {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try { return aiNotesSchema.parse(normalizeProviderCitationTimes(await request(notesSystemPrompt, summaryInput))); }
        catch (error) {
          const retryableInvalidResponse = !(error instanceof ProviderError) || error.code === "invalid_request";
          if (attempt === 0 && retryableInvalidResponse) continue;
          if (error instanceof ProviderError) throw error;
          throw new ProviderError("invalid_request", "notes response did not match the AI notes schema");
        }
      }
      throw new ProviderError("invalid_request", "notes response did not match the AI notes schema");
    }
  };
}
