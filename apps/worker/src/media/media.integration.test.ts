import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("linux ffmpeg media fixture", () => {
  it("probes a playable mp4 and extracts mono flac audio", async () => {
    const { createProcessRunner } = await import("./process-runner.js");
    const { createMediaProcessor } = await import("./media-processor.js");
    const directory = await mkdtemp(join(tmpdir(), "videoanalyze-media-"));
    const runner = createProcessRunner();
    const input = join(directory, "fixture.mp4");
    const audio = join(directory, "fixture.flac");

    try {
      await runner.run("ffmpeg", [
        "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=160x90:d=1",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=1",
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", input
      ]);
      const processor = createMediaProcessor({ runner });
      const metadata = await processor.probe(input);
      await processor.extractAudio(input, audio);

      expect(metadata.videoCodec).toBe("h264");
      expect(metadata.audioTracks).toHaveLength(1);
      expect((await stat(audio)).size).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
