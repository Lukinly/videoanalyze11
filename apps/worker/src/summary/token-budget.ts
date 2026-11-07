import type { TranscriptSegment } from "@videoanalyze/domain";

export type SummaryPlan = "single" | "map_reduce";

export function estimateTranscriptTokens(segments: TranscriptSegment[]) {
  return segments.reduce((total, segment) => {
    // Four characters/token is useful for English, but badly undercounts CJK.
    // Include serialized metadata and budget up to two tokens/non-ASCII point.
    const serialized = JSON.stringify(segment);
    const nonAscii = Array.from(serialized).filter((character) => character.codePointAt(0)! > 127).length;
    return total + Math.ceil((serialized.length - nonAscii) / 4) + nonAscii * 2;
  }, 0);
}

export function chooseSummaryPlan(input: { estimatedInputTokens: number; contextWindow: number; segmentCount: number }): SummaryPlan {
  const inputBudget = Math.floor(input.contextWindow * 0.6);
  return input.estimatedInputTokens > inputBudget ? "map_reduce" : "single";
}
