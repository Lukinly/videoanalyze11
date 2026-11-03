import { ProviderError, type ProviderFailureKind } from "@videoanalyze/domain";

// Only documented codes can enter stored errors. Never retain upstream messages,
// which may echo the prompt, audio, URLs or credentials.
const codes: Record<string, ProviderFailureKind> = {
  Throttling: "rate_limited", "Throttling.RateQuota": "rate_limited", limit_requests: "rate_limited",
  "Throttling.BurstRate": "rate_limited", limit_burst_rate: "rate_limited", rate_limit_exceeded: "rate_limited",
  "Throttling.ServiceOverloaded": "server_error", "Throttling.ResourceExhausted": "server_error",
  InternalError: "server_error", InternalServerError: "server_error", internal_server_error: "server_error",
  "InternalError.DataInspection": "server_error", ServiceUnavailable: "server_error", service_unavailable: "server_error",
  SystemError: "server_error", ModelServiceFailed: "server_error", RequestTimeOut: "network_error",
  InvalidApiKey: "unauthorized", invalid_api_key: "unauthorized", AccessDenied: "unauthorized", access_denied: "unauthorized",
  DataInspectionFailed: "invalid_request", data_inspection_failed: "invalid_request",
  InputDataInspectionFailed: "invalid_request", OutputDataInspectionFailed: "invalid_request", content_filter: "invalid_request",
  InvalidParameter: "invalid_request", invalid_parameter: "invalid_request", invalid_request_error: "invalid_request",
  ModelNotFound: "invalid_request", model_not_found: "invalid_request", Arrearage: "invalid_request",
  // These codes can also mean exhausted quota; require an administrator to check.
  "Throttling.AllocationQuota": "invalid_request", insufficient_quota: "invalid_request"
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export class QwenAsrError extends ProviderError {
  constructor(kind: ProviderFailureKind, message: string, readonly providerCode: string | undefined, readonly requestId: string | undefined, readonly httpStatus: number, retryAfterMs?: number) {
    super(kind, message, { retryAfterMs });
  }
}

export function qwenAsrError(payload: unknown, response: Response, streaming: boolean): QwenAsrError {
  const root = record(payload), error = record(root.error);
  const candidate = error.code ?? root.code ?? error.type;
  const code = typeof candidate === "string" && Object.hasOwn(codes, candidate) ? candidate : undefined;
  const id = root.request_id ?? error.request_id ?? response.headers.get("x-request-id") ?? response.headers.get("x-dashscope-request-id");
  // Request IDs are hexadecimal UUIDs, rather than arbitrary provider text.
  const requestId = typeof id === "string" && /^(?:[a-f0-9]{32}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i.test(id) ? id : undefined;
  const fallback: ProviderFailureKind = streaming ? "invalid_request" : response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 429 ? "rate_limited" : response.status >= 500 ? "server_error" : "invalid_request";
  const prefix = streaming ? "Qwen ASR streaming error" : `provider request failed with status ${response.status}: Qwen ASR request rejected`;
  const details = [code ? `code=${code}` : streaming ? "code=unrecognized" : "", requestId ? `request_id=${requestId}` : ""].filter(Boolean).join("; ");
  const retryAfter = Number(response.headers.get("retry-after"));
  return new QwenAsrError(code ? codes[code] : fallback, `${prefix}${details ? ` (${details})` : ""}`, code, requestId, response.status,
    Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30_000, retryAfter * 1000) : undefined);
}

export async function readQwenError(response: Response): Promise<unknown> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 16_384) return undefined;
      parts.push(part.value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch { return undefined; }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
