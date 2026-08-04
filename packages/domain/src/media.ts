import { z } from "zod";

export const mediaAudioTrackSchema = z.object({
  index: z.number().int().nonnegative(),
  codec: z.string().min(1),
  language: z.string().nullable(),
  channels: z.number().int().positive().nullable()
});

export const mediaInfoSchema = z.object({
  duration: z.number().finite().nonnegative(),
  container: z.string().min(1),
  videoCodec: z.string().min(1),
  audioTracks: z.array(mediaAudioTrackSchema)
});

export type MediaAudioTrack = z.infer<typeof mediaAudioTrackSchema>;
export type MediaInfo = z.infer<typeof mediaInfoSchema>;
