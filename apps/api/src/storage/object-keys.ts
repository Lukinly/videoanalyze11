export function createOriginalVideoKey(userId: string, videoId: string, fileName: string): string {
  void fileName;
  return `users/${encodePathPart(userId)}/videos/${encodePathPart(videoId)}/original`;
}

export function createAnalysisObjectKey(userId: string, runId: string, name: string): string {
  return `users/${encodePathPart(userId)}/runs/${encodePathPart(runId)}/${encodePathPart(name)}`;
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, "_");
}
