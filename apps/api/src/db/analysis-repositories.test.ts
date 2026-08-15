import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { createRepositories } from "./repositories/index.js";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();

describe("analysis run repository", () => {
  let repositories: Awaited<ReturnType<typeof createRepositories>>;

  beforeAll(async () => {
    const { migrateTestDatabase } = await import("./test-database.js");
    const { createRepositories } = await import("./repositories/index.js");
    await migrateTestDatabase(pool);
    repositories = createRepositories(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM analysis_runs");
    await pool.query("DELETE FROM videos");
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns a run only to its owner and updates cancellation state", async () => {
    const user = await repositories.users.create({ email: "owner@example.com", passwordHash: "hash" });
    const other = await repositories.users.create({ email: "other@example.com", passwordHash: "hash" });
    const video = await repositories.videos.create({ userId: user.id, objectKey: "users/u/video", fileName: "video.mp4" });
    const run = await repositories.runs.create({ id: "run_1", userId: user.id, videoId: video.id });

    expect(await repositories.runs.findOwnedById(other.id, run.id)).toBeNull();
    expect(await repositories.runs.requestCancellation(user.id, run.id)).toMatchObject({ status: "cancelling" });
  });

  it("reports chunk totals and completed chunks while a run is processing", async () => {
    const user = await repositories.users.create({ email: "chunks@example.com", passwordHash: "hash" });
    const video = await repositories.videos.create({ userId: user.id, objectKey: "users/chunks/video", fileName: "video.mp4" });
    const run = await repositories.runs.create({ id: "run_chunks", userId: user.id, videoId: video.id });

    await pool.query(
      `INSERT INTO chunks (id, user_id, run_id, chunk_index, start_seconds, end_seconds, object_key, status)
       VALUES ('chunk_0', $1, $2, 0, 0, 10, 'users/chunks/run/chunk_0.flac', 'completed'),
              ('chunk_1', $1, $2, 1, 10, 20, 'users/chunks/run/chunk_1.flac', 'processing')`,
      [user.id, run.id]
    );

    expect(await repositories.runs.findOwnedById(user.id, run.id)).toMatchObject({ totalChunks: 2, completedChunks: 1 });
  });

  it("assembles transcript and summary results for a completed run", async () => {
    const user = await repositories.users.create({ email: "results@example.com", passwordHash: "hash" });
    const video = await repositories.videos.create({ userId: user.id, objectKey: "users/results/video", fileName: "video.mp4" });
    const run = await repositories.runs.create({ id: "run_results", userId: user.id, videoId: video.id });

    await pool.query(
      `INSERT INTO transcript_segments (id, user_id, run_id, start_seconds, end_seconds, text) VALUES
       ('run_results_seg_1', $1, $2, 0, 5, 'hello'),
       ('run_results_seg_2', $1, $2, 5, 10, 'world')`,
      [user.id, run.id]
    );
    await pool.query(
      `INSERT INTO chapters (id, user_id, run_id, title, start_seconds, end_seconds, summary, bullets_json, source_segment_ids_json, alignment_warning)
       VALUES ('ch1', $1, $2, '开场', 0, 5, '简介', '[]', '["run_results_seg_1"]', true)`,
      [user.id, run.id]
    );
    await pool.query(
      `UPDATE analysis_runs SET summary_json = $2, stage = 'completed', status = 'completed', progress = 1 WHERE id = $1`,
      [run.id, JSON.stringify({ oneLineSummary: "一句话", overallSummary: "整体" })]
    );

    const result = await repositories.runs.findOwnedById(user.id, run.id);
    expect(result?.transcript?.segments).toHaveLength(2);
    expect(result?.transcript?.segments[0]).toMatchObject({ id: "run_results_seg_1", runId: run.id, start: 0, end: 5, text: "hello" });
    expect(result?.summary).toMatchObject({
      oneLineSummary: "一句话",
      overallSummary: "整体",
      chapters: [{ id: "ch1", title: "开场", start: 0, end: 5, sourceSegmentIds: ["run_results_seg_1"], alignmentWarning: true }]
    });
  });

  it("does not assemble expired privacy bodies while cleanup is pending", async () => {
    const user = await repositories.users.create({ email: "expired@example.com", passwordHash: "hash" });
    const video = await repositories.videos.create({ userId: user.id, objectKey: "users/expired/video", fileName: "video.mp4" });
    const run = await repositories.runs.create({ id: "run_expired", userId: user.id, videoId: video.id, retentionMode: "privacy" });
    await pool.query("UPDATE analysis_runs SET status = 'completed', stage = 'completed', result_expires_at = $2 WHERE id = $1", [run.id, new Date("2026-08-14T00:00:00.000Z")]);
    await pool.query("INSERT INTO ephemeral_transcript_segments (id,user_id,run_id,start_seconds,end_seconds,text) VALUES ('private_seg',$1,$2,0,1,'must not load')", [user.id, run.id]);

    const result = await repositories.runs.findOwnedById(user.id, run.id);

    expect(result).toMatchObject({ id: run.id, status: "completed" });
    expect(result?.transcript).toBeUndefined();
  });
});
