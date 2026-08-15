import { dirname, join } from "node:path";
import type { AsrProvider } from "@videoanalyze/domain";
import { mergeChunkTranscripts } from "./transcript-merge.js";
import { AnalysisCancelledError, cancellationOutcome } from "./cancellation.js";

type ChunkState = {
  index: number;
  start: number;
  end: number;
  status: "pending" | "processing" | "completed" | "failed";
  transcript: Array<{ start: number; end: number; text: string }> | null;
};

type RunnerState = {
  getRun(runId: string): Promise<{ inputVideoPath: string; audioPath: string; duration: number }>;
  getChunks(runId: string): Promise<ChunkState[]>;
  setStage(runId: string, stage: string, progress?: number): Promise<void>;
  markChunkProcessing(runId: string, index: number): Promise<void>;
  saveChunkTranscript(runId: string, index: number, transcript: Array<{ start: number; end: number; text: string }>): Promise<void>;
  markChunkCompleted(runId: string, index: number): Promise<void>;
  saveTranscript(runId: string, segments: unknown[], mergeWarnings: string[]): Promise<void>;
  isCancelling?: (runId: string) => Promise<boolean>;
};

type Media = {
  extractAudio(videoPath: string, outputPath: string, audioIndex?: number, signal?: AbortSignal): Promise<void>;
  renderChunk(audioPath: string, outputPath: string, start: number, duration: number, signal?: AbortSignal): Promise<{ path: string; size: number }>;
};

export function createV0AnalysisRunner(dependencies: { asr: Pick<AsrProvider, "transcribeChunk">; media: Media; state: RunnerState }) {
  return {
    async run(input: { userId: string; videoId: string; runId: string; signal: AbortSignal }): Promise<void> {
      let processingStarted = false;
      await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
      await dependencies.state.setStage(input.runId, "probing", 0.02);
      const run = await dependencies.state.getRun(input.runId);
      await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
      await dependencies.state.setStage(input.runId, "extracting_audio", 0.1);
      await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
      await dependencies.media.extractAudio(run.inputVideoPath, run.audioPath, 0, input.signal);
      processingStarted = true;

      const chunks = await dependencies.state.getChunks(input.runId);
      await dependencies.state.setStage(input.runId, "transcribing", 0.2);
      const completedTranscripts: Array<{ start: number; end: number; segments: Array<{ start: number; end: number; text: string }> }> = [];

      for (const chunk of chunks) {
        await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
        if (chunk.status === "completed" && chunk.transcript) {
          completedTranscripts.push({ start: chunk.start, end: chunk.end, segments: chunk.transcript });
          continue;
        }

        await dependencies.state.markChunkProcessing(input.runId, chunk.index);
        const rendered = await dependencies.media.renderChunk(run.audioPath, join(dirname(run.audioPath), `chunk-${chunk.index}.flac`), chunk.start, chunk.end - chunk.start, input.signal);
        const result = await dependencies.asr.transcribeChunk({ audioFile: rendered.path, language: null, timestampLevel: "segment" });
        await dependencies.state.saveChunkTranscript(input.runId, chunk.index, result.segments);
        await dependencies.state.markChunkCompleted(input.runId, chunk.index);
        completedTranscripts.push({ start: chunk.start, end: chunk.end, segments: result.segments });
      }

      const merged = mergeChunkTranscripts({ videoDuration: run.duration, chunks: completedTranscripts });
      await dependencies.state.saveTranscript(input.runId, merged.segments, merged.mergeWarnings);
      // Do not mark the run completed here: the orchestrator (worker-main) runs
      // the optional v1 summary before the run is finalized.
      await dependencies.state.setStage(input.runId, "merging_transcript", 0.95);
    }
  };
}

async function assertNotCancelled(
  runId: string,
  signal: AbortSignal,
  processingStarted: boolean,
  isCancelling?: (runId: string) => Promise<boolean>
): Promise<void> {
  if (signal.aborted || await isCancelling?.(runId)) {
    throw new AnalysisCancelledError(cancellationOutcome(processingStarted));
  }
}
