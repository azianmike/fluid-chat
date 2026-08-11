import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { files } from "@/db/schema";
import type { User } from "@/db/schema";
import { HttpError } from "@/lib/http";
import { resolveConversationAccess } from "@/lib/permissions";
import { assertFileUploadAllowed, fileExpiresAt } from "./file-policy";
import { buildStorageKey, deleteObject, putObject } from "./storage";
import { toFileSummary } from "./serializers";

const INLINE_MIME = /^(image\/(png|jpeg|gif|webp|avif|svg\+xml)|application\/pdf|text\/plain)$/;

/** Only images and PDFs render inline; everything else downloads. */
export function contentDisposition(mimeType: string, name: string) {
  const headerName = sanitizeDownloadName(name);
  const fallbackName = headerName
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\/]/g, "_");
  const disposition = INLINE_MIME.test(mimeType) && mimeType !== "image/svg+xml" ? "inline" : "attachment";
  return `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodeRfc5987(headerName)}`;
}

/**
 * Content-Disposition is a byte-valued HTTP header. Keep its legacy filename
 * fallback printable ASCII and carry the real Unicode name in filename*.
 */
function sanitizeDownloadName(name: string) {
  const safe = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_");
  return safe.trim() ? safe : "download";
}

/** Percent-encode the characters encodeURIComponent leaves out of attr-char. */
function encodeRfc5987(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
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
  assertFileUploadAllowed(file.size);
  if (options.conversationId) {
    const access = await resolveConversationAccess(options.conversationId, options.uploader.id);
    if (access.conversation.workspaceId !== options.workspaceId) {
      throw new HttpError(400, "Conversation is not in this workspace", "workspace_mismatch");
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  assertFileUploadAllowed(buffer.byteLength);
  const name = file.name || "upload";
  const key = buildStorageKey(options.workspaceId, name);
  const expiresAt = fileExpiresAt();
  const dimensions = imageDimensions(buffer, file.type);
  let objectUploaded = false;

  try {
    const record = await db.transaction(async (tx) => {
      // Serialize quota checks for this workspace. Without this lock, two
      // simultaneous uploads could both observe enough remaining capacity.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${options.workspaceId}, 0))`);
      const [usage] = await tx
        .select({ bytes: sql<string>`coalesce(sum(${files.size}), 0)::text` })
        .from(files)
        .where(
          and(
            eq(files.workspaceId, options.workspaceId),
            isNull(files.deletedAt),
            gt(files.expiresAt, new Date())
          )
        );
      assertFileUploadAllowed(buffer.byteLength, Number(usage?.bytes ?? 0));

      await putObject(key, buffer, {
        contentType: file.type || "application/octet-stream",
        expiresAt
      });
      objectUploaded = true;

      const [inserted] = await tx
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
          height: dimensions?.height ?? null,
          expiresAt
        })
        .returning();
      return inserted;
    });
    return toFileSummary(record);
  } catch (error) {
    if (objectUploaded) {
      await deleteObject(key).catch((cleanupError) => {
        console.error(`[storage] failed to roll back object ${key}`, cleanupError);
      });
    }
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
  try {
    await deleteObject(record.storageKey);
    await db.delete(files).where(eq(files.id, record.id));
  } catch (error) {
    // The file is already inaccessible. Keep its tombstone so the cleanup job
    // can retry physical object deletion without blocking the user request.
    console.error(`[storage] deferred deletion for object ${record.storageKey}`, error);
  }
}

export async function readableFile(fileId: string, userId: string) {
  const [record] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt), gt(files.expiresAt, new Date())))
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
