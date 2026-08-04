export type AppEnv = {
  nodeEnv: "development" | "test" | "production";
  groqApiKey: string;
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  mailApiUrl: string;
  verificationBaseUrl: string;
  maxUploadBytes: number;
  maxVideoDurationSeconds: number;
  maxActiveRunsPerUser: number;
  globalWorkerConcurrency: number;
  originalRetentionDays: number;
  resultRetentionDays: number;
};

export function parseEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const nodeEnv = source.NODE_ENV === "production" ? "production" : source.NODE_ENV === "test" ? "test" : "development";
  const groqApiKey = source.GROQ_API_KEY?.trim() ?? "";
  if (nodeEnv === "production" && !groqApiKey) throw new Error("GROQ_API_KEY is required");

  return {
    nodeEnv,
    groqApiKey,
    databaseUrl: source.DATABASE_URL ?? "postgres://videoanalyze:videoanalyze@127.0.0.1:5433/videoanalyze",
    redisUrl: source.REDIS_URL ?? "redis://127.0.0.1:6379",
    s3Endpoint: source.S3_ENDPOINT ?? "http://127.0.0.1:9000",
    s3Region: source.S3_REGION ?? "us-east-1",
    s3Bucket: source.S3_BUCKET ?? "videoanalyze",
    s3AccessKey: source.S3_ACCESS_KEY ?? "minioadmin",
    s3SecretKey: source.S3_SECRET_KEY ?? "minioadmin",
    mailApiUrl: source.MAIL_API_URL ?? "http://127.0.0.1:8025/api/v1/send",
    verificationBaseUrl: source.VERIFICATION_BASE_URL ?? "http://localhost:5173",
    maxUploadBytes: positiveInteger(source.MAX_UPLOAD_BYTES, 2_000_000_000),
    maxVideoDurationSeconds: positiveInteger(source.MAX_VIDEO_DURATION_SECONDS, 7_200),
    maxActiveRunsPerUser: positiveInteger(source.MAX_ACTIVE_RUNS_PER_USER, 2),
    globalWorkerConcurrency: positiveInteger(source.GLOBAL_WORKER_CONCURRENCY, 2),
    originalRetentionDays: positiveInteger(source.ORIGINAL_RETENTION_DAYS, 7),
    resultRetentionDays: positiveInteger(source.RESULT_RETENTION_DAYS, 30)
  };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
