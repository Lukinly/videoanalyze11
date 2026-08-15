import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { createResultRepository } from "./result-repository.js";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();
const now = new Date("2026-08-15T12:00:00.000Z");

describe("result repository", () => {
  beforeAll(async () => {
    const { migrateTestDatabase } = await import("../db/test-database.js");
    await migrateTestDatabase(pool);
  });
  beforeEach(async () => {
    for (const table of ["ephemeral_chapters", "ephemeral_run_summaries", "ephemeral_transcript_segments", "chapters", "transcript_segments", "chunks", "credit_reservations", "analysis_runs", "videos", "users"]) await pool.query(`DELETE FROM ${table}`);
  });
  afterAll(() => pool.end());

  it("lists and reads only owned runs, including privacy bodies before expiry", async () => {
    await seedRun({ userId: "u1", runId: "r1", mode: "privacy" });
    await pool.query("INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES ('u2','u2@example.com','x',$1,$1)", [now]);
    await pool.query("INSERT INTO ephemeral_transcript_segments (id,user_id,run_id,start_seconds,end_seconds,text,expires_at) VALUES ('s1','u1','r1',0,2,'private',$1)", [new Date("2026-08-16T12:00:00.000Z")]);
    const repository = createResultRepository(pool);

    await expect(repository.listOwned("u2", 50)).resolves.toEqual([]);
    await expect(repository.findOwnedMetadata("u2", "r1")).resolves.toBeNull();
    await expect(repository.loadOwnedContent("u1", "r1", "privacy")).resolves.toMatchObject({ transcript: { segments: [{ text: "private" }] } });
  });

  it("atomically deletes all result bodies while retaining audit and billing rows", async () => {
    await seedRun({ userId: "u1", runId: "r1", mode: "standard", originalDeleted: true });
    await pool.query("INSERT INTO transcript_segments (id,user_id,run_id,start_seconds,end_seconds,text) VALUES ('s1','u1','r1',0,2,'body')");
    await pool.query("INSERT INTO chapters (id,user_id,run_id,title,start_seconds,end_seconds,summary,bullets_json,source_segment_ids_json,alignment_warning) VALUES ('c1','u1','r1','t',0,2,'body','[]','[]',false)");
    await pool.query("INSERT INTO chunks (id,user_id,run_id,chunk_index,start_seconds,end_seconds,object_key,status,transcript_json,transcript_object_key,error) VALUES ('k1','u1','r1',0,0,2,'k','completed','[{\"text\":\"body\"}]','tk','body')");
    await pool.query("INSERT INTO credit_reservations (id,user_id,run_id,amount,status,idempotency_key,created_at) VALUES ('cr1','u1','r1',60,'consumed','ik',$1)", [now]);
    const repository = createResultRepository(pool);

    await expect(repository.deleteOwnedResults("u1", "r1", now)).resolves.toBe(true);

    expect((await pool.query("SELECT status, display_name, summary_json, results_deleted_at FROM analysis_runs WHERE id='r1'")).rows[0]).toMatchObject({ status: "completed", display_name: "已删除的视频", summary_json: null, results_deleted_at: now });
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM transcript_segments WHERE run_id='r1'")).rows[0].count).toBe(0);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM chapters WHERE run_id='r1'")).rows[0].count).toBe(0);
    expect((await pool.query("SELECT transcript_json, transcript_object_key, error FROM chunks WHERE run_id='r1'")).rows[0]).toEqual({ transcript_json: null, transcript_object_key: null, error: null });
    expect((await pool.query("SELECT status FROM credit_reservations WHERE run_id='r1'")).rows[0].status).toBe("consumed");
    expect((await pool.query("SELECT file_name FROM videos WHERE id='v1'")).rows[0].file_name).toBe("已删除的视频");
    await expect(repository.findOwnedMetadata("u1", "r1")).resolves.toMatchObject({ id: "r1", status: "completed", duration: 120, billedCredits: 60 });
  });

  it("keeps the shared video label while another available result still needs it", async () => {
    await seedRun({ userId: "u1", runId: "r1", mode: "standard", originalDeleted: true });
    await pool.query("INSERT INTO analysis_runs (id,user_id,video_id,display_name,retention_mode,stage,status,progress,created_at,updated_at) VALUES ('r2','u1','v1','clip.mp4','standard','completed','completed',1,$1,$1)", [now]);
    const repository = createResultRepository(pool);

    await repository.deleteOwnedResults("u1", "r1", now);

    expect((await pool.query("SELECT file_name FROM videos WHERE id='v1'")).rows[0].file_name).toBe("clip.mp4");
  });

  it("does not report held credits as billed history", async () => {
    await seedRun({ userId: "u1", runId: "r1", mode: "standard" });
    await pool.query("INSERT INTO credit_reservations (id,user_id,run_id,amount,status,idempotency_key,created_at) VALUES ('cr1','u1','r1',95,'held','ik',$1)", [now]);

    await expect(createResultRepository(pool).findOwnedMetadata("u1", "r1")).resolves.toMatchObject({ billedCredits: null });
  });
});

async function seedRun(input: { userId: string; runId: string; mode: "standard" | "privacy"; originalDeleted?: boolean }) {
  await pool.query("INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES ($1,$2,'x',$3,$3)", [input.userId, `${input.userId}@example.com`, now]);
  await pool.query("INSERT INTO videos (id,user_id,object_key,file_name,file_size,duration,status,original_deleted_at,created_at,updated_at) VALUES ('v1',$1,'key','clip.mp4',100,120,'missing',$2,$3,$3)", [input.userId, input.originalDeleted ? now : null, now]);
  await pool.query("INSERT INTO analysis_runs (id,user_id,video_id,display_name,retention_mode,result_expires_at,stage,status,progress,summary_json,created_at,updated_at) VALUES ($1,$2,'v1','clip.mp4',$3,$4,'completed','completed',1,'{\"oneLineSummary\":\"one\",\"overallSummary\":\"all\"}',$5,$5)", [input.runId, input.userId, input.mode, input.mode === "privacy" ? new Date("2026-08-16T12:00:00.000Z") : null, now]);
}
