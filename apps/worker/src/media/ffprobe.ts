import { mediaInfoSchema, type MediaInfo } from "@videoanalyze/domain";

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  tags?: { language?: string };
};

export function parseFfprobeJson(output: string): MediaInfo {
  const payload = JSON.parse(output) as { format?: { format_name?: string; duration?: string }; streams?: FfprobeStream[] };
  const streams = payload.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video?.codec_name || !payload.format?.format_name || payload.format.duration === undefined) {
    throw new Error("ffprobe output is missing required media metadata");
  }

  const audioTracks = streams
    .filter((stream) => stream.codec_type === "audio")
    .map((stream, index) => ({ index, codec: stream.codec_name ?? "unknown", language: stream.tags?.language ?? null, channels: stream.channels ?? null }));
  if (audioTracks.length === 0) throw new Error("video contains no audio track; V0 transcription requires audio");

  return mediaInfoSchema.parse({
    duration: Number(payload.format.duration),
    container: payload.format.format_name.split(",")[0],
    videoCodec: video.codec_name,
    audioTracks
  });
}
