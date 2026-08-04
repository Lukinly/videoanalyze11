export function buildExtractAudioArgs(inputPath: string, outputPath: string, audioIndex: number): string[] {
  return ["-i", inputPath, "-ar", "16000", "-ac", "1", "-map", `0:a:${audioIndex}`, "-c:a", "flac", "-y", outputPath];
}

export function buildAudioChunkArgs(inputPath: string, outputPath: string, start: number, duration: number): string[] {
  return ["-ss", String(start), "-i", inputPath, "-t", String(duration), "-c", "copy", "-y", outputPath];
}

export function buildRemuxArgs(inputPath: string, outputPath: string): string[] {
  return ["-i", inputPath, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-c", "copy", "-y", outputPath];
}
