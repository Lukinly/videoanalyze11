import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { createWorkerCreditRepository } from "./credit-repository.js";

const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();
const now = new Date("2026-08-15T12:00:00.000Z");

describe("worker duration billing reservation", () => {
  beforeAll(async () => {
    await pool.query("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, password_hash TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)");
    await pool.query("CREATE TABLE videos (id TEXT PRIMARY KEY, user_id TEXT, object_key TEXT, file_name TEXT, file_size BIGINT, status TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)");
    await pool.query("CREATE TABLE analysis_runs (id TEXT PRIMARY KEY, user_id TEXT, video_id TEXT, stage TEXT, status TEXT, progress REAL, billing_rule_version TEXT, billed_duration_seconds REAL, billed_minutes INTEGER, reserved_credits INTEGER, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)");
    await pool.query("CREATE TABLE credit_ledger (id TEXT PRIMARY KEY, user_id TEXT, amount INTEGER, type TEXT, idempotency_key TEXT UNIQUE, reason TEXT, created_at TIMESTAMPTZ)");
    await pool.query("CREATE TABLE credit_reservations (id TEXT PRIMARY KEY, user_id TEXT, run_id TEXT UNIQUE, amount INTEGER, status TEXT, idempotency_key TEXT UNIQUE, created_at TIMESTAMPTZ, consumed_at TIMESTAMPTZ, released_at TIMESTAMPTZ, release_reason TEXT)");
  });
  beforeEach(async () => {
    for (const table of ["credit_reservations", "credit_ledger", "analysis_runs", "videos", "users"]) await pool.query(`DELETE FROM ${table}`);
    await pool.query("INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES ('u1','u1@example.test','x',$1,$1)", [now]);
    await pool.query("INSERT INTO videos (id,user_id,object_key,file_name,file_size,status,created_at,updated_at) VALUES ('v1','u1','key','clip.mp4',100,'available',$1,$1)", [now]);
    await pool.query("INSERT INTO analysis_runs (id,user_id,video_id,stage,status,progress,created_at,updated_at) VALUES ('r1','u1','v1','probing','running',0.02,$1,$1)", [now]);
  });
  afterAll(() => pool.end());

  it("stores and reuses one exact immutable snapshot and reservation", async () => {
    await grant(500);
    const repository = createWorkerCreditRepository(pool);

    const first = await repository.reserveForDuration({ runId: "r1", userId: "u1", durationSeconds: 90 * 60 });
    const retry = await repository.reserveForDuration({ runId: "r1", userId: "u1", durationSeconds: 90 * 60 });

    expect(first).toEqual({ billingRuleVersion: "duration-tiered-v2", billedDurationSeconds: 5_400, billedMinutes: 90, reservedCredits: 95 });
    expect(retry).toEqual(first);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM credit_reservations WHERE run_id='r1'")).rows[0].count).toBe(1);
    expect((await pool.query("SELECT billing_rule_version, billed_duration_seconds, billed_minutes, reserved_credits FROM analysis_runs WHERE id='r1'")).rows[0]).toEqual({
      billing_rule_version: "duration-tiered-v2", billed_duration_seconds: 5_400, billed_minutes: 90, reserved_credits: 95
    });
  });

  it("does not snapshot or reserve when the exact balance is insufficient", async () => {
    await grant(94);
    const result = await createWorkerCreditRepository(pool).reserveForDuration({ runId: "r1", userId: "u1", durationSeconds: 90 * 60 });
    expect(result).toBe("exhausted");
    expect((await pool.query("SELECT billing_rule_version FROM analysis_runs WHERE id='r1'")).rows[0].billing_rule_version).toBeNull();
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM credit_reservations")).rows[0].count).toBe(0);
  });

  it("rejects a duration above four hours without reserving", async () => {
    await grant(500);
    await expect(createWorkerCreditRepository(pool).reserveForDuration({ runId: "r1", userId: "u1", durationSeconds: 14_401 })).rejects.toThrow(/duration/i);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM credit_reservations")).rows[0].count).toBe(0);
  });
});

async function grant(amount: number) {
  await pool.query("INSERT INTO credit_ledger (id,user_id,amount,type,idempotency_key,reason,created_at) VALUES ('grant','u1',$1,'welcome_grant','grant','test',$2)", [amount, now]);
}
