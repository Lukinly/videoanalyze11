import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "../../apps/api/src/db/migrate.js";
import { createDatabaseState } from "../../apps/worker/src/analysis/database-state.js";
import { createWorkerCreditRepository } from "../../apps/worker/src/credits/credit-repository.js";
import { createMediaProcessor } from "../../apps/worker/src/media/media-processor.js";
import { createResultStore } from "../../apps/worker/src/results/result-store.js";
import { createV0AnalysisRunner } from "../../apps/worker/src/analysis/v0-runner.js";
import { createV1SummaryRunner } from "../../apps/worker/src/summary/v1-runner.js";
import { createNotesRunner } from "../../apps/worker/src/notes/notes-runner.js";
import { cleanupRunMedia, createMediaCleanupRepository } from "../../apps/worker/src/retention/media-cleanup.js";

// Explicit opt-in: use an isolated schema and remove only that schema afterward.
// AI responses are fixtures; PostgreSQL, SQL migrations and FFmpeg are real.
describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL analysis pipeline", () => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  let directory: string;
  let fixture: string;
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await migrateDatabase(pool, fileURLToPath(new URL("../../apps/api/src/db/migrations", import.meta.url)));
    directory = await mkdtemp(join(tmpdir(), "postgres-pipeline-"));
    fixture = join(directory, "fixture.mp4");
    await promisify(execFile)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", fixture]);
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it.each(["standard", "privacy"] as const)("processes a new %s upload with the actual migration constraints", async (mode) => {
    const userId = randomUUID();
    const videoId = randomUUID();
    const runId = randomUUID();
    const now = new Date();
    const runDirectory = join(directory, runId);
    await pool.query("INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES ($1,$2,'fixture',$3,$3)", [userId, `${userId}@example.test`, now]);
    await pool.query("INSERT INTO videos (id,user_id,object_key,file_name,file_size,created_at,updated_at) VALUES ($1,$2,$3,'fixture.mp4',1,$4,$4)", [videoId, userId, `test/${videoId}`, now]);
    await pool.query("INSERT INTO analysis_runs (id,user_id,video_id,retention_mode,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [runId, userId, videoId, mode, now]);
    await pool.query("INSERT INTO credit_ledger (id,user_id,amount,type,idempotency_key,reason,created_at) VALUES ($1,$2,12,'welcome_grant',$1,'fixture',$3)", [randomUUID(), userId, now]);
    const credits = createWorkerCreditRepository(pool);
    const media = createMediaProcessor({});
    const state = createDatabaseState({ pool, s3: { send: async () => ({ Body: createReadStream(fixture) }) } as unknown as S3Client, bucket: "fixture", directory: runDirectory, media, results: createResultStore(pool), credits, clock: { now: () => now } });
    const source = await state.getSourceInfo(runId);
    expect(source.remote).toBeNull();
    expect(source.duration).toBeGreaterThan(0);
    await createV0AnalysisRunner({ state, media, asr: { transcribeChunk: async () => ({ segments: [{ start: 0, end: 1, text: "Runtime verification transcript." }] }) } }).run({ userId, videoId, runId, signal: new AbortController().signal });
    const capabilities = async () => ({ contextWindow: 128000, structuredOutput: true });
    await createV1SummaryRunner({ state, summary: { capabilities, summarize: async () => ({ oneLineSummary: "Fixture", overallSummary: "Fixture summary", chapters: [{ id: "c1", title: "Fixture", summary: "Content", sourceSegmentIds: ["seg_1"], bullets: [{ text: "Point", sourceSegmentIds: ["seg_1"] }] }] }) } }).run({ runId });
    await createNotesRunner({ state, notes: { capabilities, generateNotes: async () => ({ title: "Fixture notes", topic: "Fixture", coreIdeas: ["Idea"], reviewPoints: ["Review"], sections: [{ id: "s1", level: 1, title: "Section", body: "Content", citations: [{ segmentId: "seg_1", timestampSeconds: 0 }] }] }) } }).run({ runId });
    expect(await state.markCompleted(runId)).toBe(true);
    await credits.consumeReservation(runId);
    await credits.consumeReservation(runId);
    const run = (await pool.query("SELECT * FROM analysis_runs WHERE id = $1", [runId])).rows[0];
    expect(run.status).toBe("completed");
    expect(run.billing_rule_version).toBe("duration-tiered-v2");
    const charges = await pool.query("SELECT amount FROM credit_ledger WHERE reference_id = $1 AND type = 'analysis_charge'", [runId]);
    expect(charges.rows).toEqual([{ amount: -run.reserved_credits }]);
    await expect(pool.query("UPDATE analysis_runs SET reserved_credits = reserved_credits + 1 WHERE id = $1", [runId])).rejects.toThrow("immutable");
    const notesTable = mode === "privacy" ? "ephemeral_ai_notes" : "ai_notes";
    const saved = (await pool.query(`SELECT * FROM ${notesTable} WHERE run_id = $1`, [runId])).rows[0];
    expect(saved.notes_json.sections[0].citations[0].segmentId).toBe(`${runId}_seg_1`);
    if (mode === "privacy") {
      expect(saved.expires_at.getTime()).toBe(now.getTime() + 86400000);
      expect((await pool.query("SELECT * FROM ai_notes WHERE run_id = $1", [runId])).rowCount).toBe(0);
    }
    const remove = vi.fn(async () => { await rm(runDirectory, { recursive: true, force: true }); });
    const storage = { delete: vi.fn().mockResolvedValue(undefined) };
    await cleanupRunMedia({ runId, storage, repository: createMediaCleanupRepository(pool), now, leaseDurationMs: 300000, removeLocalMedia: remove });
    expect(storage.delete).toHaveBeenCalledOnce();
    expect((await pool.query(`SELECT * FROM ${notesTable} WHERE run_id = $1`, [runId])).rowCount).toBe(1);
  });
});
