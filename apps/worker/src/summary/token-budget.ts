import type { TranscriptSegment } from "@videoanalyze/domain";

export type SummaryPlan = "single" | "map_reduce";

export function estimateTranscriptTokens(segments: TranscriptSegment[]) {
  return segments.reduce((total, segment) => total + Math.ceil((segment.text.length + 24) / 4), 0);
}

export function chooseSummaryPlan(input: { estimatedInputTokens: number; contextWindow: number; segmentCount: number }): SummaryPlan {
  const inputBudget = Math.floor(input.contextWindow * 0.6);
  return input.estimatedInputTokens > inputBudget ? "map_reduce" : "single";
}
