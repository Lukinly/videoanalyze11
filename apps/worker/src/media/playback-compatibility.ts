export type PlaybackAssessment = {
  playable: boolean;
  requiresRemux: boolean;
  reason?: "container_or_codec";
};

export function assessPlaybackCompatibility(input: { container: string; videoCodec: string; audioCodecs: string[] }): PlaybackAssessment {
  const container = input.container.toLowerCase();
  const videoCodec = input.videoCodec.toLowerCase();
  const audioCodec = input.audioCodecs[0]?.toLowerCase();
  const playable = container.includes("mp4") && ["h264", "avc1"].includes(videoCodec) && (!audioCodec || ["aac", "mp4a"].includes(audioCodec));
  return playable ? { playable: true, requiresRemux: false } : { playable: false, requiresRemux: true, reason: "container_or_codec" };
}
