import { randomUUID } from "node:crypto";
import { DomainError } from "@videoanalyze/domain";
import type { ObjectStorage } from "./object-storage.js";
import { createOriginalVideoKey } from "./object-keys.js";
import { validateUploadInput } from "./upload-validation.js";

type UploadVideoRepository = {
  create(input: { id?: string; userId: string; objectKey: string; fileName: string; fileSize?: number }): Promise<{ id: string; objectKey: string }>;
};

export function createUploadService(dependencies: {
  videos: UploadVideoRepository;
  storage: ObjectStorage;
  maxBytes: number;
  maxDurationSeconds: number;
}) {
  return {
    async start(input: { userId: string; fileName: string; contentType: string; contentLength: number }) {
      try {
        validateUploadInput(input, dependencies);
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid upload";
        const code = message.includes("size") ? "UPLOAD_TOO_LARGE" : "UNSUPPORTED_MEDIA";
        throw new DomainError(code, message, 400);
      }

      const videoId = randomUUID();
      const objectKey = createOriginalVideoKey(input.userId, videoId, input.fileName);
      const video = await dependencies.videos.create({ id: videoId, userId: input.userId, objectKey, fileName: input.fileName, fileSize: input.contentLength });
      const upload = await dependencies.storage.createUpload({ objectKey: video.objectKey, contentType: input.contentType, contentLength: input.contentLength });
      return { videoId: video.id, objectKey: video.objectKey, uploadUrl: upload.uploadUrl, expiresAt: upload.expiresAt };
    }
  };
}
