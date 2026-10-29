import { randomUUID } from "node:crypto";
import { DomainError, type RetentionMode } from "@videoanalyze/domain";
import { evaluateAdmission, type AdmissionLimits, type AdmissionSnapshot } from "./admission-policy.js";

type AnalysisRepositories = {
  videos: { findOwnedById(userId: string, videoId: string): Promise<{ id: string; userId: string; fileName: string; fileSize: number } | null> };
  runs: {
    create(input: { id: string; userId: string; videoId: string; displayName: string; retentionMode: RetentionMode }): Promise<{ id: string; status: string }>;
    findOwnedById(userId: string, runId: string): Promise<{ id: string } | null>;
    requestCancellation(userId: string, runId: string): Promise<{ id: string } | null>;
    getAdmissionSnapshot?(userId: string): Promise<AdmissionSnapshot>;
    findActiveOwnedByVideo?(userId: string, videoId: string): Promise<{ id: string; status: string } | null>;
  };
};

export function createAnalysisService(dependencies: AnalysisRepositories & { queue: { add(name: string, data: unknown, options: { jobId: string }): Promise<unknown> }; admissionLimits?: AdmissionLimits }) {
  async function enqueue(run: { id: string; status: string }, userId: string, videoId: string) {
    if (run.status !== "queued") return;
    try {
      await dependencies.queue.add("analysis", { userId, videoId, runId: run.id }, { jobId: run.id });
    } catch {
      throw new DomainError("QUEUE_UNAVAILABLE", "任务已保存，队列暂时不可用，请稍后重试", 503);
    }
  }
  return {
    async start(input: { userId: string; videoId: string; retentionMode?: RetentionMode }) {
      const video = await dependencies.videos.findOwnedById(input.userId, input.videoId);
      if (!video) throw new DomainError("NOT_FOUND", "video not found", 404);
      const active = await dependencies.runs.findActiveOwnedByVideo?.(input.userId, video.id);
      if (active) {
        await enqueue(active, input.userId, video.id);
        return { ...active, billingStatus: "pending_duration_probe" as const, estimatedWaitSeconds: 0 };
      }
      const retentionMode = input.retentionMode ?? "standard";
      const snapshot = await dependencies.runs.getAdmissionSnapshot?.(input.userId) ?? { userRunning: 0, userQueued: 0, totalQueued: 0, estimatedWaitSeconds: 0 };
      const admission = evaluateAdmission(snapshot, dependencies.admissionLimits);
      if (!admission.accepted) throw new DomainError(admission.code, admission.message, 429);

      const runId = randomUUID();
      const run = await dependencies.runs.create({ id: runId, userId: input.userId, videoId: video.id, displayName: video.fileName, retentionMode });
      await enqueue(run, input.userId, video.id);
      return { ...run, billingStatus: "pending_duration_probe" as const, estimatedWaitSeconds: admission.estimatedWaitSeconds };
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
