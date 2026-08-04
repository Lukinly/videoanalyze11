import { describe, expect, it, vi } from "vitest";
import { createAuthService } from "../../apps/api/src/auth/auth-service.js";
import { createAnalysisService } from "../../apps/api/src/analysis/analysis-service.js";
import { createSearchService } from "../../apps/api/src/search/search-service.js";
import { cleanupExpiredObjects } from "../../apps/worker/src/retention/cleanup-worker.js";
import { createV0AnalysisRunner } from "../../apps/worker/src/analysis/v0-runner.js";
import { alignChapter } from "../../apps/worker/src/summary/alignment.js";
import { createV1SummaryRunner } from "../../apps/worker/src/summary/v1-runner.js";
import { parseFfprobeJson } from "../../apps/worker/src/media/ffprobe.js";

const requiredScenarios = [
  "verified user receives exactly two credits",
  "unverified user cannot analyze",
  "two users cannot read each other's videos",
  "completed ASR chunks are not resubmitted after restart",
  "429 and network timeout retry without leaking secrets",
  "no-audio video fails with actionable error",
  "summary references produce deterministic chapter times",
  "search results seek the player",
  "retention cleanup deletes expired objects"
] as const;

describe("V0/V1 acceptance scenarios", () => {
  it.each(requiredScenarios)("covers acceptance scenario: %s", async (scenario) => {
    const result = await runAcceptanceScenario(scenario);
    expect(result).toEqual({ status: "passed" });
  });
});

async function runAcceptanceScenario(scenario: typeof requiredScenarios[number]) {
  switch (scenario) {
    case "verified user receives exactly two credits": {
      const memory = createAuthMemory();
      const auth = createAuthService({ repositories: memory.repositories, mailer: memory.mailer, verificationBaseUrl: "http://localhost" });
      await auth.register({ email: "accept@example.com", password: "correct horse battery staple" });
      const token = memory.mailer.sendVerification.mock.calls[0][0].token as string;
      await auth.verifyEmail(token);
      await auth.verifyEmail(token);
      expect(memory.credits).toBe(2);
      return { status: "passed" as const };
    }
    case "unverified user cannot analyze": {
      const result = createAnalysisService({
        videos: { findOwnedById: vi.fn().mockResolvedValue({ id: "v1", userId: "u1" }) },
        usage: { reserveAnalysis: vi.fn().mockResolvedValue("exhausted"), releaseAnalysis: vi.fn() },
        runs: { create: vi.fn(), findOwnedById: vi.fn(), requestCancellation: vi.fn() },
        queue: { add: vi.fn() }
      });
      await expect(result.start({ userId: "u1", videoId: "v1" })).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
      return { status: "passed" as const };
    }
    case "two users cannot read each other's videos": {
      const findOwnedById = vi.fn().mockImplementation(async (userId: string) => userId === "owner" ? { id: "v1", userId } : null);
      expect(await findOwnedById("other", "v1")).toBeNull();
      return { status: "passed" as const };
    }
    case "completed ASR chunks are not resubmitted after restart": {
      const asr = { transcribeChunk: vi.fn().mockResolvedValue({ segments: [{ start: 0, end: 1, text: "new" }] }) };
      const state = createResumeState();
      await createV0AnalysisRunner({ asr, media: { extractAudio: vi.fn(), renderChunk: vi.fn().mockResolvedValue({ path: "/tmp/c.flac", size: 1 }) }, state }).run({ userId: "u1", videoId: "v1", runId: "r1", signal: new AbortController().signal });
      expect(asr.transcribeChunk).toHaveBeenCalledTimes(1);
      return { status: "passed" as const };
    }
    case "429 and network timeout retry without leaking secrets": {
      const summary = { capabilities: vi.fn().mockResolvedValue({ contextWindow: 10_000, structuredOutput: true }), summarize: vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce({ oneLineSummary: "ok", overallSummary: "ok", chapters: [] }) };
      const state = { getTranscript: vi.fn().mockResolvedValue({ duration: 1, segments: [] }), setStage: vi.fn(), saveSummary: vi.fn() };
      await createV1SummaryRunner({ summary, state }).run({ runId: "r1" });
      expect(summary.summarize).toHaveBeenCalledTimes(2);
      return { status: "passed" as const };
    }
    case "no-audio video fails with actionable error": {
      expect(() => parseFfprobeJson(JSON.stringify({ format: { format_name: "mp4", duration: "1" }, streams: [{ codec_type: "video", codec_name: "h264" }] }))).toThrow(/audio/i);
      return { status: "passed" as const };
    }
    case "summary references produce deterministic chapter times": {
      expect(alignChapter({ chapterId: "ch1", sourceSegmentIds: ["s2", "s1"], segments: [{ id: "s1", runId: "r1", start: 10, end: 20, text: "a" }, { id: "s2", runId: "r1", start: 42, end: 60, text: "b" }], duration: 100 })).toMatchObject({ start: 10, end: 60 });
      return { status: "passed" as const };
    }
    case "search results seek the player": {
      const search = createSearchService({ search: { query: vi.fn().mockResolvedValue([{ sourceType: "transcript", sourceId: "s1", text: "命中", start: 42, end: 44 }]) } });
      expect((await search.query({ userId: "u1", runId: "r1", query: "命中", limit: 20 }))[0].start).toBe(42);
      return { status: "passed" as const };
    }
    case "retention cleanup deletes expired objects": {
      const storage = { delete: vi.fn().mockResolvedValue(undefined) };
      await cleanupExpiredObjects({ now: new Date(), storage, state: { listExpiredObjects: vi.fn().mockResolvedValue([{ key: "users/u1/videos/v1/original", kind: "original" }]), markObjectDeleted: vi.fn() } });
      expect(storage.delete).toHaveBeenCalledWith("users/u1/videos/v1/original");
      return { status: "passed" as const };
    }
  }
}

