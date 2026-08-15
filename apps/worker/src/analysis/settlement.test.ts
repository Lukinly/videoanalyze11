import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AnalysisCancelledError } from "./cancellation.js";
import { settleAnalysisFailure, settleAnalysisSuccess } from "./settlement.js";
import { removeValidatedRunDirectory, runAnalysisToTerminal } from "../retention/media-cleanup.js";

describe("analysis credit settlement", () => {
  it("consumes a reservation after successful processing", async () => {
    const credits = { consumeReservation: vi.fn(), releaseReservation: vi.fn() };
    await settleAnalysisSuccess({ runId: "run_1", credits });
    expect(credits.consumeReservation).toHaveBeenCalledWith("run_1");
    expect(credits.releaseReservation).not.toHaveBeenCalled();
  });

  it("releases a reservation for provider failures", async () => {
    const credits = { consumeReservation: vi.fn(), releaseReservation: vi.fn() };
    await settleAnalysisFailure({ runId: "run_1", error: new Error("provider failed"), credits });
    expect(credits.releaseReservation).toHaveBeenCalledWith("run_1", "analysis_failed");
    expect(credits.consumeReservation).not.toHaveBeenCalled();
  });

  it("refunds cancellation before processing", async () => {
    const credits = { consumeReservation: vi.fn(), releaseReservation: vi.fn() };
    await settleAnalysisFailure({ runId: "run_1", error: new AnalysisCancelledError("before_processing"), credits });
    expect(credits.releaseReservation).toHaveBeenCalledWith("run_1", "cancelled_before_processing");
  });

  it("charges cancellation after processing", async () => {
    const credits = { consumeReservation: vi.fn(), releaseReservation: vi.fn() };
    await settleAnalysisFailure({ runId: "run_1", error: new AnalysisCancelledError("after_processing"), credits });
    expect(credits.consumeReservation).toHaveBeenCalledWith("run_1");
    expect(credits.releaseReservation).not.toHaveBeenCalled();
  });
});

describe("terminal analysis ordering", () => {
  it("commits success and consumes the reservation before cleanup", async () => {
    const events: string[] = [];
    const fixture = await createLocalRunFixture();

    await runAnalysisToTerminal({
      runAndPersist: async () => { events.push("persisted"); },
      markCompleted: async () => { events.push("completed"); return true; },
      markFailedOrCancelled: async () => { events.push("failed"); return true; },
      settleSuccess: async () => { events.push("consumed"); },
      settleFailure: async () => { events.push("released"); },
      cleanupMedia: async () => { events.push("media-cleaned"); events.push("local-cleaned"); await removeValidatedRunDirectory(fixture.runId); }
    });

    expect(events).toEqual(["persisted", "completed", "consumed", "media-cleaned", "local-cleaned"]);
    await expect(stat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("commits failure and settles its reservation before cleanup", async () => {
    const events: string[] = [];
    const failure = new Error("provider failed");
    const fixture = await createLocalRunFixture();

    await expect(runAnalysisToTerminal({
      runAndPersist: async () => { events.push("processing"); throw failure; },
      markCompleted: async () => { events.push("completed"); return true; },
      markFailedOrCancelled: async (error) => { expect(error).toBe(failure); events.push("failed"); return true; },
      settleSuccess: async () => { events.push("consumed"); },
      settleFailure: async (error) => { expect(error).toBe(failure); events.push("released"); },
      cleanupMedia: async () => { events.push("media-cleaned"); events.push("local-cleaned"); await removeValidatedRunDirectory(fixture.runId); }
    })).rejects.toBe(failure);

    expect(events).toEqual(["processing", "failed", "released", "media-cleaned", "local-cleaned"]);
    await expect(stat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("commits cancellation and settles its reservation before cleanup", async () => {
    const events: string[] = [];
    const cancellation = new AnalysisCancelledError("before_processing");
    const fixture = await createLocalRunFixture();

    await expect(runAnalysisToTerminal({
      runAndPersist: async () => { throw cancellation; },
      markCompleted: async () => { events.push("completed"); return true; },
      markFailedOrCancelled: async (error) => { expect(error).toBe(cancellation); events.push("cancelled"); return true; },
      settleSuccess: async () => { events.push("consumed"); },
      settleFailure: async (error) => { expect(error).toBe(cancellation); events.push("refunded"); },
      cleanupMedia: async () => { events.push("media-cleaned"); events.push("local-cleaned"); await removeValidatedRunDirectory(fixture.runId); }
    })).rejects.toBe(cancellation);

    expect(events).toEqual(["cancelled", "refunded", "media-cleaned", "local-cleaned"]);
    await expect(stat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not turn completed analysis into failure when cleanup needs retry", async () => {
    const state = { setRunFailed: vi.fn() };
    const logger = { error: vi.fn() };
    const fixture = await createLocalRunFixture();

    await expect(runAnalysisToTerminal({
      runAndPersist: vi.fn().mockResolvedValue(undefined),
      markCompleted: vi.fn().mockResolvedValue(true),
      markFailedOrCancelled: state.setRunFailed,
      settleSuccess: vi.fn().mockResolvedValue(undefined),
      settleFailure: vi.fn().mockResolvedValue(undefined),
      cleanupMedia: async () => { await removeValidatedRunDirectory(fixture.runId); throw new Error("cleanup repository unavailable"); },
      logger
    })).resolves.toBeUndefined();

    expect(state.setRunFailed).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
    await expect(stat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not invoke failure finalization after completion if charging fails", async () => {
    const chargeFailure = new Error("credit database unavailable");
    const markFailedOrCancelled = vi.fn();
    const fixture = await createLocalRunFixture();

    await expect(runAnalysisToTerminal({
      runAndPersist: vi.fn().mockResolvedValue(undefined),
      markCompleted: vi.fn().mockResolvedValue(true),
      markFailedOrCancelled,
      settleSuccess: vi.fn().mockRejectedValue(chargeFailure),
      settleFailure: vi.fn().mockResolvedValue(undefined),
      cleanupMedia: () => removeValidatedRunDirectory(fixture.runId)
    })).rejects.toBe(chargeFailure);

    expect(markFailedOrCancelled).not.toHaveBeenCalled();
    await expect(stat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not settle or delete media when a failure transition affects no terminal row", async () => {
    const failure = new Error("provider failed");
    const settleFailure = vi.fn();
    const cleanupMedia = vi.fn();

    await expect(runAnalysisToTerminal({
      runAndPersist: async () => { throw failure; },
      markCompleted: vi.fn().mockResolvedValue(false),
      markFailedOrCancelled: vi.fn().mockResolvedValue(false),
      settleSuccess: vi.fn(),
      settleFailure,
      cleanupMedia
    })).rejects.toBe(failure);

    expect(settleFailure).not.toHaveBeenCalled();
    expect(cleanupMedia).not.toHaveBeenCalled();
  });

  it("does not delete media when neither completion nor fallback failure is persisted", async () => {
    const cleanupMedia = vi.fn();

    await expect(runAnalysisToTerminal({
      runAndPersist: vi.fn().mockResolvedValue(undefined),
      markCompleted: vi.fn().mockResolvedValue(false),
      markFailedOrCancelled: vi.fn().mockResolvedValue(false),
      settleSuccess: vi.fn(),
      settleFailure: vi.fn(),
      cleanupMedia
    })).rejects.toThrow("analysis terminal transition was not persisted");

    expect(cleanupMedia).not.toHaveBeenCalled();
  });
});

async function createLocalRunFixture() {
  const runId = randomUUID();
  const directory = join("/tmp/videoanalyze", runId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "original"), "test fixture");
  return { runId, directory };
}
