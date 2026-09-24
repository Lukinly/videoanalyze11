import { mediaInfoSchema, type MediaInfo } from "@videoanalyze/domain";

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  tags?: { language?: string };
};
type FfprobePayload = { format?: { format_name?: string; duration?: string }; streams?: FfprobeStream[] };
export type AudioMediaInfo = Pick<MediaInfo, "duration" | "container" | "audioTracks">;

export function parseFfprobeJson(output: string): MediaInfo {
  const payload = JSON.parse(output) as FfprobePayload;
  const audio = parseAudioPayload(payload);
  const streams = payload.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video?.codec_name) {
    throw new Error("ffprobe output is missing required media metadata");
  }

  return mediaInfoSchema.parse({
    ...audio,
    videoCodec: video.codec_name,
  });
}

export function parseAudioFfprobeJson(output: string): AudioMediaInfo {
  return parseAudioPayload(JSON.parse(output) as FfprobePayload);
}

function parseAudioPayload(payload: FfprobePayload): AudioMediaInfo {
  if (!payload.format?.format_name || payload.format.duration === undefined) {
    throw new Error("ffprobe output is missing required media metadata");
  }
  const duration = Number(payload.format.duration);
  if (!Number.isFinite(duration) || duration < 0) throw new Error("ffprobe output is missing required media metadata");
  const audioTracks = (payload.streams ?? [])
    .filter((stream) => stream.codec_type === "audio")
    .map((stream, index) => ({ index, codec: stream.codec_name ?? "unknown", language: stream.tags?.language ?? null, channels: stream.channels ?? null }));
  if (audioTracks.length === 0) throw new Error("media contains no audio track; V0 transcription requires audio");
  return { duration, container: payload.format.format_name.split(",")[0], audioTracks };
}
