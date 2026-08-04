import { randomUUID } from "node:crypto";
import { DomainError } from "@videoanalyze/domain";

type AnalysisRepositories = {
  videos: { findOwnedById(userId: string, videoId: string): Promise<{ id: string; userId: string } | null> };
  usage: {
    reserveAnalysis(input: { userId: string; runId: string; idempotencyKey: string }): Promise<"reserved" | "already_reserved" | "exhausted">;
    releaseAnalysis(runId: string, reason: string): Promise<void>;
  };
  runs: {
    create(input: { id: string; userId: string; videoId: string }): Promise<{ id: string; status: string }>;
    findOwnedById(userId: string, runId: string): Promise<{ id: string } | null>;
    requestCancellation(userId: string, runId: string): Promise<{ id: string } | null>;
  };
};

export function createAnalysisService(dependencies: AnalysisRepositories & { queue: { add(name: string, data: unknown, options: { jobId: string }): Promise<unknown> } }) {
  return {
    async start(input: { userId: string; videoId: string }) {
      const video = await dependencies.videos.findOwnedById(input.userId, input.videoId);
      if (!video) throw new DomainError("NOT_FOUND", "video not found", 404);

      const runId = randomUUID();
      const reservation = await dependencies.usage.reserveAnalysis({ userId: input.userId, runId, idempotencyKey: runId });
      if (reservation === "exhausted") throw new DomainError("QUOTA_EXHAUSTED", "analysis trial credits are exhausted", 402);

      try {
        const run = await dependencies.runs.create({ id: runId, userId: input.userId, videoId: video.id });
        await dependencies.queue.add("analysis", { userId: input.userId, videoId: video.id, runId }, { jobId: runId });
        return run;
      } catch (error) {
        await dependencies.usage.releaseAnalysis(runId, "analysis creation failed");
        throw error;
      }
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
