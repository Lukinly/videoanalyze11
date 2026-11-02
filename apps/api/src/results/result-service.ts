import { DomainError, type ResultAvailability } from "@videoanalyze/domain";
import type { createResultRepository, ResultMetadata } from "./result-repository.js";

type ResultRepository = ReturnType<typeof createResultRepository>;

export function resultAvailability(run: Pick<ResultMetadata, "status" | "retentionMode" | "resultExpiresAt" | "resultsDeletedAt">, now: Date): ResultAvailability {
  if (run.resultsDeletedAt) return "deleted";
  if (run.retentionMode === "privacy" && run.resultExpiresAt && run.resultExpiresAt <= now) return "expired";
  if (run.status !== "completed") return "pending";
  return "available";
}

export function createResultService(input: { repository: ResultRepository; clock?: { now(): Date } }) {
  const clock = input.clock ?? { now: () => new Date() };
  async function ownedMetadata(userId: string, runId: string) {
    const run = await input.repository.findOwnedMetadata(userId, runId);
    if (!run) throw new DomainError("NOT_FOUND", "analysis run not found", 404);
    return run;
  }
  async function assertAvailable(value: { userId: string; runId: string }) {
    const run = await ownedMetadata(value.userId, value.runId);
    const availability = resultAvailability(run, clock.now());
    if (availability === "expired" || availability === "deleted") throw new DomainError("RESULT_EXPIRED", `analysis result ${availability}`, 410);
    if (availability === "pending") throw new DomainError("ANALYSIS_CONFLICT", "analysis result is not ready", 409);
    return run;
  }
  return {
    assertAvailable,
    async list(value: { userId: string; limit: number }) {
      const limit = Math.min(100, Math.max(1, Math.floor(value.limit) || 50));
      const now = clock.now();
      return { items: (await input.repository.listOwned(value.userId, limit)).map((run) => ({ ...publicMetadata(run), resultAvailability: resultAvailability(run, now) })) };
    },
    async get(value: { userId: string; runId: string }) {
      const run = await ownedMetadata(value.userId, value.runId);
      const availability = resultAvailability(run, clock.now());
      if (availability === "expired" || availability === "deleted") throw new DomainError("RESULT_EXPIRED", `analysis result ${availability}`, 410);
      if (availability === "pending") return { ...publicMetadata(run), resultAvailability: availability };
      return { ...publicMetadata(run), resultAvailability: availability, ...await input.repository.loadOwnedContent(value.userId, value.runId, run.retentionMode) };
    },
    async delete(value: { userId: string; runId: string }) {
      if (!await input.repository.deleteOwnedResults(value.userId, value.runId, clock.now())) throw new DomainError("NOT_FOUND", "analysis run not found", 404);
    }
  };
}

function publicMetadata<T extends { error?: unknown; status?: string; stage?: string }>(run: T): Omit<T, "error"> & { failure?: { code: string; message: string } } {
  const safe = { ...run };
  delete safe.error;
  if (run.status !== "failed") return safe;
  const asrAccessDenied = run.stage === "transcribing" && typeof run.error === "string" && /^provider request failed with status 403:/.test(run.error);
  return { ...safe, failure: asrAccessDenied
    ? { code: "ASR_ACCESS_DENIED", message: "语音识别服务拒绝了请求，请联系管理员检查服务权限和网络配置。" }
    : { code: "ANALYSIS_FAILED", message: "本次分析失败，未生成完整结果。" }
  };
}

export type ResultService = ReturnType<typeof createResultService>;
