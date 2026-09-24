const BYTES_PER_BILLING_UNIT = 10_000_000;

export function calculateAnalysisCost(fileSizeBytes: number): number {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new Error("file size must be positive");
  }
  return Math.max(1, Math.ceil(fileSizeBytes / BYTES_PER_BILLING_UNIT));
}
