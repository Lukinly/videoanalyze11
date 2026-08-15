import { randomUUID } from "node:crypto";
import { DomainError, type RetentionMode } from "@videoanalyze/domain";

type AnalysisRepositories = {
  videos: { findOwnedById(userId: string, videoId: string): Promise<{ id: string; userId: string; fileName: string; fileSize: number } | null> };
  runs: {
    create(input: { id: string; userId: string; videoId: string; displayName: string; retentionMode: RetentionMode }): Promise<{ id: string; status: string }>;
    findOwnedById(userId: string, runId: string): Promise<{ id: string } | null>;
    requestCancellation(userId: string, runId: string): Promise<{ id: string } | null>;
  };
};

export function createAnalysisService(dependencies: AnalysisRepositories & { queue: { add(name: string, data: unknown, options: { jobId: string }): Promise<unknown> } }) {
  return {
    async start(input: { userId: string; videoId: string; retentionMode?: RetentionMode }) {
      const video = await dependencies.videos.findOwnedById(input.userId, input.videoId);
      if (!video) throw new DomainError("NOT_FOUND", "video not found", 404);
      const retentionMode = input.retentionMode ?? "standard";

      const runId = randomUUID();
      const run = await dependencies.runs.create({ id: runId, userId: input.userId, videoId: video.id, displayName: video.fileName, retentionMode });
      await dependencies.queue.add("analysis", { userId: input.userId, videoId: video.id, runId }, { jobId: runId });
      return { ...run, billingStatus: "pending_duration_probe" as const };
    },
    async get(input: { userId: string; runId: string }): Promise<{ id: string }> {
      const run = await dependencies.runs.findOwnedById(input.userId, input.runId);
      if (!run) throw new DomainError("NOT_FOUND", "analysis run not found", 404);
      return run;
    },
    async cancel(input: { userId: string; runId: string }): Promise<{ id: string }> {
      const run = await dependencies.runs.requestCancellation(input.userId, input.runId);
      if (!run) throw new DomainError("NOT_FOUND", "analysis run not found", 404);
      return run;
    }
  };
}
