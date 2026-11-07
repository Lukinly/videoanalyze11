import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { classifyProviderFailure, getRetryDecision, type AsrProvider, type TranscribeChunkResult } from "@videoanalyze/domain";
import { InvalidProviderOutputError } from "../providers/provider-request.js";
import { mergeChunkTranscripts } from "./transcript-merge.js";
import { AnalysisCancelledError, cancellationOutcome } from "./cancellation.js";
import { requireStageUpdate } from "./stage-fence.js";

type ChunkState = {
  index: number;
  start: number;
  end: number;
  status: "pending" | "processing" | "completed" | "failed";
  transcript: Array<{ start: number; end: number; text: string }> | null;
};

type RunnerState = {
  getRun(runId: string): Promise<{ inputVideoPath: string; audioPath: string; duration: number }>;
  ensureBilling(runId: string, durationSeconds: number): Promise<unknown>;
  getChunks(runId: string): Promise<ChunkState[]>;
  setStage(runId: string, stage: string, progress?: number): Promise<boolean>;
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

export function createV0AnalysisRunner(dependencies: { asr: Pick<AsrProvider, "transcribeChunk">; media: Media; state: RunnerState; audioFormat?: "wav" | "flac"; waitForRetry?: (ms: number, signal: AbortSignal) => Promise<void>; onRecovery?: (event: { chunkIndex: number; action: "retry" | "split"; attempt?: number; kind: string }) => void }) {
  return {
    async run(input: { userId: string; videoId: string; runId: string; signal: AbortSignal }): Promise<void> {
      let processingStarted = false;
      await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
      await requireStageUpdate(() => dependencies.state.setStage(input.runId, "probing", 0.02));
      const run = await dependencies.state.getRun(input.runId);
      await dependencies.state.ensureBilling(input.runId, run.duration);
      await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
      await requireStageUpdate(() => dependencies.state.setStage(input.runId, "extracting_audio", 0.1));
      await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
      await dependencies.media.extractAudio(run.inputVideoPath, run.audioPath, 0, input.signal);
      processingStarted = true;

      await requireStageUpdate(() => dependencies.state.setStage(input.runId, "transcribing", 0.2));
      const chunks = await dependencies.state.getChunks(input.runId);
      const completedTranscripts: Array<{ start: number; end: number; segments: Array<{ start: number; end: number; text: string }> }> = [];

      for (const chunk of chunks) {
        await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
        if (chunk.status === "completed" && chunk.transcript) {
          completedTranscripts.push({ start: chunk.start, end: chunk.end, segments: chunk.transcript });
          continue;
        }

        await dependencies.state.markChunkProcessing(input.runId, chunk.index);
        const rendered = await dependencies.media.renderChunk(run.audioPath, join(dirname(run.audioPath), `chunk-${chunk.index}.${dependencies.audioFormat ?? "flac"}`), chunk.start, chunk.end - chunk.start, input.signal);
        let result: TranscribeChunkResult;
        try { result = await transcribeWithRetry(rendered.path, chunk.end - chunk.start); }
        catch (error) {
          // Retry accepted-but-malformed model output with smaller audio. This
          // is bounded to one split and never applies to rejected input/auth.
          if (!(error instanceof InvalidProviderOutputError) || chunk.end - chunk.start < 30) throw error;
          dependencies.onRecovery?.({ chunkIndex: chunk.index, action: "split", kind: "invalid_output" });
          const duration = chunk.end - chunk.start;
          const segments: TranscribeChunkResult["segments"] = [];
          for (let part = 0; part < 2; part++) {
            await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
            const offset = part * duration / 2;
            const subChunk = await dependencies.media.renderChunk(run.audioPath, join(dirname(run.audioPath), `chunk-${chunk.index}-part-${part}.${dependencies.audioFormat ?? "flac"}`), chunk.start + offset, duration / 2, input.signal);
            const transcribed = await transcribeWithRetry(subChunk.path, duration / 2);
            segments.push(...transcribed.segments.map((segment) => ({ ...segment, start: segment.start + offset, end: segment.end + offset })));
          }
          result = { segments };
        }
        async function transcribeWithRetry(audioFile: string, durationSeconds: number) {
          for (let attempt = 1; ; attempt++) {
            await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
            try {
              return await dependencies.asr.transcribeChunk({ audioFile, durationSeconds, signal: input.signal, language: null, timestampLevel: "segment" });
            } catch (error) {
              await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
              const failure = classifyProviderFailure(error);
              const invalidOutput = error instanceof InvalidProviderOutputError;
              const decision = getRetryDecision(invalidOutput ? { ...failure, kind: "server_error" } : failure, attempt);
              if (!decision.retry) throw error;
              dependencies.onRecovery?.({ chunkIndex: chunk.index, action: "retry", attempt, kind: invalidOutput ? "invalid_output" : failure.kind });
              const delayMs = Math.min(30_000, Math.max(decision.delayMs, failure.kind === "rate_limited" ? 5_000 * attempt : 0));
              const wait = dependencies.waitForRetry ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
              try { await wait(delayMs, input.signal); }
              catch (waitError) {
                await assertNotCancelled(input.runId, input.signal, processingStarted, dependencies.state.isCancelling);
                throw waitError;
              }
            }
          }
        }
        await dependencies.state.saveChunkTranscript(input.runId, chunk.index, result.segments);
        await dependencies.state.markChunkCompleted(input.runId, chunk.index);
        completedTranscripts.push({ start: chunk.start, end: chunk.end, segments: result.segments });
        await requireStageUpdate(() => dependencies.state.setStage(input.runId, "transcribing", 0.2 + 0.7 * completedTranscripts.length / chunks.length));
      }

      const merged = mergeChunkTranscripts({ videoDuration: run.duration, chunks: completedTranscripts });
      await dependencies.state.saveTranscript(input.runId, merged.segments, merged.mergeWarnings);
      // Do not mark the run completed here: the orchestrator (worker-main) runs
      // the optional v1 summary before the run is finalized.
      await requireStageUpdate(() => dependencies.state.setStage(input.runId, "merging_transcript", 0.95));
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
