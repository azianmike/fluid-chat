import { stat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { files } from "@/db/schema";
import { deleteObject, objectSize, putObject } from "@/server/services/storage";

const deleteLocal = process.argv.includes("--delete-local");
const uploadRoot = path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"));

function localPathForKey(key: string) {
  const resolved = path.resolve(uploadRoot, key);
  if (resolved !== uploadRoot && !resolved.startsWith(uploadRoot + path.sep)) {
    throw new Error(`Unsafe legacy storage key: ${key}`);
  }
  return resolved;
}

async function main() {
  const records = await db.select().from(files);
  let migrated = 0;
  let removed = 0;
  let localCopiesRemoved = 0;
  let missing = 0;

  for (const record of records) {
    const alreadyMigrated = record.storageKey.startsWith("files/");
    if (alreadyMigrated && !deleteLocal) continue;
    const legacyKey = alreadyMigrated ? record.storageKey.slice("files/".length) : record.storageKey;
    const localPath = localPathForKey(legacyKey);

    try {
      await stat(localPath);
    } catch {
      if (!alreadyMigrated) {
        console.warn(`[migration] missing local object for file ${record.id}`);
        missing += 1;
      }
      continue;
    }

    if (alreadyMigrated) {
      const uploadedSize = await objectSize(record.storageKey);
      if (uploadedSize !== record.size) {
        throw new Error(`Object-store verification failed for file ${record.id}`);
      }
      await rm(localPath, { force: true });
      localCopiesRemoved += 1;
      continue;
    }

    if (record.deletedAt || record.expiresAt <= new Date()) {
      if (deleteLocal) {
        await db.delete(files).where(eq(files.id, record.id));
        await rm(localPath, { force: true });
        removed += 1;
      }
      continue;
    }

    const data = await readFile(localPath);
    if (data.byteLength !== record.size) {
      throw new Error(
        `Size mismatch for file ${record.id}: database=${record.size}, local=${data.byteLength}`
      );
    }

    const newKey = `files/${record.storageKey}`;
    await putObject(newKey, data, { contentType: record.mimeType, expiresAt: record.expiresAt });
    const uploadedSize = await objectSize(newKey);
    if (uploadedSize !== data.byteLength) {
      await deleteObject(newKey).catch(() => undefined);
      throw new Error(`Object-store verification failed for file ${record.id}`);
    }

    try {
      await db.update(files).set({ storageKey: newKey }).where(eq(files.id, record.id));
    } catch (error) {
      await deleteObject(newKey).catch(() => undefined);
      throw error;
    }

    if (deleteLocal) await rm(localPath, { force: true });
    migrated += 1;
  }

  console.log(
    `[migration] migrated=${migrated} removed_expired=${removed} removed_local_copies=${localCopiesRemoved} missing=${missing} delete_local=${deleteLocal}`
  );
  if (!deleteLocal && migrated > 0) {
    console.log("[migration] originals were retained; rerun with --delete-local after verification to remove them");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
