import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it } from "vitest";
import { createS3Client } from "./s3-client.js";

describe("S3 client", () => {
  it("does not add a placeholder checksum to browser upload signatures", async () => {
    const client = createS3Client({
      endpoint: "http://storage.localhost",
      region: "us-east-1",
      accessKey: "test-access",
      secretKey: "test-secret"
    });
    const url = await getSignedUrl(client, new PutObjectCommand({
      Bucket: "videoanalyze",
      Key: "users/u1/videos/v1/original",
      ContentType: "video/mp4",
      ContentLength: 10
    }), { expiresIn: 900 });
    const query = new URL(url).searchParams;

    expect(query.has("x-amz-sdk-checksum-algorithm")).toBe(false);
    expect(query.has("x-amz-checksum-crc32")).toBe(false);
  });
});
