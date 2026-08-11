import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { EXPORT_RETENTION_DAYS, FILE_RETENTION_MS } from "./file-policy";

const FILE_PREFIX = "files/";
const EXPORT_PREFIX = "exports/";

type Storage = {
  bucket: string;
  client: S3Client;
};

let cachedStorage: Storage | undefined;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for object storage`);
  return value;
}

function storage(): Storage {
  if (cachedStorage) return cachedStorage;

  cachedStorage = {
    bucket: requiredEnvironment("S3_BUCKET"),
    client: new S3Client({
      endpoint: requiredEnvironment("S3_ENDPOINT"),
      region: process.env.S3_REGION?.trim() || "auto",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: requiredEnvironment("S3_ACCESS_KEY"),
        secretAccessKey: requiredEnvironment("S3_SECRET_KEY")
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED"
    })
  };
  return cachedStorage;
}

export function buildStorageKey(workspaceId: string, fileName: string) {
  const safeName = fileName.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
  return `${FILE_PREFIX}${workspaceId}/${randomUUID()}-${safeName}`;
}

export function buildExportPrefix(workspaceId: string, exportId: string) {
  return `${EXPORT_PREFIX}${workspaceId}/${exportId}`;
}

export function storageUri(key: string) {
  return `s3://${storage().bucket}/${key}`;
}

export function storageKeyFromUri(uri: string | null) {
  if (!uri?.startsWith("s3://")) return null;
  try {
    const parsed = new URL(uri);
    if (parsed.hostname !== storage().bucket) return null;
    return parsed.pathname.replace(/^\/+/, "") || null;
  } catch {
    return null;
  }
}

export async function putObject(
  key: string,
  data: Buffer,
  options: { contentType?: string; expiresAt?: Date } = {}
) {
  const { bucket, client } = storage();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentLength: data.byteLength,
      ContentType: options.contentType,
      Metadata: options.expiresAt ? { "expires-at": options.expiresAt.toISOString() } : undefined
    })
  );
  return { key, size: data.byteLength };
}

export async function objectSize(key: string) {
  const { bucket, client } = storage();
  const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return response.ContentLength ?? 0;
}

export async function objectStream(key: string) {
  const { bucket, client } = storage();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`Object ${key} has no response body`);
  return response.Body.transformToWebStream();
}

export async function deleteObject(key: string) {
  const { bucket, client } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function deleteObjectsWithPrefix(prefix: string) {
  const { bucket, client } = storage();
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken })
    );
    const objects = (page.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []));
    await deleteObjectBatch(client, bucket, prefix, objects);
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function deleteObjectsOlderThan(prefix: string, cutoff: Date) {
  const { bucket, client } = storage();
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken })
    );
    const expired = (page.Contents ?? []).flatMap((object) =>
      object.Key && object.LastModified && object.LastModified <= cutoff ? [{ Key: object.Key }] : []
    );
    await deleteObjectBatch(client, bucket, prefix, expired);
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function deleteObjectBatch(client: S3Client, bucket: string, prefix: string, objects: Array<{ Key: string }>) {
  if (objects.length === 0) return;
  const deleted = await client.send(
    new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } })
  );
  if (deleted.Errors?.length) {
    throw new Error(`Failed to delete ${deleted.Errors.length} object(s) under ${prefix}`);
  }
}

/** Delete aged objects even when their database transaction never committed. */
export async function purgeExpiredStorageObjects(now = new Date()) {
  await Promise.all([
    deleteObjectsOlderThan(FILE_PREFIX, new Date(now.getTime() - FILE_RETENTION_MS)),
    deleteObjectsOlderThan(EXPORT_PREFIX, new Date(now.getTime() - EXPORT_RETENTION_DAYS * 86_400_000))
  ]);
}
