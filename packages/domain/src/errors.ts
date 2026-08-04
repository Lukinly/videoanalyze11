export type DomainErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "EMAIL_NOT_VERIFIED"
  | "QUOTA_EXHAUSTED"
  | "UPLOAD_TOO_LARGE"
  | "NO_AUDIO_TRACK"
  | "UNSUPPORTED_MEDIA"
  | "ANALYSIS_CONFLICT";

export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode, message: string, readonly status = 400) {
    super(message);
    this.name = "DomainError";
  }
}
