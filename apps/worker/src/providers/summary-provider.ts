import { createAnthropicSummaryProvider } from "./anthropic-summary.js";
import { createOpenAiSummaryProvider } from "./openai-summary.js";

export function resolveSummaryProtocol(baseUrl: string, protocol = "auto"): "anthropic" | "openai" {
  if (protocol === "anthropic" || protocol === "openai") return protocol;
  if (protocol !== "auto") throw new Error("LLM_API_PROTOCOL must be auto, anthropic or openai");
  const path = new URL(baseUrl).pathname.replace(/\/+$/, "");
  if (path.includes("/compatible-mode/") || path.includes("/openai/") || path.endsWith("/chat/completions")) return "openai";
  return "anthropic";
}

export function createSummaryProvider(input: Parameters<typeof createAnthropicSummaryProvider>[0] & { protocol?: string }) {
  return resolveSummaryProtocol(input.baseUrl, input.protocol) === "openai"
    ? createOpenAiSummaryProvider(input)
    : createAnthropicSummaryProvider(input);
}
