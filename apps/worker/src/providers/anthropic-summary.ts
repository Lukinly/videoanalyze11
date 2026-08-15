import { summaryResultSchema, ProviderError, type SummaryCapabilities, type SummaryInput, type SummaryProvider, type SummaryResult } from "@videoanalyze/domain";
import { providerErrorFromResponse } from "./http-client.js";
import { summarySystemPrompt } from "./summary-prompt.js";

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
}): SummaryProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const capabilities: SummaryCapabilities = { contextWindow: input.contextWindow ?? 128_000, structuredOutput: false };
  const endpoint = `${input.baseUrl.replace(/\/+$/, "")}/v1/messages`;
  const maxTokens = input.maxTokens ?? 16_384;
  const requestTimeoutMs = input.requestTimeoutMs ?? 120_000;

  return {
    async capabilities() {
      return capabilities;
    },
    async summarize(summaryInput: SummaryInput): Promise<SummaryResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "x-api-key": input.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: input.model,
            max_tokens: maxTokens,
            // DeepSeek's Anthropic-compatible endpoint thinks by default and can
            // burn the whole max_tokens budget on the thinking block, returning
            // no text at all (intermittently, depending on how long the model
            // thinks). Disable it so the summary text always comes back.
            thinking: { type: "disabled" },
            system: summarySystemPrompt,
            messages: [
              { role: "user", content: [{ type: "text", text: JSON.stringify({ videoDuration: summaryInput.videoDuration, segments: summaryInput.segments }) }] }
            ]
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw providerErrorFromResponse(response, await response.text());

      const payload = await response.json() as { content?: Array<{ type?: string; text?: string | null }> };
      // The content array may lead with a `thinking` block (DeepSeek emits one
      // by default); pick the first text block instead of assuming index 0.
      const content = payload.content?.find((block) => block.type === "text")?.text;
      if (!content) throw new ProviderError("invalid_request", "summary response did not contain message content");
      try {
        return summaryResultSchema.parse(JSON.parse(content));
      } catch {
        throw new ProviderError("invalid_request", "summary response did not match the summary schema");
      }
    }
  };
}
