export type StaleRun = {
  runId: string;
  status: string;
  heartbeatAt: Date | null;
};

export type RecoveryState = {
  listStaleRuns(now: Date, staleAfterMs: number): Promise<StaleRun[]>;
  requeueRun(runId: string): Promise<void>;
};

export async function scanStaleRuns(input: { state: RecoveryState; now: Date; staleAfterMs: number }) {
  const staleRuns = await input.state.listStaleRuns(input.now, input.staleAfterMs);
  const requeuedRunIds: string[] = [];

  for (const run of staleRuns) {
    if (!["queued", "running", "cancelling"].includes(run.status)) continue;
    await input.state.requeueRun(run.runId);
    requeuedRunIds.push(run.runId);
  }

  return { requeuedRunIds };
}
