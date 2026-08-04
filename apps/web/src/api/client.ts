import type { AnalysisStage, AnalysisStatus, TranscriptSegment } from "@videoanalyze/domain";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export type PublicUser = {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
};

export type AnalysisRun = {
  id: string;
  videoId: string;
  status: AnalysisStatus | string;
  stage: AnalysisStage | string;
  progress?: number;
  completedChunks?: number;
  totalChunks?: number;
  transcript?: { segments: TranscriptSegment[]; mergeWarnings: string[] };
};

export type UploadSession = {
  videoId: string;
  objectKey: string;
  uploadUrl: string;
  expiresAt: string;
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
  register: (input: { email: string; password: string }) => request<{ userId: string; verificationSent: boolean }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input)
  }),
  verifyEmail: (token: string) => request<{ userId: string; trialCreditsGranted: boolean }>(`/api/auth/verify-email?token=${encodeURIComponent(token)}`),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  createUploadSession: (input: { fileName: string; contentType: string; contentLength: number }) => request<UploadSession>("/api/videos/upload-session", {
    method: "POST",
    body: JSON.stringify(input)
  }),
  startAnalysis: (videoId: string) => request<AnalysisRun>(`/api/videos/${encodeURIComponent(videoId)}/analysis-runs`, { method: "POST" }),
  getAnalysis: (runId: string) => request<AnalysisRun>(`/api/analysis-runs/${encodeURIComponent(runId)}`),
  cancelAnalysis: (runId: string) => request<AnalysisRun>(`/api/analysis-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" })
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
