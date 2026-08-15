import { settleAnalysisFailure } from "../analysis/settlement.js";

type ExpiredObject = {
  id?: string;
  key: string;
  kind: "original" | "temporary" | "result";
  videoId?: string | null;
};

type RetentionState = {
  listExpiredObjects(now: Date): Promise<ExpiredObject[]>;
  markObjectDeleted(object: ExpiredObject): Promise<void>;
};

type StorageDeleter = {
  delete(key: string): Promise<void>;
};

export type RetentionSweepReport = {
  transientDeleted: number;
  transientRetried: number;
  privacyResultsDeleted: number;
  staleRunsFailed: number;
};

type ClaimedTransientObject = ExpiredObject & { id: string; videoId: string | null };

export type RetentionSweepRepository = {
  claimExpiredTransientObjects(now: Date): Promise<ClaimedTransientObject[]>;
  markTransientObjectDeleted(input: { objectId: string; videoId: string | null; now: Date }): Promise<void>;
  recordTransientObjectRetry(input: { objectId: string; error: string }): Promise<void>;
  claimTerminalCleanupRuns(now: Date): Promise<string[]>;
  failStaleRuns(input: {
    now: Date;
    runCreatedBefore: Date;
    heartbeatBefore: Date;
    error: string;
  }): Promise<string[]>;
  deleteExpiredPrivacyResults(now: Date): Promise<number>;
};

type CreditSettlement = {
  consumeReservation(runId: string): Promise<void>;
  releaseReservation(runId: string, reason: string): Promise<void>;
};

type TerminalCleanupResult = { status: "pending" | "cleaning" | "complete" | "retry" | "missing" };

export async function cleanupExpiredObjects(input: { state: RetentionState; storage: StorageDeleter; now: Date }) {
  const expiredObjects = await input.state.listExpiredObjects(input.now);
  const deletedKeys: string[] = [];

  for (const object of expiredObjects) {
    try {
      await input.storage.delete(object.key);
    } catch (error) {
      if (!isMissingObjectError(error)) throw error;
    }
    await input.state.markObjectDeleted(object);
    deletedKeys.push(object.key);
  }

  return { deletedKeys };
}

export async function runRetentionSweep(input: {
  now: Date;
  repository: RetentionSweepRepository;
  storage: StorageDeleter;
  cleanupTerminalRun(runId: string, now: Date): Promise<TerminalCleanupResult>;
  credits: CreditSettlement;
}): Promise<RetentionSweepReport> {
  const report: RetentionSweepReport = {
    transientDeleted: 0,
    transientRetried: 0,
    privacyResultsDeleted: 0,
    staleRunsFailed: 0
  };

  const expiredObjects = await input.repository.claimExpiredTransientObjects(input.now);
  for (const object of expiredObjects) {
    try {
      await cleanupExpiredObjects({
        now: input.now,
        storage: input.storage,
        state: {
          listExpiredObjects: async () => [object],
          markObjectDeleted: async () => input.repository.markTransientObjectDeleted({
            objectId: object.id,
            videoId: object.videoId,
            now: input.now
          })
        }
      });
      report.transientDeleted += 1;
    } catch (error) {
      await input.repository.recordTransientObjectRetry({ objectId: object.id, error: sanitizeCleanupError(error) });
      report.transientRetried += 1;
    }
  }

  const terminalRunIds = await input.repository.claimTerminalCleanupRuns(input.now);
  for (const runId of terminalRunIds) {
    recordTerminalCleanup(report, await input.cleanupTerminalRun(runId, input.now));
  }

  const staleError = "analysis run failed after missing its heartbeat";
  const staleRunIds = await input.repository.failStaleRuns({
    now: input.now,
    runCreatedBefore: new Date(input.now.getTime() - 4 * 60 * 60 * 1000),
    heartbeatBefore: new Date(input.now.getTime() - 15 * 60 * 1000),
    error: staleError
  });
  for (const runId of staleRunIds) {
    await settleAnalysisFailure({ runId, error: new Error(staleError), credits: input.credits });
    report.staleRunsFailed += 1;
    recordTerminalCleanup(report, await input.cleanupTerminalRun(runId, input.now));
  }

  report.privacyResultsDeleted = await input.repository.deleteExpiredPrivacyResults(input.now);
  return report;
}

export function sanitizeCleanupError(error: unknown): string {
  const message = error instanceof Error ? error.message : "retention cleanup failed";
  const sanitized = Array.from(message, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
  return sanitized.trim().slice(0, 500) || "retention cleanup failed";
}

function recordTerminalCleanup(report: RetentionSweepReport, result: TerminalCleanupResult): void {
  if (result.status === "complete") report.transientDeleted += 1;
  if (result.status === "retry") report.transientRetried += 1;
}

function isMissingObjectError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && ["NoSuchKey", "NotFound", "404"].includes(String(error.code));
}
