import { S3Client } from "@aws-sdk/client-s3";

export function createS3Client(input: {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
}) {
  return new S3Client({
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: true,
    credentials: { accessKeyId: input.accessKey, secretAccessKey: input.secretKey },
    requestChecksumCalculation: "WHEN_REQUIRED"
  });
}
