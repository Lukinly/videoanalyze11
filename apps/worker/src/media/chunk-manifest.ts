export type ChunkRange = { start: number; end: number };

export type ManifestChunk = ChunkRange & {
  index: number;
  duration: number;
  estimatedBytes: number;
};

export type ChunkManifest = {
  version: 1;
  duration: number;
  targetSeconds: number;
  overlapSeconds: number;
  maxBytes: number;
  chunks: ManifestChunk[];
};

export function buildChunkManifest(input: {
  duration: number;
  targetSeconds: number;
  overlapSeconds: number;
  maxBytes: number;
  estimateBytes: (range: ChunkRange) => number;
}): ChunkManifest {
  if (input.duration <= 0 || input.targetSeconds <= 0 || input.overlapSeconds < 0 || input.overlapSeconds >= input.targetSeconds) {
    throw new Error("invalid chunking parameters");
  }

  const chunks: ManifestChunk[] = [];
  let cursor = 0;
  while (cursor < input.duration) {
    const end = Math.min(input.duration, cursor + input.targetSeconds);
    appendSizedRanges({ start: cursor, end }, input, chunks);
    if (end >= input.duration) break;
    cursor = Math.max(cursor + Number.EPSILON, end - input.overlapSeconds);
  }

  return {
    version: 1,
    duration: input.duration,
    targetSeconds: input.targetSeconds,
    overlapSeconds: input.overlapSeconds,
    maxBytes: input.maxBytes,
    chunks: chunks.map((chunk, index) => ({ ...chunk, index }))
  };
}

function appendSizedRanges(range: ChunkRange, input: { maxBytes: number; overlapSeconds: number; estimateBytes: (range: ChunkRange) => number }, output: ManifestChunk[]) {
  const estimatedBytes = input.estimateBytes(range);
  if (estimatedBytes <= input.maxBytes) {
    output.push({ ...range, duration: range.end - range.start, estimatedBytes, index: -1 });
    return;
  }

  if (range.end - range.start <= 0.5) throw new Error("unable to create a chunk under the provider size limit");
  const midpoint = range.start + (range.end - range.start) / 2;
  appendSizedRanges({ start: range.start, end: midpoint }, input, output);
  appendSizedRanges({ start: Math.max(range.start, midpoint - input.overlapSeconds), end: range.end }, input, output);
}
