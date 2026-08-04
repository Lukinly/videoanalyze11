const acceptedContentTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"]);

export function validateUploadInput(
  input: { fileName: string; contentType: string; contentLength: number },
  limits: { maxBytes: number; maxDurationSeconds?: number }
): void {
  if (!Number.isSafeInteger(input.contentLength) || input.contentLength <= 0) {
    throw new Error("upload size must be a positive integer");
  }
  if (input.contentLength > limits.maxBytes) throw new Error("upload exceeds size limit");
  if (!acceptedContentTypes.has(input.contentType.toLowerCase())) throw new Error("unsupported video content type");
  if (!input.fileName.trim()) throw new Error("file name is required");
  void limits.maxDurationSeconds;
}
