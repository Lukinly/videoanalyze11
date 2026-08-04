import { describe, expect, it, vi } from "vitest";

describe("v0 analysis runner", () => {
  it("does not call ASR for a completed chunk during resume", async () => {
    const { createV0AnalysisRunner } = await import("./v0-runner.js");
    const asr = { transcribeChunk: vi.fn().mockResolvedValue({ segments: [{ start: 0, end: 2, text: "new" }] }) };
    const state = createFakeState();
    const media = {
      extractAudio: vi.fn(),
      renderChunk: vi.fn().mockResolvedValue({ path: "/tmp/chunk-1.flac", size: 10 })
    };
    const runner = createV0AnalysisRunner({ asr, media, state });

    await runner.run({ userId: "user_1", videoId: "video_1", runId: "run_1", signal: new AbortController().signal });

    expect(asr.transcribeChunk).toHaveBeenCalledTimes(1);
    expect(asr.transcribeChunk).toHaveBeenCalledWith(expect.objectContaining({ audioFile: "/tmp/chunk-1.flac" }));
    expect(state.completedChunkIndexes).toEqual([0, 1]);
    expect(state.savedChunkIndexes).toEqual([1]);
  });
});

function createFakeState() {
  const state = {
    completedChunkIndexes: [] as number[],
    savedChunkIndexes: [] as number[],
    async getRun() {
      return { inputVideoPath: "/tmp/video.mp4", audioPath: "/tmp/audio.flac", duration: 20 };
    },
    async getChunks() {
      return [
        { index: 0, start: 0, end: 10, status: "completed" as const, transcript: [{ start: 0, end: 2, text: "done" }] },
        { index: 1, start: 10, end: 20, status: "pending" as const, transcript: null }
      ];
    },
    async setStage() {},
    async markChunkProcessing() {},
    async saveChunkTranscript(_runId: string, index: number) { state.savedChunkIndexes.push(index); },
    async markChunkCompleted(_runId: string, index: number) { state.completedChunkIndexes.push(index); },
    async saveTranscript() {}
  };
  state.completedChunkIndexes.push(0);
  return state;
}
