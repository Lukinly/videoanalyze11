import { parseMailConfig, type MailConfig } from "../mail/config.js";

export type AppEnv = {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3PublicEndpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  mail: MailConfig;
  authRequestsPerMinute: number;
  mailDailyLimit: number;
  mailRecipientDailyLimit: number;
  verificationBaseUrl: string;
  maxUploadBytes: number;
  transientCapacityBytes: number;
  maxVideoDurationSeconds: number;
  maxActiveRunsPerUser: number;
  globalWorkerConcurrency: number;
  maxQueuedRunsPerUser: number;
  maxTotalQueuedRuns: number;
  maxQueueWaitSeconds: number;
  originalRetentionDays: number;
  resultRetentionDays: number;
};

export function parseEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const nodeEnv = source.NODE_ENV === "production" ? "production" : source.NODE_ENV === "test" ? "test" : "development";
  const explicitS3PublicEndpoint = source.S3_PUBLIC_ENDPOINT?.trim();
  if (nodeEnv === "production" && !explicitS3PublicEndpoint) throw new Error("S3_PUBLIC_ENDPOINT is required in production");
  const s3PublicEndpoint = validateS3PublicEndpoint(explicitS3PublicEndpoint || source.S3_ENDPOINT || "http://127.0.0.1:9000");

  const verificationBaseUrl = source.VERIFICATION_BASE_URL ?? "http://localhost:5173";
  if (nodeEnv === "production") {
    for (const [name, value] of [["VERIFICATION_BASE_URL", verificationBaseUrl], ["S3_PUBLIC_ENDPOINT", s3PublicEndpoint]]) {
      let url: URL;
      try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTPS origin`); }
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || ["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error(`${name} must be a public HTTPS origin`);
    }
    for (const name of ["DATABASE_URL", "REDIS_URL", "S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY"]) {
      if (!source[name]?.trim()) throw new Error(`${name} is required in production`);
    }
    let database: URL;
    try { database = new URL(source.DATABASE_URL!); }
    catch { throw new Error("DATABASE_URL must be a valid database URL"); }
    if (!database.password || source.S3_ACCESS_KEY === "minioadmin" || source.S3_SECRET_KEY === "minioadmin") throw new Error("production requires explicit database and storage credentials");
  }
  return {
    nodeEnv,
    databaseUrl: source.DATABASE_URL ?? "postgres://videoanalyze:videoanalyze@127.0.0.1:5433/videoanalyze",
    redisUrl: source.REDIS_URL ?? "redis://127.0.0.1:6379",
    s3Endpoint: source.S3_ENDPOINT ?? "http://127.0.0.1:9000",
    s3PublicEndpoint,
    s3Region: source.S3_REGION ?? "us-east-1",
    s3Bucket: source.S3_BUCKET ?? "videoanalyze",
    s3AccessKey: source.S3_ACCESS_KEY ?? "minioadmin",
    s3SecretKey: source.S3_SECRET_KEY ?? "minioadmin",
    verificationBaseUrl: nodeEnv === "production" ? new URL(verificationBaseUrl).origin : verificationBaseUrl.replace(/\/$/, ""),
    mail: parseMailConfig(source),
    authRequestsPerMinute: positiveInteger(source.AUTH_REQUESTS_PER_MINUTE, 20),
    mailDailyLimit: positiveInteger(source.MAIL_DAILY_LIMIT, 100),
    mailRecipientDailyLimit: positiveInteger(source.MAIL_RECIPIENT_DAILY_LIMIT, 10),
    maxUploadBytes: positiveInteger(source.MAX_UPLOAD_BYTES, 2_000_000_000),
    transientCapacityBytes: positiveInteger(source.TEMP_MEDIA_CAPACITY_BYTES, 40_000_000_000),
    maxVideoDurationSeconds: positiveInteger(source.MAX_VIDEO_DURATION_SECONDS, 14_400),
    maxActiveRunsPerUser: positiveInteger(source.MAX_ACTIVE_RUNS_PER_USER, 2),
    globalWorkerConcurrency: positiveInteger(source.GLOBAL_WORKER_CONCURRENCY, 2),
    maxQueuedRunsPerUser: positiveInteger(source.MAX_QUEUED_RUNS_PER_USER, 2),
    maxTotalQueuedRuns: positiveInteger(source.MAX_TOTAL_QUEUED_RUNS, 20),
    maxQueueWaitSeconds: positiveInteger(source.MAX_QUEUE_WAIT_SECONDS, 3_600),
    originalRetentionDays: positiveInteger(source.ORIGINAL_RETENTION_DAYS, 7),
    resultRetentionDays: positiveInteger(source.RESULT_RETENTION_DAYS, 30)
  };
}

function validateS3PublicEndpoint(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("S3_PUBLIC_ENDPOINT must be an http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("S3_PUBLIC_ENDPOINT must be an http or https URL");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("S3_PUBLIC_ENDPOINT must not contain a path");
  }
  return parsed.toString().replace(/\/$/, "");
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
