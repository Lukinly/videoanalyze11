import type { TranscriptSegment } from "@videoanalyze/domain";
import { estimateTranscriptTokens } from "./token-budget.js";

export type SummaryWindow = {
  segments: TranscriptSegment[];
  estimatedInputTokens: number;
};

export function createSummaryWindows(segments: TranscriptSegment[], contextWindow: number, overlapSeconds = 45): SummaryWindow[] {
  if (segments.length === 0) return [];
  const inputBudget = Math.max(1, Math.floor(contextWindow * 0.6));
  const windows: SummaryWindow[] = [];
  let cursor = 0;

  while (cursor < segments.length) {
    const windowSegments: TranscriptSegment[] = [];
    let estimatedTokens = 0;
    for (let index = cursor; index < segments.length; index += 1) {
      const segmentTokens = estimateTranscriptTokens([segments[index]]);
      if (windowSegments.length > 0 && estimatedTokens + segmentTokens > inputBudget) break;
      windowSegments.push(segments[index]);
      estimatedTokens += segmentTokens;
    }

    windows.push({ segments: windowSegments, estimatedInputTokens: estimatedTokens });
    if (cursor + windowSegments.length >= segments.length) break;

    const overlapStart = windowSegments[windowSegments.length - 1].end - overlapSeconds;
    let nextCursor = cursor + windowSegments.length - 1;
    while (nextCursor > cursor && segments[nextCursor].start >= overlapStart) nextCursor -= 1;
    cursor = Math.max(cursor + 1, nextCursor + 1);
  }

  return windows;
}
