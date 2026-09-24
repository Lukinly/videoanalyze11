import { describe, expect, it, vi } from "vitest";
import { AnalysisCancelledError } from "./cancellation.js";
import { settleAnalysisFailure, settleAnalysisSuccess } from "./settlement.js";

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
