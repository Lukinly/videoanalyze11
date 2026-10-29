/* global console */
import process from "node:process";
import { URL } from "node:url";
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY }
});
try {
  await client.send(new PutBucketCorsCommand({
    Bucket: process.env.S3_BUCKET,
    CORSConfiguration: { CORSRules: [{
      AllowedOrigins: [new URL(process.env.PUBLIC_HOST).origin],
      AllowedMethods: ["GET", "HEAD", "PUT"],
      AllowedHeaders: ["content-type", "range", "x-amz-*"],
      ExposeHeaders: ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
      MaxAgeSeconds: 3600
    }] }
  }));
  console.log("Private storage bucket CORS configured.");
} catch {
  console.error("Storage configuration failed; check storage readiness, keys and bucket settings.");
  process.exitCode = 1;
} finally { client.destroy(); }
