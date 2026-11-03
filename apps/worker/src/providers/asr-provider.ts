import { createQwenOmniAsrProvider, QWEN_ASR_BASE_URL, QWEN_ASR_MODEL } from "./qwen-omni-asr.js";

export function createConfiguredAsrProvider(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = (env.LLM_API_KEY ?? env.llm_api_key ?? "").trim();
  if (!apiKey || apiKey.startsWith("replace-")) throw new Error("LLM_API_KEY is required for Qwen ASR; it shares the summary model key");
  return createQwenOmniAsrProvider({ apiKey, baseUrl: env.ASR_API_BASE_URL ?? QWEN_ASR_BASE_URL, model: env.ASR_MODEL ?? QWEN_ASR_MODEL });
}
