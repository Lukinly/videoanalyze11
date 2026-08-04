import { z } from "zod";

const sourceSegmentIdsSchema = z.array(z.string().min(1)).min(1);

export const summaryBulletSchema = z.object({
  text: z.string().trim().min(1),
  sourceSegmentIds: sourceSegmentIdsSchema
});

export const summaryChapterSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  sourceSegmentIds: sourceSegmentIdsSchema,
  summary: z.string().trim().min(1),
  bullets: z.array(summaryBulletSchema)
});

export const summaryResultSchema = z.object({
  oneLineSummary: z.string().trim().min(1),
  overallSummary: z.string().trim().min(1),
  chapters: z.array(summaryChapterSchema).max(15)
});

export type SummaryBullet = z.infer<typeof summaryBulletSchema>;
export type SummaryChapter = z.infer<typeof summaryChapterSchema>;
export type SummaryResult = z.infer<typeof summaryResultSchema>;
