import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { Pool as PgPool } from "pg";
import type { TranscriptSegment } from "@videoanalyze/domain";
import type { AlignedSummaryResult } from "../summary/v1-runner.js";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool() as unknown as PgPool;

describe("result store", () => {
  beforeAll(async () => {
    for (const statement of schema) await pool.query(statement);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM chunks");
    await pool.query("DELETE FROM ephemeral_ai_notes");
    await pool.query("DELETE FROM ai_notes");
    await pool.query("DELETE FROM ephemeral_chapters");
    await pool.query("DELETE FROM ephemeral_run_summaries");
    await pool.query("DELETE FROM ephemeral_transcript_segments");
    await pool.query("DELETE FROM chapters");
    await pool.query("DELETE FROM transcript_segments");
    await pool.query("DELETE FROM analysis_runs");
    await pool.query("DELETE FROM videos");
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("routes privacy transcripts only to ephemeral storage", async () => {
    const { createResultStore } = await import("./result-store.js");
    await createRun("privacy_run", "privacy");
    const store = createResultStore(pool);

    await store.saveTranscript({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, segments });

    expect(await count("transcript_segments", "privacy_run")).toBe(0);
    expect(await count("ephemeral_transcript_segments", "privacy_run")).toBe(segments.length);
    expect((await store.getTranscript("privacy_run")).segments).toEqual(segments);
  });

  it("routes standard transcripts only to ordinary storage", async () => {
    const { createResultStore } = await import("./result-store.js");
    await createRun("standard_run", "standard");
    const store = createResultStore(pool);

    await store.saveTranscript({ runId: "standard_run", userId: "user_1", mode: "standard", expiresAt: null, segments });

    expect(await count("transcript_segments", "standard_run")).toBe(segments.length);
    expect(await count("ephemeral_transcript_segments", "standard_run")).toBe(0);
    expect((await store.getTranscript("standard_run")).segments).toEqual([
      { id: "standard_run_seg_1", runId: "standard_run", start: 0, end: 4, text: "first" },
      { id: "standard_run_seg_2", runId: "standard_run", start: 4, end: 9, text: "second" }
    ]);
  });

  it("keeps privacy summaries and chapter bodies out of ordinary tables", async () => {
    const { createResultStore } = await import("./result-store.js");
    await createRun("privacy_run", "privacy");
    const store = createResultStore(pool);

    await store.saveSummary({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, result: summary });

    const run = await pool.query<{ summaryJson: unknown }>("SELECT summary_json AS \"summaryJson\" FROM analysis_runs WHERE id = $1", ["privacy_run"]);
    expect(run.rows[0]?.summaryJson).toBeNull();
    expect(await count("chapters", "privacy_run")).toBe(0);
    expect(await count("ephemeral_run_summaries", "privacy_run")).toBe(1);
    expect(await count("ephemeral_chapters", "privacy_run")).toBe(summary.chapters.length);
  });

  it("keeps standard summaries and chapter bodies out of ephemeral tables", async () => {
    const { createResultStore } = await import("./result-store.js");
    await createRun("standard_run", "standard");
    const store = createResultStore(pool);

    await store.saveSummary({ runId: "standard_run", userId: "user_1", mode: "standard", expiresAt: null, result: summary });

    const run = await pool.query<{ summaryJson: { oneLineSummary: string; overallSummary: string } }>("SELECT summary_json AS \"summaryJson\" FROM analysis_runs WHERE id = $1", ["standard_run"]);
    expect(run.rows[0]?.summaryJson).toEqual({ oneLineSummary: "one line", overallSummary: "overall" });
    expect(await count("chapters", "standard_run")).toBe(summary.chapters.length);
    expect(await count("ephemeral_run_summaries", "standard_run")).toBe(0);
    expect(await count("ephemeral_chapters", "standard_run")).toBe(0);
  });

  it.each(["standard", "privacy"] as const)("routes %s AI notes to only the matching storage class", async (mode) => {
    const { createResultStore } = await import("./result-store.js");
    const runId = `${mode}_run`;
    await createRun(runId, mode);
    const store = createResultStore(pool);

    await store.saveNotes({ runId, userId: "user_1", mode, expiresAt: null, notes });

    expect(await count("ai_notes", runId)).toBe(mode === "standard" ? 1 : 0);
    expect(await count("ephemeral_ai_notes", runId)).toBe(mode === "privacy" ? 1 : 0);
  });

  it("sets one exact privacy expiry on the run and every ephemeral result row", async () => {
    const { createResultStore } = await import("./result-store.js");
    await createRun("privacy_run", "privacy");
    const store = createResultStore(pool);
    await store.saveTranscript({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, segments });
    await store.saveSummary({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, result: summary });
    const expiresAt = new Date("2026-08-16T03:04:05.678Z");

    await store.finalizePrivacyExpiry("privacy_run", expiresAt);

    for (const table of ["analysis_runs", "ephemeral_transcript_segments", "ephemeral_run_summaries", "ephemeral_chapters"]) {
      const column = table === "analysis_runs" ? "result_expires_at" : "expires_at";
      const rows = await pool.query<{ expiresAt: Date }>(`SELECT ${column} AS "expiresAt" FROM ${table} WHERE ${table === "analysis_runs" ? "id" : "run_id"} = $1`, ["privacy_run"]);
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(rows.rows.every((row) => row.expiresAt.toISOString() === "2026-08-16T03:04:05.678Z")).toBe(true);
    }
  });

  it("derives privacy expiry from the completion instant plus exactly 24 hours", async () => {
    const { privacyResultExpiry } = await import("./result-store.js");

    const expiresAt = privacyResultExpiry(new Date("2026-08-15T03:04:05.678Z"));

    expect(expiresAt.toISOString()).toBe("2026-08-16T03:04:05.678Z");
  });

  it("replaces retry output transactionally and clears chunk bodies only after a durable merge", async () => {
    const { createResultStore } = await import("./result-store.js");
    await createRun("privacy_run", "privacy");
    const store = createResultStore(pool);
    await store.saveTranscript({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, segments: [segments[0]] });
    await insertContentBearingChunk("privacy_run");
    const invalid = [{ ...segments[1], text: null }] as unknown as TranscriptSegment[];

    await expect(store.saveTranscript({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, segments: invalid })).rejects.toThrow();
    expect((await store.getTranscript("privacy_run")).segments).toEqual([segments[0]]);
    expect(await chunkPayload("privacy_run")).toEqual({ transcriptJson: [{ text: "sensitive chunk body" }], transcriptObjectKey: "private/transcript.json", error: "provider echoed sensitive chunk body" });

    await store.saveTranscript({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, segments: [segments[1]] });

    expect((await store.getTranscript("privacy_run")).segments).toEqual([
      { id: "privacy_run_seg_1", runId: "privacy_run", start: 4, end: 9, text: "second" }
    ]);
    expect(await count("ephemeral_transcript_segments", "privacy_run")).toBe(1);
    expect(await chunkPayload("privacy_run")).toEqual({ transcriptJson: null, transcriptObjectKey: null, error: null });
  });

  it("replaces prior summary output on retry", async () => {
    const { createResultStore } = await import("./result-store.js");
    await createRun("privacy_run", "privacy");
    const store = createResultStore(pool);
    await store.saveSummary({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, result: summary });
    const retried = { ...summary, oneLineSummary: "replacement", chapters: [{ ...summary.chapters[0], id: "replacement" }] };

    await store.saveSummary({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, result: retried });

    const stored = await pool.query<{ oneLineSummary: string }>("SELECT one_line_summary AS \"oneLineSummary\" FROM ephemeral_run_summaries WHERE run_id = $1", ["privacy_run"]);
    expect(stored.rows).toEqual([{ oneLineSummary: "replacement" }]);
    expect(await count("ephemeral_chapters", "privacy_run")).toBe(1);
  });

  it("rejects transcript, summary, and chunk writes after privacy expiry without resurrecting bodies", async () => {
    const { createResultStore } = await import("./result-store.js");
    await createRun("privacy_run", "privacy");
    const store = createResultStore(pool);
    await pool.query("UPDATE analysis_runs SET status = 'completed', results_deleted_at = $2 WHERE id = $1", ["privacy_run", new Date()]);
    await insertContentBearingChunk("privacy_run");
    await pool.query("UPDATE chunks SET transcript_json = NULL, transcript_object_key = NULL, error = NULL WHERE run_id = 'privacy_run'");

    await expect(store.saveTranscript({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, segments })).rejects.toThrow("not writable");
    await expect(store.saveSummary({ runId: "privacy_run", userId: "user_1", mode: "privacy", expiresAt: null, result: summary })).rejects.toThrow("not writable");
    await expect(store.saveChunkTranscript("privacy_run", 0, [{ text: "late body" }])).rejects.toThrow("not writable");
    expect(await count("ephemeral_transcript_segments", "privacy_run")).toBe(0);
    expect(await count("ephemeral_run_summaries", "privacy_run")).toBe(0);
    expect(await chunkPayload("privacy_run")).toEqual({ transcriptJson: null, transcriptObjectKey: null, error: null });
  });

  it("rejects result writes after a stale run is failed and refunded", async () => {
    const { createResultStore } = await import("./result-store.js");
    await createRun("standard_run", "standard");
    await pool.query("UPDATE analysis_runs SET status = 'failed' WHERE id = 'standard_run'");
    const store = createResultStore(pool);
    await expect(store.saveTranscript({ runId: "standard_run", userId: "user_1", mode: "standard", expiresAt: null, segments })).rejects.toThrow("not writable");
    expect(await count("transcript_segments", "standard_run")).toBe(0);
  });

  it("cannot transition a sweep-failed refunded run back to completed", async () => {
    const { createResultStore } = await import("./result-store.js");
    await createRun("standard_run", "standard");
    await pool.query("UPDATE analysis_runs SET status = 'failed' WHERE id = 'standard_run'");
    const store = createResultStore(pool);
    await expect(store.updateStage("standard_run", "completed", 1, new Date())).resolves.toBe(false);
    const run = await pool.query<{ status: string }>("SELECT status FROM analysis_runs WHERE id = 'standard_run'");
    expect(run.rows[0]?.status).toBe("failed");
  });
});

const segments: TranscriptSegment[] = [
  { id: "privacy_run_seg_1", runId: "privacy_run", start: 0, end: 4, text: "first" },
  { id: "privacy_run_seg_2", runId: "privacy_run", start: 4, end: 9, text: "second" }
];

const summary: AlignedSummaryResult = {
  oneLineSummary: "one line",
  overallSummary: "overall",
  chapters: [{
    id: "ch1",
    title: "chapter",
    sourceSegmentIds: ["privacy_run_seg_1"],
    summary: "chapter body",
    bullets: [{ text: "bullet body", sourceSegmentIds: ["privacy_run_seg_1"] }],
    start: 0,
    end: 4,
    alignmentWarning: false
  }]
};

const notes = {
  title: "Detailed notes", topic: "Topic", coreIdeas: ["Idea"], reviewPoints: ["Review"],
  sections: [{ id: "s1", level: 1 as const, title: "Section", body: "Body", citations: [{ segmentId: "privacy_run_seg_1", timestampSeconds: 0 }] }]
};

async function createRun(runId: string, mode: "standard" | "privacy") {
  await pool.query("INSERT INTO users (id) VALUES ('user_1') ON CONFLICT (id) DO NOTHING");
  await pool.query("INSERT INTO videos (id, user_id, duration) VALUES ('video_1', 'user_1', 9) ON CONFLICT (id) DO NOTHING");
  await pool.query(
    "INSERT INTO analysis_runs (id, user_id, video_id, retention_mode, summary_json, status) VALUES ($1, 'user_1', 'video_1', $2, NULL, 'running')",
    [runId, mode]
  );
}

async function count(table: string, runId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table} WHERE run_id = $1`, [runId]);
  return result.rows[0]?.count ?? 0;
}

async function insertContentBearingChunk(runId: string) {
  await pool.query(
    `INSERT INTO chunks (id, user_id, run_id, chunk_index, transcript_json, transcript_object_key, error)
     VALUES ('chunk_1', 'user_1', $1, 0, $2, 'private/transcript.json', 'provider echoed sensitive chunk body')`,
    [runId, JSON.stringify([{ text: "sensitive chunk body" }])]
  );
}

async function chunkPayload(runId: string) {
  const result = await pool.query<{ transcriptJson: unknown; transcriptObjectKey: string | null; error: string | null }>(
    `SELECT transcript_json AS "transcriptJson", transcript_object_key AS "transcriptObjectKey", error
     FROM chunks WHERE run_id = $1`,
    [runId]
  );
  return result.rows[0];
}

const schema = [
  "CREATE TABLE users (id TEXT PRIMARY KEY)",
  "CREATE TABLE videos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, duration REAL)",
  `CREATE TABLE analysis_runs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, video_id TEXT NOT NULL, retention_mode TEXT NOT NULL,
    summary_json JSONB, result_expires_at TIMESTAMPTZ, results_deleted_at TIMESTAMPTZ, status TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'queued', progress REAL NOT NULL DEFAULT 0, heartbeat_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )`,
  `CREATE TABLE transcript_segments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, run_id TEXT NOT NULL,
    start_seconds REAL NOT NULL, end_seconds REAL NOT NULL, text TEXT NOT NULL
  )`,
  `CREATE TABLE ephemeral_transcript_segments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, run_id TEXT NOT NULL,
    start_seconds REAL NOT NULL, end_seconds REAL NOT NULL, text TEXT NOT NULL, expires_at TIMESTAMPTZ
  )`,
  `CREATE TABLE chapters (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, run_id TEXT NOT NULL, title TEXT NOT NULL,
    start_seconds REAL NOT NULL, end_seconds REAL NOT NULL, summary TEXT NOT NULL,
    bullets_json JSONB NOT NULL, source_segment_ids_json JSONB NOT NULL, alignment_warning BOOLEAN NOT NULL
  )`,
  `CREATE TABLE ephemeral_run_summaries (
    run_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, one_line_summary TEXT NOT NULL,
    overall_summary TEXT NOT NULL, expires_at TIMESTAMPTZ
  )`,
  `CREATE TABLE ephemeral_chapters (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, run_id TEXT NOT NULL, title TEXT NOT NULL,
    start_seconds REAL NOT NULL, end_seconds REAL NOT NULL, summary TEXT NOT NULL,
    bullets_json JSONB NOT NULL, source_segment_ids_json JSONB NOT NULL,
    alignment_warning BOOLEAN NOT NULL, expires_at TIMESTAMPTZ
  )`,
  "CREATE TABLE ai_notes (run_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, notes_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL)",
  "CREATE TABLE ephemeral_ai_notes (run_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, notes_json JSONB NOT NULL, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL)",
  `CREATE TABLE chunks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, run_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', retry_count INTEGER NOT NULL DEFAULT 0,
    transcript_json JSONB, transcript_object_key TEXT, error TEXT
  )`
];
