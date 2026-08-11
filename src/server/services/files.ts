import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { files } from "@/db/schema";
import type { User } from "@/db/schema";
import { HttpError } from "@/lib/http";
import { resolveConversationAccess } from "@/lib/permissions";
import { buildStorageKey, deleteObject, putObject } from "./storage";
import { toFileSummary } from "./serializers";

export const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 25 * 1024 * 1024);

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
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `Files must be smaller than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`, "file_too_large");
  }
  if (options.conversationId) {
    await resolveConversationAccess(options.conversationId, options.uploader.id);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name || "upload";
  const key = buildStorageKey(options.workspaceId, name);
  await putObject(key, buffer);

  const dimensions = imageDimensions(buffer, file.type);
  const [record] = await db
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
