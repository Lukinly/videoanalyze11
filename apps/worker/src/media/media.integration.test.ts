import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("linux ffmpeg media fixture", () => {
  it.each([
    { extension: "mp4", video: "libx264", codec: "h264", audio: "aac" },
    { extension: "mkv", video: "libx264", codec: "h264", audio: "libmp3lame" },
    { extension: "webm", video: "libvpx-vp9", codec: "vp9", audio: "libopus" }
  ])("normalizes $extension/$audio to bounded mono PCM WAV for ASR", async ({ extension, video, codec, audio: audioCodec }) => {
    const { createProcessRunner } = await import("./process-runner.js");
    const { createMediaProcessor } = await import("./media-processor.js");
    const directory = await mkdtemp(join(tmpdir(), "videoanalyze-media-"));
    const runner = createProcessRunner();
    const input = join(directory, `fixture.${extension}`);
    const audio = join(directory, "fixture.flac");

    try {
      await runner.run("ffmpeg", [
        "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=160x90:d=1",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=1",
        "-shortest", "-c:v", video, "-pix_fmt", "yuv420p", "-c:a", audioCodec, "-ac", "2", "-ar", "48000", input
      ]);
      const processor = createMediaProcessor({ runner });
      const metadata = await processor.probe(input);
      await processor.extractAudio(input, audio);

      expect(metadata.videoCodec).toBe(codec);
      expect(metadata.audioTracks).toHaveLength(1);
      expect((await stat(audio)).size).toBeGreaterThan(0);
      const wav = join(directory, "qwen.wav");
      await processor.renderChunk(audio, wav, 0, 1);
      const wavInfo = await processor.probeAudio(wav);
      expect(wavInfo.duration).toBeCloseTo(1, 1);
      expect(wavInfo.audioTracks[0]).toMatchObject({ codec: "pcm_s16le", channels: 1 });
      expect((await stat(wav)).size).toBeLessThan(33000);
      const framePath = join(directory, "note.jpg");
      const dataUrl = await processor.captureFrame({ path: input }, framePath, 0.5);
      expect(dataUrl).toMatch(/^data:image\/jpeg;base64,\/9j\//);
      await expect(stat(framePath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
