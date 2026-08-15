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

const env = parseEnv();
const { pool } = createDatabase(env.databaseUrl);
const repositories = createRepositories(pool, { transientCapacityBytes: env.transientCapacityBytes });
const s3 = createS3Client({ endpoint: env.s3Endpoint, region: env.s3Region, accessKey: env.s3AccessKey, secretKey: env.s3SecretKey });
const s3Presign = createS3Client({ endpoint: env.s3PublicEndpoint, region: env.s3Region, accessKey: env.s3AccessKey, secretKey: env.s3SecretKey });
const storage = createS3ObjectStorage({ client: s3 as never, presignClient: s3Presign as never, bucket: env.s3Bucket });
const authService = createAuthService({
  repositories,
  verificationBaseUrl: env.verificationBaseUrl,
  mailer: {
    async sendRegistrationCode(input) {
      const response = await fetch(env.mailApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: "no-reply@videoanalyze.local", Name: "videoanalyze" },
          To: [{ Email: input.email }],
          Subject: "验证你的 videoanalyze 注册验证码",
          Text: `你的注册验证码是：${input.code}\n验证码 10 分钟内有效。`
        })
      });
      if (!response.ok) throw new Error("registration code email delivery failed");
    },
    async sendVerification(input) {
      const response = await fetch(env.mailApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: "no-reply@videoanalyze.local", Name: "videoanalyze" },
          To: [{ Email: input.email }],
          Subject: "验证你的 videoanalyze 账号",
          Text: `请打开以下链接完成邮箱验证：${input.link}`
        })
      });
      if (!response.ok) throw new Error("verification email delivery failed");
    },
    async sendPasswordReset(input) {
      const response = await fetch(env.mailApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: "no-reply@videoanalyze.local", Name: "videoanalyze" },
          To: [{ Email: input.email }],
          Subject: "重置你的 videoanalyze 密码",
          Text: `请打开以下链接设置新密码：${input.link}`
        })
      });
      if (!response.ok) throw new Error("password reset email delivery failed");
    }
  }
});
const redisConnection = redisConnectionFromUrl(env.redisUrl);
const queue = new Queue("video-analysis", { connection: redisConnection });
const resultService = createResultService({ repository: repositories.results });
const app = buildApp({
  authService,
  secureCookies: env.nodeEnv === "production",
  uploadService: createUploadService({ transientMedia: repositories.transientMedia, storage, maxBytes: env.maxUploadBytes, maxDurationSeconds: env.maxVideoDurationSeconds, transientCapacityBytes: env.transientCapacityBytes }),
  analysisService: createAnalysisService({ videos: repositories.videos, credits: repositories.credits, runs: repositories.runs, queue }),
  resultService,
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
