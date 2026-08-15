import { z } from "zod";

export const noteCitationSchema = z.object({
  segmentId: z.string().min(1),
  timestampSeconds: z.number().finite().min(0)
});

export const noteSectionSchema = z.object({
  id: z.string().min(1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  citations: z.array(noteCitationSchema).min(1)
});

export const aiNotesSchema = z.object({
  title: z.string().trim().min(1),
  topic: z.string().trim().min(1),
  coreIdeas: z.array(z.string().trim().min(1)).min(1),
  sections: z.array(noteSectionSchema).min(1),
  reviewPoints: z.array(z.string().trim().min(1)).min(1)
});

export type AiNotes = z.infer<typeof aiNotesSchema>;
