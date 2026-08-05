import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Object storage behind a two-method interface. The default driver writes to a
 * local directory (perfect for self-hosting and the Docker volume); swapping in
 * S3/MinIO later only means implementing the same three functions.
 */

const root = path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"));

function resolveKey(key: string) {
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

export function buildStorageKey(workspaceId: string, fileName: string) {
  const safeName = fileName.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
  return path.posix.join(workspaceId, `${randomUUID()}-${safeName}`);
}

export async function putObject(key: string, data: Buffer) {
  const target = resolveKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
  return { key, size: data.byteLength };
}

export async function objectSize(key: string) {
  const info = await stat(resolveKey(key));
  return info.size;
}

export function objectStream(key: string) {
  return createReadStream(resolveKey(key));
}

export async function deleteObject(key: string) {
  await rm(resolveKey(key), { force: true });
}

export const storageRoot = root;
