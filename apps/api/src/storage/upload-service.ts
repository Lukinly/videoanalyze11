import { randomUUID } from "node:crypto";
import { DomainError } from "@videoanalyze/domain";
import type { ObjectStorage } from "./object-storage.js";
import { createOriginalVideoKey } from "./object-keys.js";
import { validateUploadInput } from "./upload-validation.js";
import { calculateAnalysisCost } from "../credits/credit-cost.js";

type TransientMediaRepository = {
  getLiveBytes(): Promise<number>;
  createTrackedOriginal(input: { userId: string; videoId: string; objectKey: string; fileName: string; sizeBytes: number; expiresAt: Date }): Promise<void>;
};

export function createUploadService(dependencies: {
  transientMedia: TransientMediaRepository;
  storage: Pick<ObjectStorage, "createUpload">;
  maxBytes: number;
  maxDurationSeconds: number;
  transientCapacityBytes: number;
  clock?: () => Date;
  logger?: Pick<Console, "warn">;
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
      const capacityBytes = dependencies.transientCapacityBytes;
      const liveBytes = await dependencies.transientMedia.getLiveBytes();
      const warningBytes = Math.floor(capacityBytes * 0.70);
      const rejectionBytes = Math.floor(capacityBytes * 0.80);
      if (liveBytes + input.contentLength > rejectionBytes) {
        throw new DomainError("TEMP_STORAGE_FULL", "临时存储空间繁忙，请稍后重试", 503);
      }
      if (liveBytes + input.contentLength >= warningBytes) {
        (dependencies.logger ?? console).warn({ liveBytes, incomingBytes: input.contentLength, capacityBytes });
      }

      const now = dependencies.clock?.() ?? new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await dependencies.transientMedia.createTrackedOriginal({
        userId: input.userId,
        videoId,
        objectKey,
        fileName: input.fileName,
        sizeBytes: input.contentLength,
        expiresAt
      });
      const upload = await dependencies.storage.createUpload({ objectKey, contentType: input.contentType, contentLength: input.contentLength });
      return { videoId, objectKey, uploadUrl: upload.uploadUrl, expiresAt: upload.expiresAt, fileSize: input.contentLength, estimatedCost: calculateAnalysisCost(input.contentLength) };
    }
  };
}
