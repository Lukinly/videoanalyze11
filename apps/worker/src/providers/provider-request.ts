import { setTimeout as delay } from "node:timers/promises";
import { classifyProviderFailure, getRetryDecision, ProviderError } from "@videoanalyze/domain";

// Distinguish unusable model output from rejected input, auth or quota errors.
export class InvalidProviderOutputError extends ProviderError {
  constructor(message: string) { super("invalid_request", message); }
}

export async function readProviderJson(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch (error) {
    if (error instanceof SyntaxError) throw new InvalidProviderOutputError("provider response was not valid JSON");
    throw new ProviderError("network_error", "provider response connection was interrupted or timed out");
  }
}

export async function requestWithRetry<T>(request: () => Promise<T>, options: {
  signal?: AbortSignal;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
} = {}): Promise<T> {
  let invalidOutputs = 0;
  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted();
    try { return await request(); }
    catch (error) {
      options.signal?.throwIfAborted();
      const invalidOutput = error instanceof InvalidProviderOutputError;
      if (invalidOutput && ++invalidOutputs > 1) throw error;
      const failure = classifyProviderFailure(error);
      const decision = getRetryDecision(invalidOutput ? { ...failure, kind: "server_error" } : failure, attempt);
      if (!decision.retry) throw error;
      const delayMs = Math.min(30_000, Math.max(decision.delayMs, failure.kind === "rate_limited" ? 5_000 * attempt : 0));
      await (options.wait ?? ((ms, signal) => delay(ms, undefined, { signal })))(delayMs, options.signal);
    }
  }
}
