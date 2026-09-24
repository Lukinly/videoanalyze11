import { describe, expect, it } from "vitest";

describe("media processing", () => {
  it("creates stable overlapping chunks", async () => {
    const { buildChunkManifest } = await import("./chunk-manifest.js");
    const input = { duration: 1250, targetSeconds: 600, overlapSeconds: 8, maxBytes: 20_000_000, estimateBytes: () => 1_000_000 };

    const manifest = buildChunkManifest(input);

    expect(manifest.chunks.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 0, end: 600 },
      { start: 592, end: 1192 },
      { start: 1184, end: 1250 }
    ]);
    expect(buildChunkManifest(input)).toEqual(manifest);
  });

  it("splits an oversized range until every chunk is under the limit", async () => {
    const { buildChunkManifest } = await import("./chunk-manifest.js");
    const manifest = buildChunkManifest({
      duration: 100,
      targetSeconds: 100,
      overlapSeconds: 5,
      maxBytes: 100,
      estimateBytes: ({ start, end }) => (end - start) * 2
    });

    expect(manifest.chunks.length).toBeGreaterThan(1);
    expect(manifest.chunks.every((chunk) => chunk.estimatedBytes <= 100)).toBe(true);
  });

  it("re-encodes chunk slices so FLAC STREAMINFO matches the true chunk duration", async () => {
    const { buildAudioChunkArgs } = await import("./ffmpeg.js");
    expect(buildAudioChunkArgs("audio.flac", "chunk-1.flac", 600, 38.7)).toEqual([
      "-ss", "600", "-i", "audio.flac", "-t", "38.7", "-c:a", "flac", "-y", "chunk-1.flac"
    ]);
  });

  it("uses the first audio stream and mono 16 kHz output", async () => {
    const { buildExtractAudioArgs } = await import("./ffmpeg.js");
    expect(buildExtractAudioArgs("input.mp4", "audio.flac", 0)).toEqual([
      "-i", "input.mp4", "-ar", "16000", "-ac", "1", "-map", "0:a:0", "-c:a", "flac", "-y", "audio.flac"
    ]);
  });

  it("remuxes only the first video and audio streams", async () => {
    const { buildRemuxArgs } = await import("./ffmpeg.js");
    expect(buildRemuxArgs("input.mkv", "output.mp4")).toEqual([
      "-i", "input.mkv", "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-c", "copy", "-y", "output.mp4"
    ]);
  });

  it("parses duration, codecs, and audio track metadata from ffprobe JSON", async () => {
    const { parseFfprobeJson } = await import("./ffprobe.js");
    expect(parseFfprobeJson(JSON.stringify({
      format: { format_name: "mp4", duration: "42.5" },
      streams: [
        { codec_type: "video", codec_name: "h264" },
        { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } }
      ]
    }))).toEqual({
      duration: 42.5,
      container: "mp4",
      videoCodec: "h264",
      audioTracks: [{ index: 0, codec: "aac", language: "eng", channels: 2 }]
    });
  });
});
