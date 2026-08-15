// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { newDb } from "pg-mem";
import { buildApp } from "../../apps/api/src/app.js";
import { createMediaService } from "../../apps/api/src/routes/media.js";
import { createResultRepository } from "../../apps/api/src/results/result-repository.js";
import { createResultService } from "../../apps/api/src/results/result-service.js";
import { createUploadService } from "../../apps/api/src/storage/upload-service.js";
import { runRetentionSweep } from "../../apps/worker/src/retention/cleanup-worker.js";
import { api, type AnalysisRun } from "../../apps/web/src/api/client.js";
import { ResultActions } from "../../apps/web/src/viewing/ResultActions.js";

const now = new Date("2026-08-15T12:00:00.000Z");
const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
const { Pool } = memoryDb.adapters.createPg();
const pool = new Pool();
const authService = {
  sendRegistrationCode: vi.fn(), register: vi.fn(), verifyEmail: vi.fn(), login: vi.fn(), logout: vi.fn(),
  authenticate: vi.fn().mockResolvedValue({ id: "u1", email: "u1@example.test", emailVerifiedAt: now.toISOString() })
};

describe("transient media and persistent result lifecycle", () => {
  beforeAll(async () => {
    const { migrateTestDatabase } = await import("../../apps/api/src/db/test-database.js");
    await migrateTestDatabase(pool);
  });

  beforeEach(async () => {
    authService.authenticate.mockResolvedValue({ id: "u1", email: "u1@example.test", emailVerifiedAt: now.toISOString() });
    for (const table of ["ephemeral_chapters", "ephemeral_run_summaries", "ephemeral_transcript_segments", "chapters", "transcript_segments", "chunks", "credit_reservations", "analysis_runs", "videos", "users"]) {
      await pool.query(`DELETE FROM ${table}`);
    }
    await seedCompletedRun("standard");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("recovers a standard result from a new client after the uploading client disconnects", async () => {
    const firstClient = buildResultApp();
    await firstClient.ready();
    await firstClient.close();

    const newClient = buildResultApp();
    await newClient.ready();
    const history = await newClient.inject({ method: "GET", url: "/api/analysis-runs", headers: sessionHeaders });
    const detail = await newClient.inject({ method: "GET", url: "/api/analysis-runs/r1", headers: sessionHeaders });
    await newClient.close();

    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({ items: [{ id: "r1", resultAvailability: "available" }] });
    expect(detail.json()).toMatchObject({ id: "r1", transcript: { segments: [{ text: "persistent text" }] } });
  });

  it("keeps terminal text results readable after deleting the original media", async () => {
    await pool.query("UPDATE videos SET original_deleted_at=$1 WHERE id='v1'", [now]);
    const app = buildResultApp();
    await app.ready();

    const result = await app.inject({ method: "GET", url: "/api/analysis-runs/r1", headers: sessionHeaders });
    const playback = await app.inject({ method: "GET", url: "/api/videos/v1/playback-url", headers: sessionHeaders });
    await app.close();

    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ originalDeletedAt: now.toISOString(), resultAvailability: "available" });
    expect(playback.statusCode).toBe(410);
    expect(playback.json()).toMatchObject({ code: "ORIGINAL_DELETED" });
  });

  it("serves privacy results before expiry and returns 410 at the 24-hour boundary", async () => {
    await pool.query("UPDATE analysis_runs SET retention_mode='privacy', result_expires_at=$1, summary_json=NULL WHERE id='r1'", [new Date(now.getTime() + 24 * 60 * 60 * 1000)]);
    await pool.query("DELETE FROM transcript_segments WHERE run_id='r1'");
    await pool.query("INSERT INTO ephemeral_transcript_segments (id,user_id,run_id,start_seconds,end_seconds,text,expires_at) VALUES ('es1','u1','r1',0,2,'private text',$1)", [new Date(now.getTime() + 24 * 60 * 60 * 1000)]);
    let current = now;
    const app = buildResultApp(() => current);
    await app.ready();

    expect((await app.inject({ method: "GET", url: "/api/analysis-runs/r1", headers: sessionHeaders })).statusCode).toBe(200);
    current = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect((await app.inject({ method: "GET", url: "/api/analysis-runs/r1", headers: sessionHeaders })).statusCode).toBe(410);
    await app.close();
  });

  it("permanently deletes result bodies while retaining the consumed credit snapshot", async () => {
    await pool.query("INSERT INTO credit_reservations (id,user_id,run_id,amount,status,idempotency_key,created_at) VALUES ('cr1','u1','r1',60,'consumed','billing:r1',$1)", [now]);
    const app = buildResultApp();
    await app.ready();

    expect((await app.inject({ method: "DELETE", url: "/api/analysis-runs/r1/results", headers: sessionHeaders })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/analysis-runs/r1", headers: sessionHeaders })).statusCode).toBe(410);
    await app.close();

    expect((await pool.query("SELECT status, amount FROM credit_reservations WHERE run_id='r1'")).rows[0]).toEqual({ status: "consumed", amount: 60 });
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM transcript_segments WHERE run_id='r1'")).rows[0].count).toBe(0);
  });

  it("rejects capacity above 80 percent without making history unavailable", async () => {
    const uploadService = createUploadService({
      transientMedia: { getLiveBytes: vi.fn().mockResolvedValue(31), createTrackedOriginal: vi.fn() },
      storage: { createUpload: vi.fn() }, maxBytes: 100, maxDurationSeconds: 7_200, transientCapacityBytes: 40
    });
    const app = buildResultApp(undefined, uploadService);
    await app.ready();

    const upload = await app.inject({ method: "POST", url: "/api/videos/upload-session", headers: sessionHeaders, payload: { fileName: "new.mp4", contentType: "video/mp4", contentLength: 2 } });
    const history = await app.inject({ method: "GET", url: "/api/analysis-runs", headers: sessionHeaders });
    await app.close();

    expect(upload.statusCode).toBe(503);
    expect(upload.json()).toMatchObject({ code: "TEMP_STORAGE_FULL" });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({ items: [{ id: "r1" }] });
  });

  it("isolates repeated cleanup sweeps so already-deleted objects are not retried", async () => {
    const repository = retentionRepositoryDouble();
    repository.claimExpiredTransientObjects
      .mockResolvedValueOnce([{ id: "o1", key: "object", kind: "original", videoId: "v1", claimToken: "claim" }])
      .mockResolvedValueOnce([]);
    const storage = { delete: vi.fn().mockResolvedValue(undefined) };

    const first = await runRetentionSweep({ now, repository, storage, cleanupTerminalRun: vi.fn(), credits: creditsDouble() });
    const second = await runRetentionSweep({ now, repository, storage, cleanupTerminalRun: vi.fn(), credits: creditsDouble() });

    expect(first.transientDeleted).toBe(1);
    expect(second.transientDeleted).toBe(0);
    expect(storage.delete).toHaveBeenCalledOnce();
  });

  it("reattaches a local video without opening an upload session", async () => {
    const createUpload = vi.spyOn(api, "createUploadSession");
    const onAttach = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn().mockReturnValue("blob:local"), revokeObjectURL: vi.fn() });
    render(createElement(ResultActions, { run: runView(), onAttach, inspectLocalFile: vi.fn().mockResolvedValue(120) }));

    const input = screen.getByLabelText("重新选择本地原视频");
    fireEvent.change(input, { target: { files: [new File(["x"], "local.mp4", { type: "video/mp4" })] } });
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith("blob:local", "local.mp4"));
    expect(createUpload).not.toHaveBeenCalled();
  });
});

