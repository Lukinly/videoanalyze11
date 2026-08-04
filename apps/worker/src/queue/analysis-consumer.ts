import { Worker } from "bullmq";
import type { AnalysisJob } from "./queues.js";
import { ANALYSIS_QUEUE } from "./queues.js";

export function createAnalysisConsumer(input: {
  connection: ConstructorParameters<typeof Worker>[2]["connection"];
  runner: { run(job: AnalysisJob & { signal: AbortSignal }): Promise<void> };
  concurrency?: number;
}) {
  return new Worker<AnalysisJob>(ANALYSIS_QUEUE, async (job) => {
    const controller = new AbortController();
    await input.runner.run({ ...job.data, signal: controller.signal });
    return { runId: job.data.runId };
  }, { connection: input.connection, concurrency: input.concurrency ?? 2 });
}
