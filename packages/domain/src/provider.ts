import type { TranscriptSegment } from "./analysis.js";

export type TimestampLevel = "segment";

export type AsrCapabilities = {
  maxUploadBytes: number;
  maxConcurrency: number;
  supportedTimestampLevels: TimestampLevel[];
};

export type TranscribeChunkInput = {
  audioFile: string;
  language: string | null;
  timestampLevel: TimestampLevel;
  prompt?: string;
};

export type TranscribeChunkResult = {
  segments: Array<Pick<TranscriptSegment, "start" | "end" | "text">>;
  language?: string;
};

export type SummaryCapabilities = {
  contextWindow: number;
  structuredOutput: boolean;
};

export type SummaryInput = {
  videoDuration: number;
  segments: TranscriptSegment[];
};

export interface AsrProvider {
  capabilities(): Promise<AsrCapabilities>;
  transcribeChunk(input: TranscribeChunkInput): Promise<TranscribeChunkResult>;
}

export interface SummaryProvider {
  capabilities(): Promise<SummaryCapabilities>;
  summarize(input: SummaryInput): Promise<import("./summary.js").SummaryResult>;
}

export type ProviderFailureKind =
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "unauthorized"
  | "invalid_request"
  | "unsupported_file"
  | "unknown";

export type ProviderFailure = {
  kind: ProviderFailureKind;
  retryAfterMs?: number;
  message: string;
};

export class ProviderError extends Error {
  readonly code: ProviderFailureKind;
  readonly retryAfterMs?: number;

  constructor(code: ProviderFailureKind, message: string, options: { retryAfterMs?: number } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function classifyProviderFailure(error: unknown): ProviderFailure {
  if (error instanceof ProviderError) {
    return { kind: error.code, message: error.message, retryAfterMs: error.retryAfterMs };
  }

  if (error instanceof TypeError || error instanceof DOMException) {
    return { kind: "network_error", message: "provider network request failed" };
  }

  return { kind: "unknown", message: "provider request failed" };
}

export function getRetryDecision(failure: ProviderFailure, attempt: number) {
  const retryable = new Set<ProviderFailureKind>(["rate_limited", "server_error", "network_error"]);
  if (!retryable.has(failure.kind) || attempt >= 3) {
    return { retry: false, delayMs: 0, reduceConcurrency: false };
  }

  const exponentialDelay = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  return {
    retry: true,
    delayMs: failure.retryAfterMs ?? exponentialDelay,
    reduceConcurrency: failure.kind === "rate_limited"
  };
}
