import { aiNotesSchema, summaryResultSchema, ProviderError, type AiNotes, type AiNotesProvider, type SummaryCapabilities, type SummaryInput, type SummaryProvider, type SummaryResult } from "@videoanalyze/domain";
import { providerErrorFromResponse } from "./http-client.js";
import { summarySystemPrompt } from "./summary-prompt.js";
import { notesSystemPrompt } from "../notes/notes-prompt.js";
import { normalizeProviderCitationTimes } from "./structured-output.js";
import { InvalidProviderOutputError, readProviderJson, requestWithRetry } from "./provider-request.js";

// OpenAI-compatible Chat Completions transport, including DashScope/Qwen.
export function createOpenAiSummaryProvider(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  contextWindow?: number;
  maxTokens?: number;
  requestTimeoutMs?: number;
  waitForRetry?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): SummaryProvider & AiNotesProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const capabilities: SummaryCapabilities = { contextWindow: input.contextWindow ?? 128_000, structuredOutput: true };
  const base = input.baseUrl.replace(/\/+$/, "");
  const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  async function request(system: string, summaryInput: SummaryInput) {
    summaryInput.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(input.requestTimeoutMs ?? 120_000);
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
      signal: summaryInput.signal ? AbortSignal.any([summaryInput.signal, timeout]) : timeout
    }).catch(() => { summaryInput.signal?.throwIfAborted(); throw new ProviderError("network_error", "provider request could not connect or timed out"); });
    if (!response.ok) throw providerErrorFromResponse(response, await response.text());
    const payload = await readProviderJson(response) as { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> };
    if (payload?.choices?.[0]?.finish_reason === "content_filter") throw new ProviderError("invalid_request", "provider rejected content");
    if (payload?.choices?.[0]?.finish_reason === "length") throw new InvalidProviderOutputError("provider response was truncated");
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new InvalidProviderOutputError("provider response did not contain message content");
    try { return JSON.parse(content) as unknown; }
    catch { throw new InvalidProviderOutputError("provider response was not valid JSON"); }
  }
  return {
    async capabilities() { return capabilities; },
    async summarize(summaryInput): Promise<SummaryResult> {
      return requestWithRetry(async () => {
        const payload = await request(summarySystemPrompt, summaryInput);
        const parsed = summaryResultSchema.safeParse(payload);
        if (!parsed.success) throw new InvalidProviderOutputError("summary response did not match the summary schema");
        return parsed.data;
      }, { signal: summaryInput.signal, wait: input.waitForRetry });
    },
    async generateNotes(summaryInput): Promise<AiNotes> {
      return requestWithRetry(async () => {
        const payload = await request(notesSystemPrompt, summaryInput);
        const parsed = aiNotesSchema.safeParse(normalizeProviderCitationTimes(payload));
        if (!parsed.success) throw new InvalidProviderOutputError("notes response did not match the AI notes schema");
        return parsed.data;
      }, { signal: summaryInput.signal, wait: input.waitForRetry });
    }
  };
}
