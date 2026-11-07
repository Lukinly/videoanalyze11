import { describe, expect, it, vi } from "vitest";
import { InvalidProviderOutputError } from "../providers/provider-request.js";
import { ProviderError } from "@videoanalyze/domain";
import { createV0AnalysisRunner } from "./v0-runner.js";

describe("v0 analysis runner", () => {
  it("marks a run as probing before loading the source media", async () => {
    const { createV0AnalysisRunner } = await import("./v0-runner.js");
    const state = createFakeState();
    const stageCalls: string[] = [];
    state.setStage = async (_runId: string, stage: string) => { stageCalls.push(stage); return true; };
    state.getRun = async () => {
      expect(stageCalls).toEqual(["probing"]);
      return { inputVideoPath: "/tmp/video.mp4", audioPath: "/tmp/audio.flac", duration: 20 };
    };
    const media = {
      extractAudio: vi.fn(),
      renderChunk: vi.fn().mockResolvedValue({ path: "/tmp/chunk-1.flac", size: 10 })
    };
    const runner = createV0AnalysisRunner({
      asr: { transcribeChunk: vi.fn().mockResolvedValue({ segments: [] }) },
      media,
      state
    });

    await runner.run({ userId: "user_1", videoId: "video_1", runId: "run_1", signal: new AbortController().signal });

    expect(stageCalls[0]).toBe("probing");
    expect(state.ensureBilling).toHaveBeenCalledWith("run_1", 20);
  });

  it.each([
    [14_401, "video duration"],
    [90 * 60, "credits exhausted"]
  ])("stops before FFmpeg and ASR when billing rejects duration %s", async (duration, message) => {
    const { createV0AnalysisRunner } = await import("./v0-runner.js");
    const state = createFakeState();
    state.getRun = vi.fn().mockResolvedValue({ inputVideoPath: "/tmp/video.mp4", audioPath: "/tmp/audio.flac", duration });
    state.ensureBilling.mockRejectedValue(new Error(message));
    const media = { extractAudio: vi.fn(), renderChunk: vi.fn() };
    const asr = { transcribeChunk: vi.fn() };

    await expect(createV0AnalysisRunner({ asr, media, state }).run({ userId: "u1", videoId: "v1", runId: "run_1", signal: new AbortController().signal }))
      .rejects.toThrow(message);

    expect(media.extractAudio).not.toHaveBeenCalled();
    expect(asr.transcribeChunk).not.toHaveBeenCalled();
  });

  it("keeps rendered chunks inside the run directory while resuming", async () => {
    const { createV0AnalysisRunner } = await import("./v0-runner.js");
    const asr = { transcribeChunk: vi.fn().mockResolvedValue({ segments: [{ start: 0, end: 2, text: "new" }] }) };
    const state = createFakeState();
    const media = {
      extractAudio: vi.fn(),
      renderChunk: vi.fn(async (_audioPath: string, outputPath: string) => ({ path: outputPath, size: 10 }))
    };
    const runner = createV0AnalysisRunner({ asr, media, state });

    await runner.run({ userId: "user_1", videoId: "video_1", runId: "run_1", signal: new AbortController().signal });

    expect(asr.transcribeChunk).toHaveBeenCalledTimes(1);
    expect(media.renderChunk).toHaveBeenCalledWith(
      "/tmp/videoanalyze/run_1/audio.flac",
      "/tmp/videoanalyze/run_1/chunk-1.flac",
      10,
      10,
      expect.any(AbortSignal)
    );
    expect(asr.transcribeChunk).toHaveBeenCalledWith(expect.objectContaining({ audioFile: "/tmp/videoanalyze/run_1/chunk-1.flac" }));
    expect(state.completedChunkIndexes).toEqual([0, 1]);
    expect(state.savedChunkIndexes).toEqual([1]);
  });

  it("stops before creating chunk metadata when the run loses its stage fence", async () => {
    const { createV0AnalysisRunner } = await import("./v0-runner.js");
    const state = createFakeState();
    const getChunks = vi.fn(state.getChunks);
    state.getChunks = getChunks;
    state.setStage = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const runner = createV0AnalysisRunner({
      asr: { transcribeChunk: vi.fn() },
      media: { extractAudio: vi.fn(), renderChunk: vi.fn() },
      state
    });

    await expect(runner.run({
      userId: "user_1",
      videoId: "video_1",
      runId: "run_1",
      signal: new AbortController().signal
    })).rejects.toThrow("analysis run is no longer writable");

    expect(getChunks).not.toHaveBeenCalled();
  });

  it("passes the exact WAV chunk duration and cancellation signal to Qwen", async () => {
    const { createV0AnalysisRunner } = await import("./v0-runner.js");
    const asr = { transcribeChunk: vi.fn().mockResolvedValue({ segments: [{ start: 1, end: 2, text: "Qwen transcript" }] }) };
    const state = createFakeState();
    const controller = new AbortController();
    const media = { extractAudio: vi.fn(), renderChunk: vi.fn(async (_input: string, output: string) => ({ path: output, size: 100 })) };
    await createV0AnalysisRunner({ asr, media, state, audioFormat: "wav" }).run({ userId: "u", videoId: "v", runId: "run_1", signal: controller.signal });
    expect(asr.transcribeChunk).toHaveBeenCalledExactlyOnceWith({ audioFile: "/tmp/videoanalyze/run_1/chunk-1.wav", durationSeconds: 10, signal: controller.signal, language: null, timestampLevel: "segment" });
  });

  it("retries only the current chunk after temporary stream errors without rendering or saving it twice", async () => {
    const state = createFakeState();
    const asr = { transcribeChunk: vi.fn().mockRejectedValueOnce(new ProviderError("server_error", "temporary stream failure")).mockRejectedValueOnce(new ProviderError("rate_limited", "slow down")).mockResolvedValue({ segments: [] }) };
    const media = { extractAudio: vi.fn(), renderChunk: vi.fn().mockResolvedValue({ path: "/tmp/chunk.wav", size: 100 }) };
    const waitForRetry = vi.fn().mockResolvedValue(undefined);
    const signal = new AbortController().signal;
    await createV0AnalysisRunner({ asr, media, state, waitForRetry }).run({ userId: "u", videoId: "v", runId: "run_1", signal });
    expect(asr.transcribeChunk).toHaveBeenCalledTimes(3);
    expect(media.renderChunk).toHaveBeenCalledTimes(1);
    expect(waitForRetry.mock.calls).toEqual([[1000, signal], [10000, signal]]);
    expect(state.savedChunkIndexes).toEqual([1]);
    expect(state.completedChunkIndexes).toEqual([0, 1]);
  });

  it.each([["server_error", 3], ["unauthorized", 1], ["invalid_request", 1]] as const)("bounds retries of %s to %s attempts and preserves completed chunks", async (kind, attempts) => {
    const state = createFakeState();
    const error = new ProviderError(kind, "final safe failure");
    const asr = { transcribeChunk: vi.fn().mockRejectedValue(error) };
    const waitForRetry = vi.fn().mockResolvedValue(undefined);
    const media = { extractAudio: vi.fn(), renderChunk: vi.fn().mockResolvedValue({ path: "/tmp/chunk.wav", size: 100 }) };
    await expect(createV0AnalysisRunner({ asr, media, state, waitForRetry }).run({ userId: "u", videoId: "v", runId: "run_1", signal: new AbortController().signal })).rejects.toBe(error);
    expect(asr.transcribeChunk).toHaveBeenCalledTimes(attempts);
    expect(state.savedChunkIndexes).toEqual([]);
    expect(state.completedChunkIndexes).toEqual([0]);
  });

  it("honors database cancellation during retry backoff", async () => {
    const state = { ...createFakeState(), isCancelling: vi.fn().mockResolvedValue(false) };
    const asr = { transcribeChunk: vi.fn().mockRejectedValue(new ProviderError("network_error", "disconnected")) };
    const waitForRetry = vi.fn(async () => { state.isCancelling.mockResolvedValue(true); });
    const media = { extractAudio: vi.fn(), renderChunk: vi.fn().mockResolvedValue({ path: "/tmp/chunk.wav", size: 100 }) };
    await expect(createV0AnalysisRunner({ asr, media, state, waitForRetry }).run({ userId: "u", videoId: "v", runId: "run_1", signal: new AbortController().signal })).rejects.toMatchObject({ name: "AnalysisCancelledError" });
    expect(asr.transcribeChunk).toHaveBeenCalledTimes(1);
    expect(state.savedChunkIndexes).toEqual([]);
  });

  it("recovers malformed ASR output by retrying only the current chunk", async () => {
    const state = createFakeState();
    const asr = { transcribeChunk: vi.fn().mockRejectedValueOnce(new InvalidProviderOutputError("Qwen ASR response omitted valid segments")).mockResolvedValue({ segments: [] }) };
    const media = { extractAudio: vi.fn(), renderChunk: vi.fn().mockResolvedValue({ path: "/tmp/chunk.wav", size: 100 }) };
    await createV0AnalysisRunner({ asr, media, state, waitForRetry: vi.fn().mockResolvedValue(undefined) }).run({ userId: "u", videoId: "v", runId: "run_1", signal: new AbortController().signal });
    expect(asr.transcribeChunk).toHaveBeenCalledTimes(2);
    expect(media.renderChunk).toHaveBeenCalledTimes(1);
    expect(state.savedChunkIndexes).toEqual([1]);
  });

  it("splits persistently malformed audio once and restores offsets before saving the original chunk", async () => {
    const state = { ...createFakeState(),
      getRun: vi.fn().mockResolvedValue({ inputVideoPath: "/tmp/original", audioPath: "/tmp/audio.flac", duration: 680 }),
      getChunks: vi.fn().mockResolvedValue([{ index: 5, start: 560, end: 680, status: "pending", transcript: null }]),
      saveChunkTranscript: vi.fn()
    };
    const malformed = new InvalidProviderOutputError("Qwen ASR response omitted valid segments");
    const asr = { transcribeChunk: vi.fn().mockRejectedValueOnce(malformed).mockRejectedValueOnce(malformed).mockRejectedValueOnce(malformed)
      .mockResolvedValue({ segments: [{ start: 1, end: 10, text: "speech" }] }) };
    const media = { extractAudio: vi.fn(), renderChunk: vi.fn(async (_audio, path) => ({ path, size: 100 })) };
    await createV0AnalysisRunner({ asr, media, state, audioFormat: "wav", waitForRetry: vi.fn().mockResolvedValue(undefined) }).run({ userId: "u", videoId: "v", runId: "run_1", signal: new AbortController().signal });
    expect(asr.transcribeChunk).toHaveBeenCalledTimes(5);
    expect(media.renderChunk.mock.calls.map((call) => call.slice(2, 4))).toEqual([[560, 120], [560, 60], [620, 60]]);
    expect(state.saveChunkTranscript).toHaveBeenCalledExactlyOnceWith("run_1", 5, [{ start: 1, end: 10, text: "speech" }, { start: 61, end: 70, text: "speech" }]);
  });

  it("bounds the split fallback and never saves a partial transcript", async () => {
    const state = { ...createFakeState(), getChunks: vi.fn().mockResolvedValue([{ index: 0, start: 0, end: 120, status: "pending", transcript: null }]), saveChunkTranscript: vi.fn() };
    const asr = { transcribeChunk: vi.fn().mockRejectedValue(new InvalidProviderOutputError("bad output")) };
    const media = { extractAudio: vi.fn(), renderChunk: vi.fn(async (_audio, path) => ({ path, size: 100 })) };
    await expect(createV0AnalysisRunner({ asr, media, state, waitForRetry: vi.fn().mockResolvedValue(undefined) }).run({ userId: "u", videoId: "v", runId: "run_1", signal: new AbortController().signal })).rejects.toBeInstanceOf(InvalidProviderOutputError);
    expect(asr.transcribeChunk).toHaveBeenCalledTimes(6);
    expect(media.renderChunk).toHaveBeenCalledTimes(2);
    expect(state.saveChunkTranscript).not.toHaveBeenCalled();
  });

  it("cancels an in-progress retry wait without starting another request", async () => {
    const state = createFakeState();
    const controller = new AbortController();
    const asr = { transcribeChunk: vi.fn().mockRejectedValue(new ProviderError("server_error", "unavailable")) };
    const waitForRetry = vi.fn(async () => { controller.abort(); throw controller.signal.reason; });
    const media = { extractAudio: vi.fn(), renderChunk: vi.fn().mockResolvedValue({ path: "/tmp/chunk.wav", size: 100 }) };
    await expect(createV0AnalysisRunner({ asr, media, state, waitForRetry }).run({ userId: "u", videoId: "v", runId: "run_1", signal: controller.signal })).rejects.toMatchObject({ name: "AnalysisCancelledError" });
    expect(asr.transcribeChunk).toHaveBeenCalledTimes(1);
    expect(state.savedChunkIndexes).toEqual([]);
  });
});

function createFakeState() {
  const state = {
    completedChunkIndexes: [] as number[],
    savedChunkIndexes: [] as number[],
    async getRun() {
      return { inputVideoPath: "/tmp/videoanalyze/run_1/original", audioPath: "/tmp/videoanalyze/run_1/audio.flac", duration: 20 };
    },
    async getChunks() {
      return [
        { index: 0, start: 0, end: 10, status: "completed" as const, transcript: [{ start: 0, end: 2, text: "done" }] },
        { index: 1, start: 10, end: 20, status: "pending" as const, transcript: null }
      ];
    },
    ensureBilling: vi.fn().mockResolvedValue({ billingRuleVersion: "duration-tiered-v2", billedDurationSeconds: 20, billedMinutes: 1, reservedCredits: 1 }),
    async setStage(...args: [string, string, number?]) { void args; return true; },
    async markChunkProcessing() {},
    async saveChunkTranscript(_runId: string, index: number) { state.savedChunkIndexes.push(index); },
    async markChunkCompleted(_runId: string, index: number) { state.completedChunkIndexes.push(index); },
    async saveTranscript() {}
  };
  state.completedChunkIndexes.push(0);
  return state;
}
