import { Queue } from "bullmq";

export const ANALYSIS_QUEUE = "video-analysis";

export type AnalysisJob = {
  userId: string;
  videoId: string;
  runId: string;
};

export function createAnalysisQueue(connection: NonNullable<ConstructorParameters<typeof Queue>[1]>["connection"]) {
  return new Queue<AnalysisJob>(ANALYSIS_QUEUE, { connection });
}
