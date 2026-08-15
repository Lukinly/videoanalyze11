export class AnalysisRunNotWritableError extends Error {
  constructor() {
    super("analysis run is no longer writable");
    this.name = "AnalysisRunNotWritableError";
  }
}

export async function requireStageUpdate(operation: () => Promise<boolean>): Promise<void> {
  if (!await operation()) throw new AnalysisRunNotWritableError();
}
