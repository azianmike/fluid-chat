import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { files, workspaces } from "@/db/schema";
import type { User } from "@/db/schema";
import { assertWritable, checkStorageQuota, resolveStorageLimitBytes, storageUsedBytes } from "@/lib/billing";
import { HttpError } from "@/lib/http";
import { resolveConversationAccess } from "@/lib/permissions";
import { formatBytes } from "@/shared/format";
import { buildStorageKey, deleteObject, putObject } from "./storage";
import { toFileSummary } from "./serializers";

export const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 25 * 1024 * 1024);

/**
 * A file backing a custom emoji is not free to release, even once the message
 * that carried it is gone: `custom_emoji.file_id` cascades, so deleting the row
 * takes the emoji with it, and deleting the object leaves the emoji rendering a
 * 404. The automatic cleanup paths — message deletion, retention, the abandoned
 * upload sweeper — all filter by this, and those bytes keep counting against the
 * workspace quota, since they are still genuinely held.
 *
 * `deleteFile` is the deliberate exception: an explicit "delete this file" is a
 * user decision, and it can still orphan an emoji that shares the file.
 */
export const notBackingAnEmoji = sql`not exists (select 1 from custom_emoji ce where ce.file_id = ${files.id})`;

const INLINE_MIME = /^(image\/(png|jpeg|gif|webp|avif|svg\+xml)|application\/pdf|text\/plain)$/;

/** Only images and PDFs render inline; everything else downloads. */
export function contentDisposition(mimeType: string, name: string) {
  const safeName = name.replace(/["\\\r\n]/g, "_");
  const disposition = INLINE_MIME.test(mimeType) && mimeType !== "image/svg+xml" ? "inline" : "attachment";
  return `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function uploadFile(options: {
  workspaceId: string;
  uploader: User;
  conversationId?: string | null;
  file: File;
}) {
  const { file } = options;
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new HttpError(400, "No file provided", "missing_file");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `Files must be smaller than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`, "file_too_large");
  }
  if (options.conversationId) {
    await resolveConversationAccess(options.conversationId, options.uploader.id);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name || "upload";
  const dimensions = imageDimensions(buffer, file.type);

  // Tracked out here so a failure to commit — which happens after the callback
  // returns, out of reach of any catch inside it — cannot strand bytes on disk
  // with no row to find them by.
  let writtenKey: string | null = null;
  try {
    /*
     * Quota, storage write and row insert share one transaction. The advisory
     * lock serialises uploads for this workspace only: without it two concurrent
     * uploads both read the pre-upload total, both pass, and the ceiling is
     * breachable by anyone willing to upload in parallel — which is exactly the
     * case a cost control exists to stop.
     */
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`storage:${options.workspaceId}`})::bigint)`);

      const [workspace] = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, options.workspaceId))
        .limit(1);
      if (!workspace) throw new HttpError(404, "Workspace not found", "not_found");
      assertWritable(workspace);

      const quota = checkStorageQuota({
        usedBytes: await storageUsedBytes(options.workspaceId, tx),
        limitBytes: resolveStorageLimitBytes(workspace),
        incomingBytes: buffer.byteLength,
        overageAllowed: workspace.overageAllowed
      });
      if (!quota.allowed) {
        throw new HttpError(
          402,
          `This workspace has used ${formatBytes(quota.usedBytes)} of its ${formatBytes(quota.limitBytes ?? 0)} storage limit ` +
            `and this file needs ${formatBytes(buffer.byteLength)}. Delete some files to free up space.`,
          "storage_limit_reached"
        );
      }

      const key = buildStorageKey(options.workspaceId, name);
      await putObject(key, buffer);
      writtenKey = key;

      const [record] = await tx
        .insert(files)
        .values({
          workspaceId: options.workspaceId,
          uploaderId: options.uploader.id,
          conversationId: options.conversationId ?? null,
          name,
          mimeType: file.type || "application/octet-stream",
          size: buffer.byteLength,
          storageKey: key,
          width: dimensions?.width ?? null,
          height: dimensions?.height ?? null
        })
        .returning();
      return toFileSummary(record);
    });
  } catch (error) {
    // The rollback frees the row but not the bytes, so drop them by hand.
    if (writtenKey) await deleteObject(writtenKey).catch(() => undefined);
    throw error;
  }
}

export async function deleteFile(fileId: string, actor: User, isModerator: boolean) {
  const [record] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!record || record.deletedAt) throw new HttpError(404, "File not found", "not_found");
  if (record.uploaderId !== actor.id && !isModerator) {
    throw new HttpError(403, "Cannot delete this file", "delete_forbidden");
  }
  await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, record.id));
  await deleteObject(record.storageKey).catch(() => undefined);
}

export async function readableFile(fileId: string, userId: string) {
  const [record] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .limit(1);
  if (!record) throw new HttpError(404, "File not found", "not_found");

  if (record.conversationId) {
    await resolveConversationAccess(record.conversationId, userId);
  } else if (record.uploaderId !== userId) {
    // Unattached uploads are only visible to their uploader until posted.
    throw new HttpError(403, "File access denied", "file_forbidden");
  }
  return record;
}

/** Minimal header sniffing so images can reserve layout space before loading. */
function imageDimensions(buffer: Buffer, mimeType: string) {
  try {
    if (mimeType === "image/png" && buffer.length > 24 && buffer.toString("ascii", 12, 16) === "IHDR") {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mimeType === "image/gif" && buffer.length > 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mimeType === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}
