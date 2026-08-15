import { summaryResultSchema, ProviderError, type SummaryProvider, type SummaryCapabilities, type SummaryInput, type SummaryResult } from "@videoanalyze/domain";
import { providerErrorFromResponse } from "./http-client.js";
import { summarySystemPrompt } from "./summary-prompt.js";

type FetchLike = typeof fetch;

export function createGroqSummaryProvider(input: { apiKey: string; model: string; fetchImpl?: FetchLike; contextWindow?: number }): SummaryProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const capabilities: SummaryCapabilities = { contextWindow: input.contextWindow ?? 32_000, structuredOutput: true };

  return {
    async capabilities() {
      return capabilities;
    },
    async summarize(summaryInput: SummaryInput): Promise<SummaryResult> {
      const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: summarySystemPrompt },
            { role: "user", content: JSON.stringify({ videoDuration: summaryInput.videoDuration, segments: summaryInput.segments }) }
          ]
        })
      });
      if (!response.ok) throw providerErrorFromResponse(response, await response.text());

      const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new ProviderError("invalid_request", "summary response did not contain message content");
      try {
        return summaryResultSchema.parse(JSON.parse(content));
      } catch {
        throw new ProviderError("invalid_request", "summary response did not match the summary schema");
      }
    }
  };
}