const sessionHeaders = { cookie: "video_session=session-token" };

function buildResultApp(clock: (() => Date) | undefined = undefined, uploadService?: ReturnType<typeof createUploadService>) {
  const repository = createResultRepository(pool);
  return buildApp({
    authService,
    resultService: createResultService({ repository, ...(clock ? { clock: { now: clock } } : {}) }),
    uploadService,
    mediaService: createMediaService({
      videos: { findOwnedById: async (userId, videoId) => (await pool.query("SELECT object_key AS \"objectKey\", original_deleted_at AS \"originalDeletedAt\" FROM videos WHERE id=$1 AND user_id=$2", [videoId, userId])).rows[0] ?? null },
      storage: { getDownloadUrl: vi.fn().mockResolvedValue("https://storage.localhost/signed") }
    })
  });
}

async function seedCompletedRun(mode: "standard" | "privacy") {
  await pool.query("INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES ('u1','u1@example.test','x',$1,$1)", [now]);
  await pool.query("INSERT INTO videos (id,user_id,object_key,file_name,file_size,duration,status,created_at,updated_at) VALUES ('v1','u1','users/u1/videos/v1/original','clip.mp4',100,120,'available',$1,$1)", [now]);
  await pool.query("INSERT INTO analysis_runs (id,user_id,video_id,display_name,retention_mode,stage,status,progress,summary_json,created_at,updated_at) VALUES ('r1','u1','v1','clip.mp4',$1,'completed','completed',1,'{\"oneLineSummary\":\"one\",\"overallSummary\":\"all\"}',$2,$2)", [mode, now]);
  await pool.query("INSERT INTO transcript_segments (id,user_id,run_id,start_seconds,end_seconds,text) VALUES ('s1','u1','r1',0,2,'persistent text')");
}

function retentionRepositoryDouble() {
  return {
    claimExpiredTransientObjects: vi.fn().mockResolvedValue([]), markTransientObjectDeleted: vi.fn(), recordTransientObjectRetry: vi.fn(),
    claimTerminalCleanupRuns: vi.fn().mockResolvedValue([]), failStaleRuns: vi.fn().mockResolvedValue([]),
    claimStaleFailureReservations: vi.fn().mockResolvedValue([]), deleteExpiredPrivacyResults: vi.fn().mockResolvedValue(0)
  };
}

function creditsDouble() { return { consumeReservation: vi.fn(), releaseReservation: vi.fn() }; }

function runView(): AnalysisRun {
  return { id: "r1", videoId: "v1", fileName: "clip.mp4", duration: 120, status: "completed", stage: "completed", retentionMode: "standard", resultAvailability: "available", transcript: { mergeWarnings: [], segments: [] } };
}
