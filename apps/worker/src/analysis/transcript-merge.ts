import { transcriptSegmentSchema, type TranscriptSegment } from "@videoanalyze/domain";

type ChunkTranscript = {
  start: number;
  end: number;
  segments: Array<{ start: number; end: number; text: string }>;
};

export function mergeChunkTranscripts(input: { videoDuration: number; chunks: ChunkTranscript[] }): { segments: TranscriptSegment[]; mergeWarnings: string[] } {
  const candidates = input.chunks.flatMap((chunk) => chunk.segments.map((segment) => ({
    start: Math.max(0, Math.min(input.videoDuration, chunk.start + segment.start)),
    end: Math.max(0, Math.min(input.videoDuration, chunk.start + segment.end)),
    text: segment.text.trim()
  }))).filter((segment) => segment.end > segment.start && segment.text.length > 0).sort((a, b) => a.start - b.start || a.end - b.end);

  const mergeWarnings: string[] = [];
  const merged: TranscriptSegment[] = [];
  for (const candidate of candidates) {
    const previous = merged.at(-1);
    if (previous && candidate.start < previous.end) {
      if (normalize(previous.text) === normalize(candidate.text)) continue;
      mergeWarnings.push(`uncertain overlap near ${candidate.start.toFixed(3)}s`);
    }
    merged.push(transcriptSegmentSchema.parse({ id: `seg_${merged.length + 1}`, runId: "merged", ...candidate }));
  }
  return { segments: merged, mergeWarnings };
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}
