import { z } from "zod";

export const analysisStageSchema = z.enum([
  "queued",
  "probing",
  "extracting_audio",
  "chunking",
  "transcribing",
  "merging_transcript",
  "summarizing",
  "indexing",
  "completed"
]);

export const analysisStatusSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "cancelled",
  "completed",
  "failed"
]);

export const transcriptSegmentSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  text: z.string().trim().min(1)
}).refine((segment) => segment.end > segment.start, {
  message: "segment end must be greater than start",
  path: ["end"]
});

export const transcriptSchema = z.object({
  segments: z.array(transcriptSegmentSchema),
  mergeWarnings: z.array(z.string().min(1)).default([])
});

export type AnalysisStage = z.infer<typeof analysisStageSchema>;
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
