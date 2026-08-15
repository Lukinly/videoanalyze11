import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import type { Pool as PgPool } from "pg";
import { cleanupRunMedia, createMediaCleanupRepository, removeValidatedRunDirectory } from "./media-cleanup.js";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool() as unknown as PgPool;
const now = new Date("2026-08-15T04:05:06.789Z");

describe("terminal media cleanup", () => {
  beforeAll(async () => {
    for (const statement of schema) await pool.query(statement);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM transcript_segments");
    await pool.query("DELETE FROM transient_objects");
    await pool.query("DELETE FROM analysis_runs");
    await pool.query("DELETE FROM videos");
    await seedCompletedRun();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("deletes an original once, records completion, and preserves result rows", async () => {
    const storage = { delete: vi.fn().mockResolvedValue(undefined) };
    const repository = createMediaCleanupRepository(pool);

    await expect(cleanupRunMedia({ runId: "run_1", storage, repository, now })).resolves.toEqual({ status: "complete" });
    await expect(cleanupRunMedia({ runId: "run_1", storage, repository, now })).resolves.toEqual({ status: "complete" });

    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith("users/user_1/videos/video_1/original.mp4");
    expect(await runState()).toEqual({ analysisStatus: "completed", cleanupStatus: "cleaned", attempts: 1, cleanupError: null, cleanedAt: now });
    expect(await videoState()).toEqual({ status: "missing", originalDeletedAt: now });
    expect(await transientState()).toEqual({ deletedAt: now, cleanupAttempts: 0, lastCleanupError: null });
    expect((await pool.query("SELECT text FROM transcript_segments WHERE run_id = 'run_1'")).rows).toEqual([{ text: "durable result" }]);
  });

  it("treats an object-store not-found response as successful cleanup", async () => {
    const missing = Object.assign(new Error("gone"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    const storage = { delete: vi.fn().mockRejectedValue(missing) };

    await expect(cleanupRunMedia({ runId: "run_1", storage, repository: createMediaCleanupRepository(pool), now })).resolves.toEqual({ status: "complete" });

    expect(await runState()).toMatchObject({ analysisStatus: "completed", cleanupStatus: "cleaned", cleanupError: null });
    expect(await videoState()).toEqual({ status: "missing", originalDeletedAt: now });
    expect(await transientState()).toMatchObject({ deletedAt: now, lastCleanupError: null });
  });

  it("records retry state after object-store failure without changing a completed run", async () => {
    const storage = { delete: vi.fn().mockRejectedValue(new Error("temporary S3 failure")) };

    await expect(cleanupRunMedia({ runId: "run_1", storage, repository: createMediaCleanupRepository(pool), now })).resolves.toEqual({ status: "retry" });

    expect(await runState()).toEqual({ analysisStatus: "completed", cleanupStatus: "failed", attempts: 1, cleanupError: "temporary S3 failure", cleanedAt: null });
    expect(await videoState()).toEqual({ status: "available", originalDeletedAt: null });
    expect(await transientState()).toEqual({ deletedAt: null, cleanupAttempts: 1, lastCleanupError: "temporary S3 failure" });
  });
});

describe("validated local media cleanup", () => {
  it("recursively removes only the exact run directory", async () => {
    const runId = randomUUID();
    const directory = join("/tmp/videoanalyze", runId);
    await mkdir(join(directory, "nested"), { recursive: true });
    await writeFile(join(directory, "nested", "media.flac"), "test fixture");

    await removeValidatedRunDirectory(runId);

    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["", ".", "..", "../videoanalyze", "run/child", "/tmp/videoanalyze/run_1"])("rejects unsafe run id %j before recursive removal", async (runId) => {
    await expect(removeValidatedRunDirectory(runId)).rejects.toThrow("unsafe run id");
  });
});

async function seedCompletedRun() {
  await pool.query(
    `INSERT INTO videos (id, object_key, status, updated_at)
     VALUES ('video_1', 'users/user_1/videos/video_1/original.mp4', 'available', $1)`,
    [new Date("2026-08-15T00:00:00.000Z")]
  );
  await pool.query(
    `INSERT INTO analysis_runs (id, video_id, status, media_cleanup_status, media_cleanup_attempts)
     VALUES ('run_1', 'video_1', 'completed', 'pending', 0)`
  );
  await pool.query(
    `INSERT INTO transient_objects (id, video_id, object_key, kind)
     VALUES ('object_1', 'video_1', 'users/user_1/videos/video_1/original.mp4', 'original')`
  );
  await pool.query("INSERT INTO transcript_segments (id, run_id, text) VALUES ('segment_1', 'run_1', 'durable result')");
}

async function runState() {
  const result = await pool.query<{
    analysisStatus: string;
    cleanupStatus: string;
    attempts: number;
    cleanupError: string | null;
    cleanedAt: Date | null;
  }>(
    `SELECT status AS "analysisStatus", media_cleanup_status AS "cleanupStatus",
       media_cleanup_attempts AS attempts, media_cleanup_error AS "cleanupError", media_cleaned_at AS "cleanedAt"
     FROM analysis_runs WHERE id = 'run_1'`
  );
  return result.rows[0];
}

async function videoState() {
  const result = await pool.query<{ status: string; originalDeletedAt: Date | null }>(
    `SELECT status, original_deleted_at AS "originalDeletedAt" FROM videos WHERE id = 'video_1'`
  );
  return result.rows[0];
}

async function transientState() {
  const result = await pool.query<{ deletedAt: Date | null; cleanupAttempts: number; lastCleanupError: string | null }>(
    `SELECT deleted_at AS "deletedAt", cleanup_attempts AS "cleanupAttempts", last_cleanup_error AS "lastCleanupError"
     FROM transient_objects WHERE id = 'object_1'`
  );
  return result.rows[0];
}

const schema = [
  `CREATE TABLE videos (
    id TEXT PRIMARY KEY, object_key TEXT NOT NULL, status TEXT NOT NULL,
    original_deleted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE analysis_runs (
    id TEXT PRIMARY KEY, video_id TEXT NOT NULL, status TEXT NOT NULL,
    media_cleanup_status TEXT NOT NULL, media_cleanup_attempts INTEGER NOT NULL,
    media_cleanup_error TEXT, media_cleaned_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
  )`,
  `CREATE TABLE transient_objects (
    id TEXT PRIMARY KEY, video_id TEXT, object_key TEXT NOT NULL, kind TEXT NOT NULL,
    deleted_at TIMESTAMPTZ, cleanup_attempts INTEGER NOT NULL DEFAULT 0, last_cleanup_error TEXT
  )`,
  "CREATE TABLE transcript_segments (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, text TEXT NOT NULL)"
];
