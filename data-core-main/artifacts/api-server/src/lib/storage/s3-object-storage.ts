/**
 * F10.4 — S3-compatible object storage (optional).
 * Env: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION
 */
import { logger } from "../logger";

export function isS3ObjectStorageEnabled(): boolean {
  return Boolean(
    process.env.S3_BUCKET?.trim() &&
      process.env.S3_ACCESS_KEY?.trim() &&
      process.env.S3_SECRET_KEY?.trim(),
  );
}

export type PutObjectInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

/** Minimal PUT via AWS SDK v3 dynamic import when configured. */
export async function putObjectS3(input: PutObjectInput): Promise<string> {
  if (!isS3ObjectStorageEnabled()) {
    throw new Error("S3 object storage is not configured");
  }
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
  const publicBase = process.env.S3_PUBLIC_BASE_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, "")}/${input.key}`;
  }
  logger.info({ key: input.key }, "S3 object stored");
  return `s3://${process.env.S3_BUCKET}/${input.key}`;
}
