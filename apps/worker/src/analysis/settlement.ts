import { AnalysisCancelledError } from "./cancellation.js";

type CreditSettlement = {
  consumeReservation(runId: string): Promise<void>;
  releaseReservation(runId: string, reason: string): Promise<void>;
};

export async function settleAnalysisSuccess(input: { runId: string; credits: CreditSettlement }): Promise<void> {
  await input.credits.consumeReservation(input.runId);
}

export async function settleAnalysisFailure(input: { runId: string; error: unknown; credits: CreditSettlement }): Promise<void> {
  if (input.error instanceof AnalysisCancelledError && input.error.outcome === "after_processing") {
    await input.credits.consumeReservation(input.runId);
    return;
  }
  const reason = input.error instanceof AnalysisCancelledError ? "cancelled_before_processing" : "analysis_failed";
  await input.credits.releaseReservation(input.runId, reason);
}
