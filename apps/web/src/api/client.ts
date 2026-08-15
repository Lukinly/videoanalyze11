import type { AiNotes, AnalysisStage, AnalysisStatus, ResultAvailability, RetentionMode, TranscriptSegment } from "@videoanalyze/domain";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export type PublicUser = {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  mustChangePassword: boolean;
};

export type CreditBalance = { ledgerBalance: number; held: number; available: number };
export type BillingStatus = "pending_duration_probe" | "reserved" | "consumed" | "released";
export type CreditLedgerEntry = { id: string; userId: string; amount: number; type: string; referenceId: string | null; reason: string; createdAt: string };
export type CreditTopupRequest = { id: string; userId?: string; userEmail?: string | null; requestedAmount: number; note: string; status: "pending" | "approved" | "rejected"; reviewNote?: string | null; createdAt?: string; reviewedAt?: string | null };
export type AdminUser = PublicUser & CreditBalance;
export type AdminAuditLog = { id: string; adminUserId: string; action: string; targetUserId: string | null; targetRecordId: string | null; metadata: Record<string, unknown>; reason: string; createdAt: string };

export type AnalysisRun = {
  id: string;
  videoId: string;
  status: AnalysisStatus | string;
  stage: AnalysisStage | string;
  estimatedCost?: number;
  billingStatus?: BillingStatus;
  billedDurationSeconds?: number | null;
  billingRuleVersion?: string | null;
  billedMinutes?: number | null;
  reservedCredits?: number | null;
  progress?: number;
  completedChunks?: number;
  totalChunks?: number;
  fileName?: string;
  duration?: number | null;
  retentionMode?: RetentionMode;
  resultAvailability?: ResultAvailability;
  resultExpiresAt?: string | null;
  originalDeletedAt?: string | null;
  transcript?: { segments: TranscriptSegment[]; mergeWarnings: string[] };
  summary?: {
    oneLineSummary: string;
    overallSummary: string;
    chapters: Array<{ id: string; title: string; sourceSegmentIds: string[]; summary: string; bullets: Array<{ text: string; sourceSegmentIds: string[] }>; start?: number; end?: number; alignmentWarning?: boolean }>;
  };
  notes?: AiNotes;
};

export type SearchResult = {
  sourceType: "transcript" | "chapter" | "bullet";
  sourceId: string;
  text: string;
  start: number;
  end: number;
};

