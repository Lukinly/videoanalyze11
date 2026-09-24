/* global console */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Buffer } from "node:buffer";

const client = new S3Client({
  endpoint: "https://storage.localhost",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
  requestChecksumCalculation: "WHEN_REQUIRED"
});

const objectKey = "users/debug/videos/debug/original";
const contentType = "video/mp4";
const contentLength = 16;

const command = new PutObjectCommand({ Bucket: "videoanalyze", Key: objectKey, ContentType: contentType, ContentLength: contentLength });
const url = await getSignedUrl(client, command, { expiresIn: 900 });
console.log("SIGNED_URL=" + url);

// PUT via curl (bypass cert check like browser does for a trusted CA; signature check is what matters)
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
writeFileSync("/tmp/test-body.bin", Buffer.alloc(16, 0x61));
const res = execFileSync("curl", ["-sk", "-o", "/dev/null", "-w", "code=%{http_code} err=%{errormsg}", "-X", "PUT", url, "-H", "Content-Type: video/mp4", "--data-binary", "@/tmp/test-body.bin"], { encoding: "utf8" });
console.log("PUT result: " + res);
