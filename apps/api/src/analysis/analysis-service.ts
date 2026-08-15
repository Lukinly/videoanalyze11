import { randomUUID } from "node:crypto";
import { DomainError } from "@videoanalyze/domain";
import { calculateAnalysisCost } from "../credits/credit-cost.js";

type AnalysisRepositories = {
  videos: { findOwnedById(userId: string, videoId: string): Promise<{ id: string; userId: string; fileSize: number } | null> };
  credits: {
    reserveAnalysis(input: { userId: string; runId: string; amount: number }): Promise<"held" | "already_held" | "exhausted">;
    releaseReservation(runId: string, reason: string): Promise<void>;
    getBalance?: (userId: string) => Promise<{ ledgerBalance: number; held: number; available: number }>;
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

      const estimatedCost = calculateAnalysisCost(Number(video.fileSize));
      const runId = randomUUID();
      const reservation = await dependencies.credits.reserveAnalysis({ userId: input.userId, runId, amount: estimatedCost });
      if (reservation === "exhausted") {
        const balance = await dependencies.credits.getBalance?.(input.userId);
        throw new DomainError("CREDITS_EXHAUSTED", `需要 ${estimatedCost} 积分，当前可用 ${balance?.available ?? 0} 积分`, 402);
      }
      if (reservation === "already_held") {
        throw new DomainError("ANALYSIS_CONFLICT", "analysis reservation already exists", 409);
      }

      try {
        const run = await dependencies.runs.create({ id: runId, userId: input.userId, videoId: video.id });
        await dependencies.queue.add("analysis", { userId: input.userId, videoId: video.id, runId }, { jobId: runId });
        return { ...run, estimatedCost };
      } catch (error) {
        try {
          await dependencies.credits.releaseReservation(runId, "analysis creation failed");
        } catch {
          // Preserve the original API/queue error; the recovery worker can release it later.
        }
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