export type UploadSession = {
  videoId: string;
  objectKey: string;
  uploadUrl: string;
  expiresAt: string;
  fileSize: number;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; code?: string };
    throw new ApiError(body.message ?? `Request failed (${response.status})`, response.status, body.code);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  getMe: () => request<PublicUser>("/api/auth/me"),
  login: (input: { email: string; password: string }) => request<{ user: PublicUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input)
  }),
  sendRegistrationCode: (input: { email: string }) => request<{ sent: true; expiresInSeconds: 600 }>("/api/auth/registration-code", {
    method: "POST",
    body: JSON.stringify(input)
  }),
  register: (input: { email: string; password: string; confirmPassword: string; verificationCode: string }) => request<{ userId: string; verified: true }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input)
  }),
  verifyEmail: (token: string) => request<{ userId: string; trialCreditsGranted: boolean }>(`/api/auth/verify-email?token=${encodeURIComponent(token)}`),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  createUploadSession: (input: { fileName: string; contentType: string; contentLength: number }) => request<UploadSession>("/api/videos/upload-session", {
    method: "POST",
    body: JSON.stringify(input)
  }),
  startAnalysis: (videoId: string, retentionMode: RetentionMode = "standard") => request<AnalysisRun>(`/api/videos/${encodeURIComponent(videoId)}/analysis-runs`, { method: "POST", body: JSON.stringify({ retentionMode }) }),
  getAnalysis: (runId: string) => request<AnalysisRun>(`/api/analysis-runs/${encodeURIComponent(runId)}`),
  listAnalyses: (limit = 50) => request<{ items: AnalysisRun[] }>(`/api/analysis-runs?limit=${limit}`),
  deleteAnalysisResults: (runId: string) => request<void>(`/api/analysis-runs/${encodeURIComponent(runId)}/results`, { method: "DELETE" }),
  cancelAnalysis: (runId: string) => request<AnalysisRun>(`/api/analysis-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  search: (runId: string, query: string) => request<{ results: SearchResult[] }>(`/api/analysis-runs/${encodeURIComponent(runId)}/search?q=${encodeURIComponent(query)}`),
  getPlaybackUrl: (videoId: string) => request<{ url: string }>(`/api/videos/${encodeURIComponent(videoId)}/playback-url`),
  deleteVideo: (videoId: string) => request<void>(`/api/videos/${encodeURIComponent(videoId)}`, { method: "DELETE" }),
  getCredits: () => request<CreditBalance>("/api/credits"),
  getCreditLedger: (limit = 50) => request<{ items: CreditLedgerEntry[] }>(`/api/credits/ledger?limit=${limit}`),
  createCreditRequest: (input: { requestedAmount: number; note: string }) => request<CreditTopupRequest>("/api/credit-requests", { method: "POST", body: JSON.stringify(input) }),
  getCreditRequests: () => request<{ items: CreditTopupRequest[] }>("/api/credit-requests"),
  listAdminUsers: (input: { search?: string; status?: string } = {}) => request<{ items: AdminUser[] }>(`/api/admin/users?${new URLSearchParams(input).toString()}`),
  getAdminUser: (id: string) => request<{ user: PublicUser; balance: CreditBalance; ledger: CreditLedgerEntry[] }>(`/api/admin/users/${encodeURIComponent(id)}`),
  changeAdminRole: (id: string, input: { role: "user" | "admin"; reason: string }) => request<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/role`, { method: "PATCH", body: JSON.stringify(input) }),
  changeAdminStatus: (id: string, input: { status: "active" | "suspended"; reason: string }) => request<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify(input) }),
  adjustAdminCredits: (id: string, input: { direction: "grant" | "debit"; amount: number; reason: string; idempotencyKey: string }) => request<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/credits`, { method: "POST", body: JSON.stringify(input) }),
  forceAdminPasswordReset: (id: string) => request<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/force-password-reset`, { method: "POST" }),
  listAdminCreditRequests: (status = "pending") => request<{ items: CreditTopupRequest[] }>(`/api/admin/credit-requests?status=${encodeURIComponent(status)}`),
  approveAdminTopup: (id: string, note: string) => request<CreditTopupRequest>(`/api/admin/credit-requests/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ note }) }),
  rejectAdminTopup: (id: string, note: string) => request<CreditTopupRequest>(`/api/admin/credit-requests/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ note }) }),
  listAdminAuditLogs: () => request<{ items: AdminAuditLog[] }>("/api/admin/audit-logs"),
  resetPassword: (input: { token: string; password: string; confirmPassword: string }) => request<{ ok: true }>("/api/auth/password-reset", { method: "POST", body: JSON.stringify(input) }),
  changePassword: (input: { password: string; confirmPassword: string }) => request<{ ok: true }>("/api/auth/change-password", { method: "POST", body: JSON.stringify(input) })
};

export function subscribeToAnalysis(
  runId: string,
  onProgress: (event: { stage?: string; progress?: number; completedChunks?: number; totalChunks?: number; error?: string }) => void,
  onError?: () => void
) {
  const events = new EventSource(`${API_BASE_URL}/api/analysis-runs/${encodeURIComponent(runId)}/events`, { withCredentials: true });
  events.addEventListener("progress", (event) => {
    onProgress(JSON.parse((event as MessageEvent<string>).data) as Parameters<typeof onProgress>[0]);
  });
  events.onerror = () => onError?.();
  return () => events.close();
}

export async function putUpload(uploadUrl: string, file: File, onProgress?: (progress: number) => void) {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new ApiError(`Upload failed (${request.status})`, request.status));
    };
    request.onerror = () => reject(new Error("Upload network error"));
    request.onabort = () => reject(new Error("Upload cancelled"));
    request.send(file);
  });
}
