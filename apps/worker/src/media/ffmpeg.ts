export function buildExtractAudioArgs(inputPath: string, outputPath: string, audioIndex: number): string[] {
  return ["-i", inputPath, "-ar", "16000", "-ac", "1", "-map", `0:a:${audioIndex}`, "-c:a", "flac", "-y", outputPath];
}

export function buildAudioChunkArgs(inputPath: string, outputPath: string, start: number, duration: number): string[] {
  // Re-encode instead of -c copy: a stream-copied FLAC slice keeps the source's
  // STREAMINFO total-samples value, so a tail chunk's declared duration far
  // exceeds its actual samples and the ASR provider rejects it (502).
  return ["-ss", String(start), "-i", inputPath, "-t", String(duration), "-c:a", "flac", "-y", outputPath];
}

export function buildRemuxArgs(inputPath: string, outputPath: string): string[] {
  return ["-i", inputPath, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-c", "copy", "-y", outputPath];
}
