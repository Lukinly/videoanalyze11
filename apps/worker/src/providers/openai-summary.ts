import { aiNotesSchema, summaryResultSchema, ProviderError, type AiNotes, type AiNotesProvider, type SummaryCapabilities, type SummaryInput, type SummaryProvider, type SummaryResult } from "@videoanalyze/domain";
import { providerErrorFromResponse } from "./http-client.js";
import { summarySystemPrompt } from "./summary-prompt.js";
import { notesSystemPrompt } from "../notes/notes-prompt.js";
import { normalizeProviderCitationTimes } from "./structured-output.js";

// OpenAI-compatible Chat Completions transport, including DashScope/Qwen.
export function createOpenAiSummaryProvider(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  contextWindow?: number;
  maxTokens?: number;
  requestTimeoutMs?: number;
}): SummaryProvider & AiNotesProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const capabilities: SummaryCapabilities = { contextWindow: input.contextWindow ?? 128_000, structuredOutput: true };
  const base = input.baseUrl.replace(/\/+$/, "");
  const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  async function request(system: string, summaryInput: SummaryInput) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxTokens ?? 16_384,
        response_format: { type: "json_object" },
        ...(/^qwen/i.test(input.model) ? { enable_thinking: false } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify({ videoDuration: summaryInput.videoDuration, segments: summaryInput.segments }) }
        ]
      }),
      signal: AbortSignal.timeout(input.requestTimeoutMs ?? 120_000)
    });
    if (!response.ok) throw providerErrorFromResponse(response, await response.text());
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError("invalid_request", "provider response did not contain message content");
    try { return JSON.parse(content) as unknown; }
    catch { throw new ProviderError("invalid_request", "provider response was not valid JSON"); }
  }
  return {
    async capabilities() { return capabilities; },
    async summarize(summaryInput): Promise<SummaryResult> {
      try { return summaryResultSchema.parse(await request(summarySystemPrompt, summaryInput)); }
      catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError("invalid_request", "summary response did not match the summary schema");
      }
    },
    async generateNotes(summaryInput): Promise<AiNotes> {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { return aiNotesSchema.parse(normalizeProviderCitationTimes(await request(notesSystemPrompt, summaryInput))); }
        catch (error) {
          if (attempt === 0 && (!(error instanceof ProviderError) || error.code === "invalid_request")) continue;
          if (error instanceof ProviderError) throw error;
          throw new ProviderError("invalid_request", "notes response did not match the AI notes schema");
        }
      }
      throw new ProviderError("invalid_request", "notes response did not match the AI notes schema");
    }
  };
}
