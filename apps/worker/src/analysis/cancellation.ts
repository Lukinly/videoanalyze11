export type CancellationOutcome = "before_processing" | "after_processing";

export function cancellationOutcome(processingStarted: boolean): CancellationOutcome {
  return processingStarted ? "after_processing" : "before_processing";
}

export class AnalysisCancelledError extends Error {
  constructor(readonly outcome: CancellationOutcome) {
    super("analysis cancelled");
    this.name = "AnalysisCancelledError";
  }
}
