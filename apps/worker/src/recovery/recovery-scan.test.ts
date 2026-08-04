import { describe, expect, it, vi } from "vitest";
import { scanStaleRuns } from "./recovery-scan.js";

describe("stale analysis recovery", () => {
  it("requeues a stale run but leaves completed chunks completed", async () => {
    const state = {
      listStaleRuns: vi.fn().mockResolvedValue([{ runId: "run_1", status: "running", heartbeatAt: new Date("2026-08-04T00:00:00.000Z") }]),
      requeueRun: vi.fn()
    };

    const result = await scanStaleRuns({
      state,
      now: new Date("2026-08-04T00:02:00.000Z"),
      staleAfterMs: 60_000
    });

    expect(result.requeuedRunIds).toEqual(["run_1"]);
    expect(state.requeueRun).toHaveBeenCalledWith("run_1");
  });
});
