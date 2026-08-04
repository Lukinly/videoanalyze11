import type { TranscriptSegment } from "@videoanalyze/domain";

export type AlignedChapter = {
  id: string;
  sourceSegmentIds: string[];
  start: number;
  end: number;
  alignmentWarning: boolean;
};

export function alignChapter(input: { chapterId: string; sourceSegmentIds: string[]; segments: TranscriptSegment[]; duration: number }): AlignedChapter {
  const byId = new Map(input.segments.map((segment) => [segment.id, segment]));
  const referenced = input.sourceSegmentIds.map((id) => byId.get(id)).filter((segment): segment is TranscriptSegment => Boolean(segment));
  const missingReference = referenced.length !== input.sourceSegmentIds.length;
  if (referenced.length === 0) {
    return { id: input.chapterId, sourceSegmentIds: input.sourceSegmentIds, start: 0, end: Math.max(0, input.duration), alignmentWarning: true };
  }

  const rawStart = Math.min(...referenced.map((segment) => segment.start));
  const rawEnd = Math.max(...referenced.map((segment) => segment.end));
  const start = clamp(rawStart, 0, input.duration);
  const end = clamp(rawEnd, start, input.duration);
  return {
    id: input.chapterId,
    sourceSegmentIds: input.sourceSegmentIds,
    start,
    end,
    alignmentWarning: missingReference || start !== rawStart || end !== rawEnd || end <= start
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
