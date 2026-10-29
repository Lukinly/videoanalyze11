import { z } from "zod";
import type { TranscriptSegment } from "./analysis.js";

// Kept inside the notes result so images share its ownership and expiry.
export const noteFrameSchema = z.object({
  timestampSeconds: z.number().finite().min(0),
  dataUrl: z.string().max(350_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
});

export const noteCitationSchema = z.object({
  segmentId: z.string().min(1),
  timestampSeconds: z.number().finite().min(0)
});

export const noteSectionSchema = z.object({
  id: z.string().min(1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  citations: z.array(noteCitationSchema).min(1),
  frame: noteFrameSchema.optional()
});

export const aiNotesSchema = z.object({
  title: z.string().trim().min(1),
  topic: z.string().trim().min(1),
  coreIdeas: z.array(z.string().trim().min(1)).min(1),
  sections: z.array(noteSectionSchema).min(1),
  reviewPoints: z.array(z.string().trim().min(1)).min(1)
});

export type AiNotes = z.infer<typeof aiNotesSchema>;

export function noteSectionTimeline(section: AiNotes["sections"][number], segments: TranscriptSegment[] = []) {
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const sources = section.citations.map((citation) => {
    const segment = byId.get(citation.segmentId);
    return { start: segment?.start ?? citation.timestampSeconds, end: segment?.end ?? citation.timestampSeconds };
  }).sort((a, b) => a.start - b.start);
  return {
    start: sources[0]?.start ?? 0,
    end: Math.max(0, ...sources.map((source) => source.end)),
    frameSeconds: sources[Math.floor(sources.length / 2)]?.start ?? 0
  };
}
