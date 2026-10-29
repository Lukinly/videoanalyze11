import type { Pool } from "pg";

// Database rows are the durable dispatch intent. BullMQ's stable job ID makes
// redispatch safe after an ambiguous queue failure or an API process crash.
export async function recoverQueuedRuns(input: {
  pool: Pool;
  queue: { add(name: string, data: unknown, options: { jobId: string }): Promise<unknown> };
}) {
  const runs = await input.pool.query<{ id: string; userId: string; videoId: string }>(
    `SELECT id, user_id AS "userId", video_id AS "videoId" FROM analysis_runs
     WHERE status IN ('queued', 'cancelling') AND results_deleted_at IS NULL ORDER BY created_at`
  );
  for (const run of runs.rows) {
    await input.queue.add("analysis", { userId: run.userId, videoId: run.videoId, runId: run.id }, { jobId: run.id });
  }
}
