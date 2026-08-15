import { describe, expect, it, vi } from "vitest";

describe("v0 analysis runner", () => {
  it("marks a run as probing before loading the source media", async () => {
    const { createV0AnalysisRunner } = await import("./v0-runner.js");
    const state = createFakeState();
    const stageCalls: string[] = [];
    state.setStage = async (_runId: string, stage: string) => { stageCalls.push(stage); };
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
    async setStage(...args: [string, string, number?]) { void args; },
    async markChunkProcessing() {},
    async saveChunkTranscript(_runId: string, index: number) { state.savedChunkIndexes.push(index); },
    async markChunkCompleted(_runId: string, index: number) { state.completedChunkIndexes.push(index); },
    async saveTranscript() {}
  };
  state.completedChunkIndexes.push(0);
  return state;
}
