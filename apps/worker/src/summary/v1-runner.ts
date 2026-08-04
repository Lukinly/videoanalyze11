import type { SummaryProvider, SummaryResult, TranscriptSegment } from "@videoanalyze/domain";
import { alignChapter } from "./alignment.js";
import { estimateTranscriptTokens, chooseSummaryPlan } from "./token-budget.js";
import { createSummaryWindows } from "./windowing.js";

type TranscriptState = {
  getTranscript(runId: string): Promise<{ duration: number; segments: TranscriptSegment[] }>;
  setStage(runId: string, stage: string, progress?: number): Promise<void>;
  saveSummary(runId: string, result: SummaryResult & { chapters: Array<SummaryResult["chapters"][number] & ReturnType<typeof alignChapter>> }): Promise<void>;
};

export function createV1SummaryRunner(dependencies: { summary: SummaryProvider; state: TranscriptState }) {
  return {
    async run(input: { runId: string }) {
      const transcript = await dependencies.state.getTranscript(input.runId);
      const capabilities = await dependencies.summary.capabilities();
      const plan = chooseSummaryPlan({ estimatedInputTokens: estimateTranscriptTokens(transcript.segments), contextWindow: capabilities.contextWindow, segmentCount: transcript.segments.length });
      await dependencies.state.setStage(input.runId, "summarizing", 0.1);

      const result = plan === "single"
        ? await summarizeWithRetry(dependencies.summary, { videoDuration: transcript.duration, segments: transcript.segments })
        : await summarizeMapReduce(dependencies.summary, transcript);
      const aligned = {
        ...result,
        chapters: result.chapters.map((chapter) => ({
          ...chapter,
          ...alignChapter({ chapterId: chapter.id, sourceSegmentIds: chapter.sourceSegmentIds, segments: transcript.segments, duration: transcript.duration })
        }))
      };

      await dependencies.state.saveSummary(input.runId, aligned);
      await dependencies.state.setStage(input.runId, "indexing", 0.95);
      return aligned;
    }
  };
}

async function summarizeWithRetry(provider: SummaryProvider, input: { videoDuration: number; segments: TranscriptSegment[] }) {
  try {
    return await provider.summarize(input);
  } catch (firstError) {
    try {
      return await provider.summarize(input);
    } catch {
      throw firstError;
    }
  }
}

async function summarizeMapReduce(provider: SummaryProvider, transcript: { duration: number; segments: TranscriptSegment[] }) {
  const capabilities = await provider.capabilities();
  const windows = createSummaryWindows(transcript.segments, capabilities.contextWindow);
  const mapResults = await Promise.all(windows.map((window) => summarizeWithRetry(provider, { videoDuration: transcript.duration, segments: window.segments })));
  const sourceMap = new Map<string, string[]>();
  const reductionSegments = mapResults.flatMap((result, resultIndex) => result.chapters.map((chapter, chapterIndex) => {
    const id = `map-${resultIndex}-${chapterIndex}`;
    sourceMap.set(id, chapter.sourceSegmentIds);
    const sourceSegments = transcript.segments.filter((segment) => chapter.sourceSegmentIds.includes(segment.id));
    return {
      id,
      runId: transcript.segments[0]?.runId ?? "summary",
      start: sourceSegments.length ? Math.min(...sourceSegments.map((segment) => segment.start)) : 0,
      end: sourceSegments.length ? Math.max(...sourceSegments.map((segment) => segment.end)) : transcript.duration,
      text: `${chapter.title}: ${chapter.summary}`
    };
  }));
  if (reductionSegments.length === 0) return mapResults[0] ?? { oneLineSummary: "", overallSummary: "", chapters: [] };

  const reduced = await summarizeWithRetry(provider, { videoDuration: transcript.duration, segments: reductionSegments });
  return {
    ...reduced,
    chapters: reduced.chapters.map((chapter) => ({
      ...chapter,
      sourceSegmentIds: chapter.sourceSegmentIds.flatMap((id) => sourceMap.get(id) ?? [id])
    }))
  };
}
