import { readFile, rm, stat } from "node:fs/promises";
import { type MediaInfo } from "@videoanalyze/domain";
import { buildAudioChunkArgs, buildExtractAudioArgs, buildRemuxArgs } from "./ffmpeg.js";
import { parseAudioFfprobeJson, parseFfprobeJson } from "./ffprobe.js";
import { createProcessRunner } from "./process-runner.js";

export function createMediaProcessor(input: { ffmpegPath?: string; ffprobePath?: string; runner?: ReturnType<typeof createProcessRunner> }) {
  const ffmpegPath = input.ffmpegPath ?? process.env.FFMPEG_BIN ?? "ffmpeg";
  const ffprobePath = input.ffprobePath ?? process.env.FFPROBE_BIN ?? "ffprobe";
  const runner = input.runner ?? createProcessRunner();

  return {
    async probe(inputPath: string): Promise<MediaInfo> {
      const result = await runner.run(ffprobePath, ["-v", "error", "-show_format", "-show_streams", "-of", "json", inputPath]);
      return parseFfprobeJson(result.stdout);
    },
    async probeAudio(inputPath: string) {
      const result = await runner.run(ffprobePath, ["-v", "error", "-show_format", "-show_streams", "-of", "json", inputPath]);
      return parseAudioFfprobeJson(result.stdout);
    },
    async extractAudio(videoPath: string, outputPath: string, audioIndex = 0, signal?: AbortSignal): Promise<void> {
      await runner.run(ffmpegPath, buildExtractAudioArgs(videoPath, outputPath, audioIndex), { signal });
    },
    async renderChunk(audioPath: string, outputPath: string, start: number, duration: number, signal?: AbortSignal): Promise<{ path: string; size: number }> {
      await runner.run(ffmpegPath, buildAudioChunkArgs(audioPath, outputPath, start, duration), { signal });
      return { path: outputPath, size: (await stat(outputPath)).size };
    },
    async remuxToMp4(inputPath: string, outputPath: string, signal?: AbortSignal): Promise<void> {
      await runner.run(ffmpegPath, buildRemuxArgs(inputPath, outputPath), { signal });
    },
    async captureFrame(source: { path: string; headers?: Record<string, string> }, outputPath: string, seconds: number, signal?: AbortSignal): Promise<string> {
      signal?.throwIfAborted();
      const headers = Object.entries(source.headers ?? {}).filter(([key, value]) =>
        /^[A-Za-z0-9-]+$/.test(key) && !/[\r\n]/.test(value)).map(([key, value]) => `${key}: ${value}\r\n`).join("");
      try {
        await runner.run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin",
          ...(headers ? ["-headers", headers] : []),
          "-ss", String(Math.max(0, seconds)), "-i", source.path,
          "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=w='min(960,iw)':h=-2", "-q:v", "5", "-y", outputPath
        ], { signal, timeoutMs: 20_000, maxOutputBytes: 64 * 1024 });
        const frame = await readFile(outputPath);
        if (frame.length > 250_000 || frame[0] !== 0xff || frame[1] !== 0xd8) throw new Error("invalid or oversized note frame");
        return `data:image/jpeg;base64,${frame.toString("base64")}`;
      } finally {
        await rm(outputPath, { force: true });
      }
    }
  };
}
