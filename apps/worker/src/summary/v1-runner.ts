import type { SummaryProvider, SummaryResult, TranscriptSegment } from "@videoanalyze/domain";
import { alignChapter, type AlignedChapter } from "./alignment.js";
import { estimateTranscriptTokens, chooseSummaryPlan } from "./token-budget.js";
import { createSummaryWindows } from "./windowing.js";

export type AlignedChapterResult = SummaryResult["chapters"][number] & AlignedChapter;
export type AlignedSummaryResult = {
  oneLineSummary: string;
  overallSummary: string;
  chapters: AlignedChapterResult[];
};

type TranscriptState = {
  getTranscript(runId: string): Promise<{ duration: number; segments: TranscriptSegment[] }>;
  setStage(runId: string, stage: string, progress?: number): Promise<void>;
  saveSummary(runId: string, result: AlignedSummaryResult): Promise<void>;
};

export function createV1SummaryRunner(dependencies: { summary: SummaryProvider; state: TranscriptState }) {
  return {
    async run(input: { runId: string }) {
      const transcript = await dependencies.state.getTranscript(input.runId);
      // Models strip the runId prefix off long segment ids and cite the suffix
      // (they returned "seg_1" for "<runId>_seg_1"), which breaks alignment.
      // Hand them compact ids, then map their citations back before persisting.
      const byCompactId = new Map<string, TranscriptSegment>();
      const compactSegments = transcript.segments.map((segment, index) => {
        const compactId = `seg_${index + 1}`;
        byCompactId.set(compactId, segment);
        return { ...segment, id: compactId };
      });
      const compactTranscript = { duration: transcript.duration, segments: compactSegments };

      const capabilities = await dependencies.summary.capabilities();
      const plan = chooseSummaryPlan({ estimatedInputTokens: estimateTranscriptTokens(compactSegments), contextWindow: capabilities.contextWindow, segmentCount: compactSegments.length });
      await dependencies.state.setStage(input.runId, "summarizing", 0.1);

      const result = plan === "single"
        ? await summarizeWithRetry(dependencies.summary, { videoDuration: compactTranscript.duration, segments: compactSegments })
        : await summarizeMapReduce(dependencies.summary, compactTranscript);
      const aligned: AlignedSummaryResult = {
        ...result,
        chapters: result.chapters.map((chapter) => ({
          ...chapter,
          ...alignChapter({ chapterId: chapter.id, sourceSegmentIds: chapter.sourceSegmentIds, segments: compactSegments, duration: compactTranscript.duration })
        }))
      };

      const persisted = withRealSegmentIds(aligned, byCompactId);
      await dependencies.state.saveSummary(input.runId, persisted);
      await dependencies.state.setStage(input.runId, "indexing", 0.95);
      return persisted;
    }
  };
}

function withRealSegmentIds(result: AlignedSummaryResult, byCompactId: Map<string, TranscriptSegment>): AlignedSummaryResult {
  return {
    ...result,
    chapters: result.chapters.map((chapter) => ({
      ...chapter,
      sourceSegmentIds: chapter.sourceSegmentIds.map((id) => byCompactId.get(id)?.id ?? id),
      bullets: chapter.bullets.map((bullet) => ({ ...bullet, sourceSegmentIds: bullet.sourceSegmentIds.map((id) => byCompactId.get(id)?.id ?? id) }))
    }))
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
