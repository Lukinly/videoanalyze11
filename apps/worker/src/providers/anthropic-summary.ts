import { normalizeProviderCitationTimes } from "./structured-output.js";
import { aiNotesSchema, summaryResultSchema, ProviderError, type AiNotes, type AiNotesProvider, type SummaryCapabilities, type SummaryInput, type SummaryProvider, type SummaryResult } from "@videoanalyze/domain";
import { providerErrorFromResponse } from "./http-client.js";
import { summarySystemPrompt } from "./summary-prompt.js";
import { notesSystemPrompt } from "../notes/notes-prompt.js";
import { InvalidProviderOutputError, readProviderJson, requestWithRetry } from "./provider-request.js";

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
  waitForRetry?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): SummaryProvider & AiNotesProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const capabilities: SummaryCapabilities = { contextWindow: input.contextWindow ?? 128_000, structuredOutput: false };
  const endpoint = `${input.baseUrl.replace(/\/+$/, "")}/v1/messages`;
  const maxTokens = input.maxTokens ?? 16_384;
  const requestTimeoutMs = input.requestTimeoutMs ?? 120_000;

  async function request(system: string, summaryInput: SummaryInput) {
    summaryInput.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          max_tokens: maxTokens,
          thinking: { type: "disabled" },
          system,
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({ videoDuration: summaryInput.videoDuration, segments: summaryInput.segments }) }] }]
        }),
        signal: summaryInput.signal ? AbortSignal.any([summaryInput.signal, timeout]) : timeout
      }).catch(() => { summaryInput.signal?.throwIfAborted(); throw new ProviderError("network_error", "provider request could not connect or timed out"); });
    if (!response.ok) throw providerErrorFromResponse(response, await response.text());
    const payload = await readProviderJson(response) as { content?: Array<{ type?: string; text?: string | null }>; stop_reason?: string };
    if (payload?.stop_reason === "refusal") throw new ProviderError("invalid_request", "provider rejected content");
    if (payload?.stop_reason === "max_tokens") throw new InvalidProviderOutputError("provider response was truncated");
    const content = payload?.content?.find((block) => block.type === "text")?.text;
    if (!content) throw new InvalidProviderOutputError("provider response did not contain message content");
    try { return JSON.parse(content) as unknown; }
    catch { throw new InvalidProviderOutputError("provider response was not valid JSON"); }
  }

  return {
    async capabilities() {
      return capabilities;
    },
    async summarize(summaryInput: SummaryInput): Promise<SummaryResult> {
      return requestWithRetry(async () => {
        const payload = await request(summarySystemPrompt, summaryInput);
        const parsed = summaryResultSchema.safeParse(payload);
        if (!parsed.success) throw new InvalidProviderOutputError("summary response did not match the summary schema");
        return parsed.data;
      }, { signal: summaryInput.signal, wait: input.waitForRetry });
    },
    async generateNotes(summaryInput: SummaryInput): Promise<AiNotes> {
      return requestWithRetry(async () => {
        const payload = await request(notesSystemPrompt, summaryInput);
        const parsed = aiNotesSchema.safeParse(normalizeProviderCitationTimes(payload));
        if (!parsed.success) throw new InvalidProviderOutputError("notes response did not match the AI notes schema");
        return parsed.data;
      }, { signal: summaryInput.signal, wait: input.waitForRetry });
    }
  };
}
