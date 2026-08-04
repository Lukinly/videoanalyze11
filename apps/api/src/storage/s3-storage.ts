import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "./object-storage.js";

type S3ClientLike = { send(command: unknown): Promise<{ ContentLength?: number; ContentType?: string; Body?: NodeJS.ReadableStream }> };
type Presign = (client: unknown, command: unknown, options: { expiresIn: number }) => Promise<string>;

export function createS3ObjectStorage(input: {
  client: S3ClientLike;
  bucket: string;
  presign?: Presign;
  uploadUrlExpiresInSeconds?: number;
}): ObjectStorage {
  const presign = input.presign ?? ((client, command, options) => getSignedUrl(client as never, command as never, options));

  return {
    async createUpload(upload) {
      const command = new PutObjectCommand({
        Bucket: input.bucket,
        Key: upload.objectKey,
        ContentType: upload.contentType,
        ContentLength: upload.contentLength
      });
      const expiresIn = input.uploadUrlExpiresInSeconds ?? 900;
      return { uploadUrl: await presign(input.client, command, { expiresIn }), expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
    },
    async head(objectKey) {
      const result = await input.client.send(new HeadObjectCommand({ Bucket: input.bucket, Key: objectKey }));
      return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? "application/octet-stream" };
    },
    async getDownloadUrl(objectKey, expiresInSeconds) {
      return presign(input.client, new GetObjectCommand({ Bucket: input.bucket, Key: objectKey }), { expiresIn: expiresInSeconds });
    },
    async downloadToFile(objectKey, destination) {
      const result = await input.client.send(new GetObjectCommand({ Bucket: input.bucket, Key: objectKey }));
      if (!result.Body) throw new Error("object storage returned an empty body");
      await pipeline(result.Body, createWriteStream(destination));
    },
    async delete(objectKey) {
      await input.client.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: objectKey }));
    }
  };
}
