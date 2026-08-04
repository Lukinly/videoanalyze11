import { ProviderError, type ProviderFailureKind } from "@videoanalyze/domain";

export function providerErrorFromResponse(response: Response, body: string): ProviderError {
  const code = statusToCode(response.status);
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterMs = retryAfterHeader ? Number.isFinite(Number(retryAfterHeader)) ? Number(retryAfterHeader) * 1000 : undefined : undefined;
  return new ProviderError(code, `provider request failed with status ${response.status}: ${body.slice(0, 200)}`, { retryAfterMs });
}

function statusToCode(status: number): ProviderFailureKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status >= 400) return "invalid_request";
  return "unknown";
}
