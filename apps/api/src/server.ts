import { createMailer } from "./mail/mailer.js";
import { createAuthRateLimiter } from "./auth/rate-limiter.js";
import { createProgressHub, type ProgressEvent } from "./events/progress-hub.js";
import { recoverQueuedRuns } from "./analysis/queue-recovery.js";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { Queue } from "bullmq";
import { buildApp } from "./app.js";
import { createAnalysisService } from "./analysis/analysis-service.js";
import { createAuthService } from "./auth/auth-service.js";
import { parseEnv } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createRepositories } from "./db/repositories/index.js";
import { createSearchService } from "./search/search-service.js";
import { createS3Client } from "./storage/s3-client.js";
import { createS3ObjectStorage } from "./storage/s3-storage.js";
import { createUploadService } from "./storage/upload-service.js";
import { createResultService } from "./results/result-service.js";
import { createMediaService } from "./routes/media.js";
import { createLinkImportService } from "./links/link-import-service.js";
import { createPlatformInspector } from "./links/platform-inspector.js";

const env = parseEnv();
const { pool } = createDatabase(env.databaseUrl);
const repositories = createRepositories(pool, { transientCapacityBytes: env.transientCapacityBytes });
const s3 = createS3Client({ endpoint: env.s3Endpoint, region: env.s3Region, accessKey: env.s3AccessKey, secretKey: env.s3SecretKey });
const s3Presign = createS3Client({ endpoint: env.s3PublicEndpoint, region: env.s3Region, accessKey: env.s3AccessKey, secretKey: env.s3SecretKey });
const storage = createS3ObjectStorage({ client: s3 as never, presignClient: s3Presign as never, bucket: env.s3Bucket });
const redisConnection = redisConnectionFromUrl(env.redisUrl);
const queue = new Queue("video-analysis", { connection: redisConnection });
const registeredLimits = new Set<string>();
const limit = createAuthRateLimiter(async (script, keys, args) => {
  const client = await queue.client;
  const name = `videoanalyzeAuthLimit${keys.length}`;
  if (!registeredLimits.has(name)) {
    client.defineCommand(name, { numberOfKeys: keys.length, lua: script });
    registeredLimits.add(name);
  }
  return client.runCommand(name, [...keys, ...args]);
});
const mailer = createMailer(env.mail, {
  beforeSend: (email) => limit([
    { scope: "mail:recipient", identity: email, limit: env.mailRecipientDailyLimit, windowMs: 86_400_000 },
    { scope: "mail:global", identity: "all", limit: env.mailDailyLimit, windowMs: 86_400_000 }
  ]),
  reportFailure: (category) => console.error(JSON.stringify({ event: "mail_delivery_failed", category }))
});
const authService = createAuthService({ repositories, verificationBaseUrl: env.verificationBaseUrl, mailer });
const resultService = createResultService({ repository: repositories.results });
const progressHub = createProgressHub({
  async load(runId) {
    const result = await pool.query<ProgressEvent>(
      `SELECT stage, status, progress,
         (SELECT COUNT(*)::int FROM chunks WHERE run_id = ar.id AND status = 'completed') AS "completedChunks",
         (SELECT COUNT(*)::int FROM chunks WHERE run_id = ar.id) AS "totalChunks"
       FROM analysis_runs ar WHERE id = $1`, [runId]);
    return result.rows[0] ?? null;
  }
});
const app = buildApp({
  progressHub,
  authService,
  trustProxy: env.nodeEnv === "production" ? 1 : false,
  authOrigin: env.nodeEnv === "production" ? env.verificationBaseUrl : undefined,
  authRequestLimit: (ip) => limit([{ scope: "requests", identity: ip, limit: env.authRequestsPerMinute, windowMs: 60_000 }]),
  secureCookies: env.nodeEnv === "production",
  uploadService: createUploadService({ transientMedia: repositories.transientMedia, storage, maxBytes: env.maxUploadBytes, maxDurationSeconds: env.maxVideoDurationSeconds, transientCapacityBytes: env.transientCapacityBytes }),
  analysisService: createAnalysisService({ videos: repositories.videos, runs: repositories.runs, queue, admissionLimits: { maxQueuedPerUser: env.maxQueuedRunsPerUser, maxTotalQueued: env.maxTotalQueuedRuns, maxEstimatedWaitSeconds: env.maxQueueWaitSeconds } }),
  resultService,
  linkImportService: createLinkImportService({ inspector: createPlatformInspector(), repository: repositories.videos }),
  credits: repositories.credits,
  topups: repositories.admin,
  users: repositories.users,
  adminRepository: repositories.admin,
  searchService: createSearchService({ search: repositories.search, availability: resultService }),
  mediaService: createMediaService({ videos: repositories.videos, storage }),
  videoDeletion: { videos: repositories.videos, storage },
  readinessChecks: {
    database: async () => { await pool.query("SELECT 1"); },
    redis: async () => { await queue.waitUntilReady(); },
    storage: async () => { await s3.send(new HeadBucketCommand({ Bucket: env.s3Bucket })); }
  }
});

let recovering = false;
const recover = async () => {
  if (recovering) return;
  recovering = true;
  try { await recoverQueuedRuns({ pool, queue }); }
  catch { console.error("Queue recovery deferred: dependencies unavailable"); }
  finally { recovering = false; }
};
const recoveryTimer = setInterval(() => { void recover(); }, 10_000);
recoveryTimer.unref();
void recover();
app.addHook("onClose", async () => {
  clearInterval(recoveryTimer);
  progressHub.close();
  mailer.close();
  await queue.close();
  await pool.end();
  s3.destroy();
  s3Presign.destroy();
});
process.once("SIGTERM", () => { void app.close(); });
process.once("SIGINT", () => { void app.close(); });

await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });

function redisConnectionFromUrl(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined
  };
}
