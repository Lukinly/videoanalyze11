import { describe, expect, it, vi } from "vitest";
import { runRetentionSweep } from "./cleanup-worker.js";

const now = new Date("2026-08-15T12:00:00.000Z");

describe("retention sweep", () => {
  it("deletes an expired abandoned upload and records its metadata once", async () => {
    const repository = repositoryDouble({
      claimExpiredTransientObjects: vi.fn().mockResolvedValue([
        { id: "object_1", key: "users/u1/videos/v1/original.mp4", kind: "original", videoId: "video_1", claimToken: "token_1" }
      ])
    });
    const storage = { delete: vi.fn().mockResolvedValue(undefined) };
    const report = await runRetentionSweep({ now, repository, storage, cleanupTerminalRun: vi.fn(), credits: creditsDouble() });
    expect(report).toEqual({ transientDeleted: 1, transientRetried: 0, privacyResultsDeleted: 0, staleRunsFailed: 0 });
    expect(storage.delete).toHaveBeenCalledWith("users/u1/videos/v1/original.mp4");
    expect(repository.markTransientObjectDeleted).toHaveBeenCalledWith({ objectId: "object_1", videoId: "video_1", claimToken: "token_1", now });
  });

  it("retries terminal media cleanup through the existing terminal cleanup path", async () => {
    const repository = repositoryDouble({ claimTerminalCleanupRuns: vi.fn().mockResolvedValue(["run_terminal"]) });
    const cleanupTerminalRun = vi.fn().mockResolvedValue({ status: "complete" });
    const report = await runRetentionSweep({ now, repository, storage: storageDouble(), cleanupTerminalRun, credits: creditsDouble() });
    expect(cleanupTerminalRun).toHaveBeenCalledWith("run_terminal", now);
    expect(report).toEqual({ transientDeleted: 1, transientRetried: 0, privacyResultsDeleted: 0, staleRunsFailed: 0 });
  });

  it("marks stale runs failed, releases reservations idempotently, and cleans their media", async () => {
    const repository = repositoryDouble({
      failStaleRuns: vi.fn().mockResolvedValue(["run_stale"]),
      claimStaleFailureReservations: vi.fn().mockResolvedValue(["run_stale"])
    });
    const credits = creditsDouble();
    const cleanupTerminalRun = vi.fn().mockResolvedValue({ status: "complete" });
    const report = await runRetentionSweep({ now, repository, storage: storageDouble(), cleanupTerminalRun, credits });
    expect(repository.failStaleRuns).toHaveBeenCalledWith({
      now,
      runCreatedBefore: new Date("2026-08-15T08:00:00.000Z"),
      heartbeatBefore: new Date("2026-08-15T11:45:00.000Z"),
      error: "analysis run failed after missing its heartbeat"
    });
    expect(credits.releaseReservation).toHaveBeenCalledWith("run_stale", "analysis_failed");
    expect(cleanupTerminalRun).toHaveBeenCalledWith("run_stale", now);
    expect(report).toEqual({ transientDeleted: 1, transientRetried: 0, privacyResultsDeleted: 0, staleRunsFailed: 1 });
  });

  it("reports transactional privacy expiry deletions", async () => {
    const repository = repositoryDouble({ deleteExpiredPrivacyResults: vi.fn().mockResolvedValue(2) });
    const report = await runRetentionSweep({ now, repository, storage: storageDouble(), cleanupTerminalRun: vi.fn(), credits: creditsDouble() });
    expect(repository.deleteExpiredPrivacyResults).toHaveBeenCalledWith(now);
    expect(report).toEqual({ transientDeleted: 0, transientRetried: 0, privacyResultsDeleted: 2, staleRunsFailed: 0 });
  });

  it("is idempotent when a repeated sweep has no remaining claims", async () => {
    const repository = repositoryDouble({
      claimExpiredTransientObjects: vi.fn()
        .mockResolvedValueOnce([{ id: "object_1", key: "orphan.mp4", kind: "original", videoId: "video_1", claimToken: "token_1" }])
        .mockResolvedValueOnce([]),
      deleteExpiredPrivacyResults: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    });
    const storage = storageDouble();
    const first = await runRetentionSweep({ now, repository, storage, cleanupTerminalRun: vi.fn(), credits: creditsDouble() });
    const second = await runRetentionSweep({ now, repository, storage, cleanupTerminalRun: vi.fn(), credits: creditsDouble() });
    expect(first).toEqual({ transientDeleted: 1, transientRetried: 0, privacyResultsDeleted: 1, staleRunsFailed: 0 });
    expect(second).toEqual({ transientDeleted: 0, transientRetried: 0, privacyResultsDeleted: 0, staleRunsFailed: 0 });
    expect(storage.delete).toHaveBeenCalledOnce();
    expect(repository.markTransientObjectDeleted).toHaveBeenCalledOnce();
  });

  it("stores at most 500 sanitized characters when transient deletion fails", async () => {
    const repository = repositoryDouble({
      claimExpiredTransientObjects: vi.fn().mockResolvedValue([{ id: "object_1", key: "orphan.mp4", kind: "original", videoId: "video_1", claimToken: "token_1" }])
    });
    const storage = { delete: vi.fn().mockRejectedValue(new Error(`provider\nsecret\u0000${"x".repeat(700)}`)) };
    const report = await runRetentionSweep({ now, repository, storage, cleanupTerminalRun: vi.fn(), credits: creditsDouble() });
    expect(report).toEqual({ transientDeleted: 0, transientRetried: 1, privacyResultsDeleted: 0, staleRunsFailed: 0 });
    const stored = vi.mocked(repository.recordTransientObjectRetry).mock.calls[0]?.[0].error as string | undefined;
    expect(stored).toHaveLength(500);
    expect(Array.from(stored ?? "").every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })).toBe(true);
  });

  it("reconciles every held stale-failure reservation and retries a failed release next sweep", async () => {
    const repository = repositoryDouble({
      claimStaleFailureReservations: vi.fn()
        .mockResolvedValueOnce(["run_1", "run_2"])
        .mockResolvedValueOnce(["run_1"])
    });
    const credits = creditsDouble();
    vi.mocked(credits.releaseReservation)
      .mockRejectedValueOnce(new Error("credits unavailable"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();

    await runRetentionSweep({ now, repository, storage: storageDouble(), cleanupTerminalRun: vi.fn(), credits, onError });
    await runRetentionSweep({ now, repository, storage: storageDouble(), cleanupTerminalRun: vi.fn(), credits, onError });

    expect(credits.releaseReservation.mock.calls).toEqual([
      ["run_1", "analysis_failed"], ["run_2", "analysis_failed"], ["run_1", "analysis_failed"]
    ]);
    expect(onError).toHaveBeenCalledOnce();
  });
});

function repositoryDouble(overrides: Record<string, unknown> = {}) {
  return {
    claimExpiredTransientObjects: vi.fn().mockResolvedValue([]),
    markTransientObjectDeleted: vi.fn().mockResolvedValue(undefined),
    recordTransientObjectRetry: vi.fn().mockResolvedValue(undefined),
    claimTerminalCleanupRuns: vi.fn().mockResolvedValue([]),
    failStaleRuns: vi.fn().mockResolvedValue([]),
    claimStaleFailureReservations: vi.fn().mockResolvedValue([]),
    deleteExpiredPrivacyResults: vi.fn().mockResolvedValue(0),
    ...overrides
  };
}

function storageDouble() { return { delete: vi.fn().mockResolvedValue(undefined) }; }
function creditsDouble() {
  return { consumeReservation: vi.fn().mockResolvedValue(undefined), releaseReservation: vi.fn().mockResolvedValue(undefined) };
}