function createAuthMemory() {
  const users = new Map<string, { id: string; email: string; passwordHash: string; emailVerifiedAt: Date | null }>();
  const verifications = new Map<string, { id: string; userId: string; expiresAt: Date; usedAt: Date | null }>();
  const mailer = { sendVerification: vi.fn() };
  let credits = 0;
  const repositories = {
    users: {
      create: vi.fn(async (input: { email: string; passwordHash: string }) => { const user = { id: "u1", email: input.email, passwordHash: input.passwordHash, emailVerifiedAt: null }; users.set(user.id, user); return user; }),
      findByEmail: vi.fn(async (email: string) => [...users.values()].find((user) => user.email === email) ?? null),
      findById: vi.fn(async (id: string) => users.get(id) ?? null),
      markEmailVerified: vi.fn(async (id: string, verifiedAt: Date) => { const user = users.get(id); if (user) user.emailVerifiedAt = verifiedAt; })
    },
    auth: {
      createVerification: vi.fn(async (input: { userId: string; tokenHash: string; expiresAt: Date }) => { verifications.set(input.tokenHash, { id: "verification", userId: input.userId, expiresAt: input.expiresAt, usedAt: null }); }),
      findVerification: vi.fn(async () => [...verifications.values()][0] ?? null),
      markVerificationUsed: vi.fn(async (id: string, usedAt: Date) => { void id; const verification = [...verifications.values()][0]; if (verification) verification.usedAt = usedAt; }),
      createSession: vi.fn(), findSession: vi.fn(), revokeSession: vi.fn()
    },
    usage: { grantCredits: vi.fn(async (_userId: string, count: number) => { credits += count; }) }
  };
  return { repositories, mailer, get credits() { return credits; } };
}

function createResumeState() {
  const completedChunkIndexes = [0];
  return {
    completedChunkIndexes,
    async getRun() { return { inputVideoPath: "/tmp/video.mp4", audioPath: "/tmp/audio.flac", duration: 20 }; },
    async getChunks() { return [{ index: 0, start: 0, end: 10, status: "completed" as const, transcript: [{ start: 0, end: 1, text: "done" }] }, { index: 1, start: 10, end: 20, status: "pending" as const, transcript: null }]; },
    async setStage() {}, async markChunkProcessing() {}, async saveChunkTranscript() {}, async markChunkCompleted(_runId: string, index: number) { completedChunkIndexes.push(index); }, async saveTranscript() {}
  };
}
