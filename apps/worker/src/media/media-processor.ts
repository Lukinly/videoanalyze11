import { stat } from "node:fs/promises";
import { type MediaInfo } from "@videoanalyze/domain";
import { buildAudioChunkArgs, buildExtractAudioArgs, buildRemuxArgs } from "./ffmpeg.js";
import { parseFfprobeJson } from "./ffprobe.js";
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
    async extractAudio(videoPath: string, outputPath: string, audioIndex = 0, signal?: AbortSignal): Promise<void> {
      await runner.run(ffmpegPath, buildExtractAudioArgs(videoPath, outputPath, audioIndex), { signal });
    },
    async renderChunk(audioPath: string, outputPath: string, start: number, duration: number, signal?: AbortSignal): Promise<{ path: string; size: number }> {
      await runner.run(ffmpegPath, buildAudioChunkArgs(audioPath, outputPath, start, duration), { signal });
      return { path: outputPath, size: (await stat(outputPath)).size };
    },
    async remuxToMp4(inputPath: string, outputPath: string, signal?: AbortSignal): Promise<void> {
      await runner.run(ffmpegPath, buildRemuxArgs(inputPath, outputPath), { signal });
    }
  };
}
