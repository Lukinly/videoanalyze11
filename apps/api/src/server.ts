import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { Queue } from "bullmq";
import { buildApp } from "./app.js";
import { createAnalysisService } from "./analysis/analysis-service.js";
import { createAuthService } from "./auth/auth-service.js";
import { parseEnv } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createRepositories } from "./db/repositories/index.js";
import { createSearchService } from "./search/search-service.js";
import { createS3ObjectStorage } from "./storage/s3-storage.js";
import { createUploadService } from "./storage/upload-service.js";
import { DomainError } from "@videoanalyze/domain";

const env = parseEnv();
const { pool } = createDatabase(env.databaseUrl);
const repositories = createRepositories(pool);
const s3 = new S3Client({
  endpoint: env.s3Endpoint,
  region: env.s3Region,
  forcePathStyle: true,
  credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey }
});
const storage = createS3ObjectStorage({ client: s3 as never, bucket: env.s3Bucket });
const authService = createAuthService({
  repositories,
  verificationBaseUrl: env.verificationBaseUrl,
  mailer: {
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
    }
  }
});
const redisConnection = redisConnectionFromUrl(env.redisUrl);
const queue = new Queue("video-analysis", { connection: redisConnection });
const app = buildApp({
  authService,
  secureCookies: env.nodeEnv === "production",
  uploadService: createUploadService({ videos: repositories.videos, storage, maxBytes: env.maxUploadBytes, maxDurationSeconds: env.maxVideoDurationSeconds }),
  analysisService: createAnalysisService({ videos: repositories.videos, usage: repositories.usage, runs: repositories.runs, queue }),
  searchService: createSearchService({ search: repositories.search }),
  mediaService: {
    async getPlaybackUrl(input) {
      const video = await repositories.videos.findOwnedById(input.userId, input.videoId);
      if (!video) throw new DomainError("NOT_FOUND", "video not found", 404);
      return storage.getDownloadUrl(video.objectKey, 900);
    }
  },
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
