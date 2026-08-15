import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { createWorkerCreditRepository } from "../credits/credit-repository.js";
import { cleanupRunMedia, createMediaCleanupRepository } from "./media-cleanup.js";
import { runRetentionSweep } from "./cleanup-worker.js";
import { createRetentionRepository } from "./retention-repository.js";

export async function runRetentionOnce() {
  const databaseUrl = required("DATABASE_URL");
  const bucket = required("S3_BUCKET");
  const pool = new Pool({ connectionString: databaseUrl });
  const s3 = new S3Client({
    endpoint: required("S3_ENDPOINT"), region: process.env.S3_REGION ?? "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: required("S3_ACCESS_KEY"), secretAccessKey: required("S3_SECRET_KEY") }
  });
  const storage = { delete: async (key: string) => { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); } };
  const mediaRepository = createMediaCleanupRepository(pool);
  const now = new Date();
  try {
    const report = await runRetentionSweep({
      now,
      repository: createRetentionRepository(pool),
      storage,
      credits: createWorkerCreditRepository(pool),
      cleanupTerminalRun: (runId, cleanupNow) => cleanupRunMedia({ runId, now: cleanupNow, storage, repository: mediaRepository })
    });
    console.log(JSON.stringify(report));
    return report;
  } finally {
    s3.destroy();
    await pool.end();
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1]?.endsWith("/retention/run-once.js")) {
  runRetentionOnce().catch(() => { console.error("retention sweep failed"); process.exitCode = 1; });
}
